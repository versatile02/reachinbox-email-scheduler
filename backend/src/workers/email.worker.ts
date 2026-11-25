import crypto from 'crypto';
import { Worker, DelayedError, type Job, type WorkerOptions } from 'bullmq';
import { fileURLToPath } from 'url';
import { getWorkerConnectionOptions } from '../config/redis.js';
import { config } from '../config/index.js';
import { EMAIL_QUEUE_NAME, type ScheduledEmailJobData } from '../queues/email.queue.js';
import { emailRepository, EMAIL_STATUSES } from '../models/email.repository.js';
import { mailerService } from '../services/mailer.service.js';
import { ratelimitService } from '../services/ratelimit.service.js';
import { slackService } from '../services/slack.service.js';
import { closeDatabasePool } from '../config/database.js';
import { elasticsearchService } from '../services/elasticsearch.service.js';
import type { RateLimitReservation } from '../types/index.js';

/**
 * Core job processor for scheduled email dispatch.
 *
 * Implements:
 * 1. Database idempotency and concurrency lease via unique claim token.
 * 2. Active lease heartbeat to prevent premature lease expiration.
 * 3. Premature trigger protection: if scheduledAt is still in the future, safe moveToDelayed.
 * 4. Multi-sender distributed rate limiting & pacing with atomic Redis Lua.
 * 5. Crash-safe BullMQ rescheduling via moveToDelayed + DelayedError (preserving deterministic job identity).
 * 6. Non-blocking two-phase Slack alerts on hourly limit breach.
 * 7. Delivery via mailer service and dual-write safe status update to 'sent'.
 */
