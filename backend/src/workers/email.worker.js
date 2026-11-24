import crypto from 'crypto';
import { Worker } from 'bullmq';
import { fileURLToPath } from 'url';
import { getWorkerConnectionOptions } from '../config/redis.js';
import { EMAIL_QUEUE_NAME } from '../queues/email.queue.js';
import { emailRepository, EMAIL_STATUSES } from '../models/email.repository.js';
import { mailerService } from '../services/mailer.service.js';
import { closeDatabasePool } from '../config/database.js';

/**
 * Core job processor for scheduled email dispatch.
 * Performs idempotent execution with database status checks and concurrency guards.
 *
 * @param {import('bullmq').Job} job - The BullMQ job being processed
 * @returns {Promise<Object>} Execution result details
 */
export const processEmailJob = async (job) => {
  const emailId = job.data?.id || job.data?.emailId;

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

  // 3. Concurrency guard: atomically claim lease with unique ownership token
  const claimToken = crypto.randomUUID();
  const acquired = await emailRepository.markEmailProcessing(emailId, claimToken, 60);
  if (!acquired) {
    // CRITICAL: The email is NOT sent, but is locked by an active worker whose lease has not expired.
    // If we return { skipped: true }, BullMQ will mark the job as COMPLETED and the email will NEVER be sent!
    // Throwing an error ensures BullMQ keeps the job active and retries when the lease expires or backoff matures.
    console.warn(`[Worker] Email ${emailId} is currently locked by another active worker. Throwing to allow retry.`);
    throw new Error(`Email ${emailId} is currently locked by another active worker; will retry`);
  }

  // 4. Start active lease heartbeat verifying token ownership
  let heartbeatTimer = null;
  let leaseLost = false;
  const heartbeatIntervalMs = job.data?._heartbeatIntervalMs || 15000;
  const startHeartbeat = () => {
    heartbeatTimer = setInterval(async () => {
      try {
        const renewed = await emailRepository.touchEmailProcessing(emailId, claimToken);
        if (!renewed) {
          console.warn(`[Worker] Lost lease ownership for email ${emailId} (superseded by newer worker). Stopping heartbeat.`);
          leaseLost = true;
          stopHeartbeat();
        }
      } catch (err) {
        console.warn(`[Worker] Heartbeat renewal for email ${emailId} failed: ${err.message}`);
      }
    }, heartbeatIntervalMs);
    if (heartbeatTimer?.unref) {
      heartbeatTimer.unref(); // Ensure timer does not block graceful process exit
    }
  };

  const stopHeartbeat = () => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  };

  startHeartbeat();

  // Guard: if lease was somehow invalidated immediately after start, do not initiate SMTP
  if (leaseLost) {
    throw new Error(`Worker lost lease token for email ${emailId}; claim was superseded.`);
  }

  // 5. Dispatch email through mailer service
  try {
    const result = await mailerService.sendEmail({
      recipient: acquired.recipient,
      subject: acquired.subject,
      body: acquired.body,
    });

    if (leaseLost) {
      console.warn(`[Worker] Email ${emailId} was dispatched, but worker lost its lease token. Aborting DB update.`);
      throw new Error(`Worker lost lease token for email ${emailId}; claim was superseded.`);
    }

    // 6. Update record to 'sent' status with delivery metadata and preview URL
    // Dual-write mitigation: if database update encounters a transient error, retry up to 3 times before failing
    let dbUpdated = false;
    for (let retry = 1; retry <= 3; retry++) {
      try {
        const updated = await emailRepository.markEmailSent(emailId, {
          sentAt: new Date(),
          etherealPreviewUrl: result.previewUrl,
          claimToken,
        });
        if (updated) {
          dbUpdated = true;
          break;
        } else {
          console.warn(`[Worker] markEmailSent returned null for email ${emailId}; lease was superseded.`);
          break;
        }
      } catch (dbErr) {
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
    };
  } catch (err) {
    console.error(`[Worker] Delivery error for email ${emailId}: ${err.message}`);

    // If this attempt is the final configured attempt, mark record as failed in database
    const currentAttempt = (job.attemptsMade || 0) + 1;
    const maxAttempts = job.opts?.attempts || 3;

    if (currentAttempt >= maxAttempts) {
      try {
        await emailRepository.markEmailFailed(emailId, `Delivery failed after ${currentAttempt} attempts: ${err.message}`, claimToken);
        console.log(`[Worker] Email ${emailId} permanently marked as 'failed' after ${currentAttempt} attempts.`);
      } catch (dbErr) {
        console.error(`[Worker] Failed to update email ${emailId} status to 'failed':`, dbErr.message);
      }
    } else {
      // Non-final attempt: release claim back to 'scheduled' with error diagnostic
      // so the next BullMQ retry attempt can claim it immediately without waiting for stale timeout
      try {
        await emailRepository.markEmailRetry(emailId, `Attempt ${currentAttempt} failed: ${err.message}`, claimToken);
        console.log(`[Worker] Email ${emailId} claim released back to 'scheduled' for retry attempt ${currentAttempt + 1}.`);
      } catch (dbErr) {
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
 * @param {Object} [options] - Additional BullMQ Worker options
 * @returns {Worker}
 */
export const createEmailWorker = (options = {}) => {
  const connectionOptions = getWorkerConnectionOptions();

  const worker = new Worker(EMAIL_QUEUE_NAME, processEmailJob, {
    connection: connectionOptions,
    concurrency: 5,
    ...options,
  });

  worker.on('ready', () => {
    console.log(`[Worker:${EMAIL_QUEUE_NAME}] Worker is ready and listening for jobs.`);
  });

  worker.on('completed', (job, returnvalue) => {
    console.log(`[Worker:${EMAIL_QUEUE_NAME}] Job ${job.id} completed. Result:`, returnvalue?.skipped ? returnvalue.reason : 'Success');
  });

  worker.on('failed', (job, err) => {
    const attemptsMade = job ? job.attemptsMade : 'unknown';
    console.error(`[Worker:${EMAIL_QUEUE_NAME}] Job ${job?.id} failed on attempt ${attemptsMade}: ${err.message}`);
  });

  worker.on('error', (err) => {
    console.error(`[Worker:${EMAIL_QUEUE_NAME}] Worker connection error: ${err.message}`);
  });

  return worker;
};

// If executed directly as a standalone process (npm run worker)
const isDirectExecution = () => {
  if (process.argv[1]) {
    const currentPath = fileURLToPath(import.meta.url).replace(/\\/g, '/');
    const executedPath = process.argv[1].replace(/\\/g, '/');
    return currentPath === executedPath || executedPath.endsWith('email.worker.js');
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
  const shutdownWorker = async (signal) => {
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
    } catch (err) {
      console.error('[Worker] Error during worker shutdown:', err.message);
      clearTimeout(timeout);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdownWorker('SIGTERM'));
  process.on('SIGINT', () => shutdownWorker('SIGINT'));
}