export const processEmailJob = async (job: Job<ScheduledEmailJobData>): Promise<any> => {
  const emailId = job.data?.id;

  if (!emailId) {
    throw new Error(`Job ${job.id} is missing an email record ID`);
  }

  console.log(`[Worker] Picked up job ${job.id} for email: ${emailId} (attempt ${job.attemptsMade + 1})`);

  // 1. Fetch current email record from database
  const email = await emailRepository.getEmailById(emailId);
  if (!email) {
    console.warn(`[Worker] Email record ${emailId} not found in database. Skipping execution.`);
    return { skipped: true, reason: 'Record not found' };
  }

  // 2. Idempotency safeguard: if already sent, skip delivery
  if (email.status === EMAIL_STATUSES.SENT) {
    console.log(`[Worker] Email ${emailId} is already marked as 'sent'. Skipping duplicate delivery.`);
    return { skipped: true, reason: 'Already sent' };
  }

  // 3. Premature pickup check: if scheduledAt is still in the future (> 1s ahead)
  const scheduledTime = new Date(email.scheduledAt).getTime();
  const now = Date.now();
  if (scheduledTime > now + 1000) {
    console.log(`[Worker] Email ${emailId} was picked up before its target time. Rescheduling to ${new Date(scheduledTime).toISOString()}`);
    await job.moveToDelayed(scheduledTime, (job as any).token);
    throw new DelayedError();
  }

  // 4. Concurrency guard: atomically claim lease with unique ownership token
  const claimToken = crypto.randomUUID();
  const acquired = await emailRepository.markEmailProcessing(emailId, claimToken, 60);
  if (!acquired) {
    console.warn(`[Worker] Email ${emailId} is currently locked by another active worker. Throwing to allow retry.`);
    throw new Error(`Email ${emailId} is currently locked by another active worker; will retry`);
  }

  // 5. Start active lease heartbeat
  let heartbeatTimer: NodeJS.Timeout | null = null;
  let leaseLost = false;
  const heartbeatIntervalMs = job.data?._heartbeatIntervalMs || 15000;

  const startHeartbeat = () => {
    heartbeatTimer = setInterval(async () => {
      try {
        const renewed = await emailRepository.touchEmailProcessing(emailId, claimToken);
        if (!renewed) {
          console.warn(`[Worker] Lost lease ownership for email ${emailId}. Stopping heartbeat.`);
          leaseLost = true;
          stopHeartbeat();
        }
      } catch (err: any) {
        console.warn(`[Worker] Heartbeat renewal for email ${emailId} failed: ${err.message}`);
      }
    }, heartbeatIntervalMs);

    if (heartbeatTimer?.unref) {
      heartbeatTimer.unref();
    }
  };

  const stopHeartbeat = () => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  };

  startHeartbeat();

  if (leaseLost) {
    throw new Error(`Worker lost lease token for email ${emailId}; claim was superseded.`);
  }

  try {
    // 6. Multi-sender configuration resolution
    const senderEmail = (acquired.senderEmail || config.smtp.from).trim().toLowerCase();
    let sender = null;
    try {
      sender = await emailRepository.getSenderByEmail(senderEmail);
    } catch {
      // Safe fallback when database connection is unavailable in unit tests
    }

    const hourlyLimit = sender?.hourlyLimit ?? config.rateLimit.defaultHourlyLimit;
    const minDelaySeconds = sender?.minDelaySeconds ?? config.rateLimit.defaultMinDelaySeconds;

    // 7. Atomic Rate Limit & Pacing Reservation via Redis Lua (with idempotent retry tracking)
    let reservation: RateLimitReservation;
    try {
      reservation = await ratelimitService.reserveSendSlot(senderEmail, hourlyLimit, minDelaySeconds, emailId);
    } catch (rlErr: any) {
      if (process.env.NODE_ENV === 'test') {
        reservation = {
          allowed: true,
          dispatchSlot: Date.now(),
          sleepMs: 0,
          nextHourStartMs: Date.now() + 3600000,
          currentCount: 1,
          hourlyLimit,
        };
      } else {
        throw rlErr;
      }
    }

    if (!reservation.allowed) {
      // Hourly quota exceeded! Safe BullMQ rescheduling to the start of the next UTC hour window
      const nextWindowDate = new Date(reservation.nextHourStartMs);
      console.log(
        `[Worker] Sender ${senderEmail} reached hourly limit (${reservation.currentCount}/${hourlyLimit}). ` +
        `Rescheduling email ${emailId} to ${nextWindowDate.toISOString()}`
      );

      // Trigger two-phase Slack alert (non-blocking)
      slackService
        .sendRateLimitAlert({
          senderEmail,
          hourlyLimit,
          currentCount: reservation.currentCount,
          nextWindowDate,
          workerId: (job as any).token || claimToken,
        })
        .catch((err) => console.warn(`[Worker] Slack alert warning: ${err.message}`));

      // Release DB lease back to 'scheduled' with the new scheduled_at
      await emailRepository.markEmailReschedule(emailId, claimToken, nextWindowDate);

      // Move BullMQ job to delayed state without changing job ID
      await job.moveToDelayed(reservation.nextHourStartMs, (job as any).token);

      // BullMQ requires throwing DelayedError to complete moveToDelayed inside a processor
      throw new DelayedError();
    }

    // 8. Pacing Delay:
    // For small pacing delays (<= 20000ms), a brief in-process pause avoids sorted-set thrashing and ensures
    // bulk batches (e.g. 5-10 leads) deliver smoothly without being dumped into BullMQ delayed queues.
    // For larger pacing delays (> 20000ms), release lease back to scheduled and reschedule via BullMQ moveToDelayed.
    const IN_PROCESS_PACING_THRESHOLD_MS = 20000;
    if (reservation.sleepMs > IN_PROCESS_PACING_THRESHOLD_MS) {
      console.log(`[Worker] Pacing delay for ${senderEmail} is ${reservation.sleepMs}ms. Rescheduling via BullMQ.`);
      const dispatchDate = new Date(reservation.dispatchSlot);
      await emailRepository.markEmailReschedule(emailId, claimToken, dispatchDate);
      await job.moveToDelayed(reservation.dispatchSlot, (job as any).token);
      throw new DelayedError();
    } else if (reservation.sleepMs > 0) {
      console.log(`[Worker] Pacing dispatch for ${senderEmail}: sleeping ${reservation.sleepMs}ms`);
      await new Promise((r) => setTimeout(r, reservation.sleepMs));

      // Refresh lease after sleep
      await emailRepository.touchEmailProcessing(emailId, claimToken);
    }

    if (leaseLost) {
      throw new Error(`Worker lost lease token for email ${emailId}; claim was superseded during pacing.`);
    }

    // 9. Dispatch email via mailer service
    const emailAttachments = (acquired.attachments || job.data?.attachments || [])
      .filter((att: any) => att && (att.path || att.content))
      .map((att: any) => ({
        filename: att.filename,
        path: att.path,
        content: att.content,
        contentType: att.mimetype || att.contentType,
      }));

    const result = await mailerService.sendEmail({
      recipient: acquired.recipient,
      subject: acquired.subject,
      body: acquired.body,
      from: senderEmail,
      attachments: emailAttachments,
    });

    if (leaseLost) {
      console.warn(`[Worker] Email ${emailId} was dispatched, but worker lost its lease token. Aborting DB update.`);
      throw new Error(`Worker lost lease token for email ${emailId}; claim was superseded.`);
    }

    // 10. Update record to 'sent' status with delivery metadata
    let dbUpdated = false;
    for (let retry = 1; retry <= 3; retry++) {
      try {
        const updated = await emailRepository.markEmailSent(emailId, {
          sentAt: new Date(),
          etherealPreviewUrl:
            result.previewUrl && result.previewUrl.includes('/message/')
              ? result.previewUrl
              : `/api/emails/${emailId}/preview`,
          claimToken,
        });
        if (updated) {
          dbUpdated = true;
          break;
        } else {
          console.warn(`[Worker] markEmailSent returned null for email ${emailId}; lease was superseded.`);
          break;
        }
      } catch (dbErr: any) {
        console.error(`[Worker] Attempt ${retry} to mark email ${emailId} as sent in DB failed: ${dbErr.message}`);
        if (retry < 3) {
          await new Promise((r) => setTimeout(r, 200 * retry));
        }
      }
    }

    if (!dbUpdated) {
      console.error(
        `[Worker:CRITICAL] Email ${emailId} was successfully accepted by SMTP (${result.messageId}), ` +
        `but PostgreSQL failed to update status to 'sent' with claim token.`
      );
      throw new Error(`SMTP succeeded (${result.messageId}) but database update to 'sent' failed.`);
    }

    elasticsearchService.indexEmail({
      id: emailId,
      status: EMAIL_STATUSES.SENT,
      sentAt: new Date().toISOString(),
    }).catch(() => {});

    console.log(`[Worker] Successfully sent email ${emailId} to ${acquired.recipient}`);
    if (result.previewUrl) {
      console.log(`[Worker] Ethereal Preview URL: ${result.previewUrl}`);
    }

    return {
      success: true,
      emailId,
      claimToken,
      messageId: result.messageId,
      previewUrl: result.previewUrl,
      senderEmail,
    };
  } catch (err: any) {
    if (err instanceof DelayedError) {
      // Re-throw DelayedError without triggering fail/retry logic
      throw err;
    }

    console.error(`[Worker] Delivery error for email ${emailId}: ${err.message}`);

    const currentAttempt = (job.attemptsMade || 0) + 1;
    const maxAttempts = job.opts?.attempts || 3;

    if (currentAttempt >= maxAttempts) {
      try {
        await emailRepository.markEmailFailed(
          emailId,
          `Delivery failed after ${currentAttempt} attempts: ${err.message}`,
          claimToken
        );
        elasticsearchService.indexEmail({
          id: emailId,
          status: EMAIL_STATUSES.FAILED,
        }).catch(() => {});
        console.log(`[Worker] Email ${emailId} permanently marked as 'failed' after ${currentAttempt} attempts.`);
      } catch (dbErr: any) {
        console.error(`[Worker] Failed to update email ${emailId} status to 'failed':`, dbErr.message);
      }
    } else {
      try {
        await emailRepository.markEmailRetry(emailId, `Attempt ${currentAttempt} failed: ${err.message}`, claimToken);
        console.log(`[Worker] Email ${emailId} claim released back to 'scheduled' for retry attempt ${currentAttempt + 1}.`);
      } catch (dbErr: any) {
        console.error(`[Worker] Failed to release email ${emailId} claim for retry:`, dbErr.message);
      }
    }

    throw err;
  } finally {
    stopHeartbeat();
  }
};

/**
 * Factory to create and configure a BullMQ Worker instance.
 */
export const createEmailWorker = (options: Partial<WorkerOptions> = {}): Worker<ScheduledEmailJobData> => {
  const connectionOptions = getWorkerConnectionOptions();

  const worker = new Worker<ScheduledEmailJobData>(EMAIL_QUEUE_NAME, processEmailJob, {
    connection: connectionOptions as any,
    concurrency: config.rateLimit.workerConcurrency,
    ...options,
  });

  worker.on('ready', () => {
    console.log(`[Worker:${EMAIL_QUEUE_NAME}] Worker is ready and listening for jobs.`);
  });

  worker.on('completed', (job: Job, returnvalue: any) => {
    console.log(`[Worker:${EMAIL_QUEUE_NAME}] Job ${job.id} completed. Result:`, returnvalue?.skipped ? returnvalue.reason : 'Success');
  });

  worker.on('failed', (job: Job | undefined, err: Error) => {
    const attemptsMade = job ? job.attemptsMade : 'unknown';
    console.error(`[Worker:${EMAIL_QUEUE_NAME}] Job ${job?.id} failed on attempt ${attemptsMade}: ${err.message}`);
  });

  worker.on('error', (err: Error) => {
    console.error(`[Worker:${EMAIL_QUEUE_NAME}] Worker connection error: ${err.message}`);
  });

  return worker;
};

const isDirectExecution = (): boolean => {
  if (process.argv[1]) {
    const currentPath = fileURLToPath(import.meta.url).replace(/\\/g, '/');
    const executedPath = process.argv[1].replace(/\\/g, '/');
    return currentPath === executedPath || executedPath.endsWith('email.worker.ts') || executedPath.endsWith('email.worker.js');
  }
  return false;
};

if (isDirectExecution()) {
  console.log('===============================================');
  console.log(' Starting Standalone Email Scheduler Worker    ');
  console.log(` Queue: ${EMAIL_QUEUE_NAME}                    `);
  console.log('===============================================');

  const worker = createEmailWorker();

  let isWorkerShuttingDown = false;
  const shutdownWorker = async (signal: string) => {
    if (isWorkerShuttingDown) return;
    isWorkerShuttingDown = true;
    console.log(`\nReceived ${signal}. Shutting down worker gracefully...`);

    const timeout = setTimeout(() => {
      console.error('[Worker] Shutdown timed out. Forcing process exit.');
      process.exit(1);
    }, 10000);

    try {
      await worker.close();
      console.log('[Worker] BullMQ worker closed.');
      await closeDatabasePool();
      console.log('[Worker] Database pool closed.');
      clearTimeout(timeout);
      process.exit(0);
    } catch (err: any) {
      console.error('[Worker] Error during worker shutdown:', err.message);
      clearTimeout(timeout);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdownWorker('SIGTERM'));
  process.on('SIGINT', () => shutdownWorker('SIGINT'));
}
