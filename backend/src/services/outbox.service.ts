import pg from 'pg';
import { emailRepository } from '../models/email.repository.js';
import { pool } from '../config/database.js';
import type { OutboxEventRecord, EmailRecord } from '../types/index.js';
import { emailQueue, addScheduledEmailJob, EMAIL_QUEUE_NAME } from '../queues/email.queue.js';

export interface ReconciliationResult {
  scanned: number;
  reconciled: number;
  alreadyInQueue: number;
  errors: number;
}

/**
 * Publishes a single outbox event to BullMQ delayed queue.
 * Guarantees idempotency by setting BullMQ jobId to email.id.
 */
export const publishOutboxEvent = async (event: OutboxEventRecord, client?: pg.PoolClient): Promise<boolean> => {
  try {
    const payload = typeof event.payload === 'string' ? JSON.parse(event.payload) : event.payload;
    const emailId = payload.id || event.emailId;

    const scheduledTime = new Date(payload.scheduledAt).getTime();
    const now = Date.now();
    const delayMs = Math.max(0, scheduledTime - now);

    await addScheduledEmailJob(
      {
        id: emailId,
        senderEmail: payload.senderEmail,
        recipient: payload.recipient,
        subject: payload.subject,
        body: payload.body,
      },
      delayMs,
      emailId // Deterministic jobId for idempotency
    );

    await emailRepository.markOutboxPublished(event.id, client);
    return true;
  } catch (err: any) {
    console.error(`[OutboxPublisher] Failed to publish event ${event.id}:`, err.message);
    await emailRepository.markOutboxFailed(event.id, err.message, client).catch(() => {});
    return false;
  }
};

/**
 * Claims and processes the next pending outbox event inside an explicit PostgreSQL transaction.
 * Ensures:
 * 1. SELECT ... FOR UPDATE SKIP LOCKED locks the row strictly within a transaction.
 * 2. Row locks remain actively held across the BullMQ dispatch until status update is committed.
 * 3. Concurrent instances skip currently locked rows and never publish the same event simultaneously.
 * 4. Any crash prior to commit automatically rolls back, preserving the pending state for safe retry.
 */
export const processNextTransactionalOutboxEvent = async (customClient?: pg.PoolClient): Promise<boolean> => {
  const isExternalClient = Boolean(customClient);
  const client = customClient || (await pool.connect());
  let inTransaction = false;

  try {
    if (!isExternalClient) {
      await client.query('BEGIN');
      inTransaction = true;
    }

    const pendingEvents = await emailRepository.getPendingOutboxEvents(1, client);
    if (!pendingEvents || pendingEvents.length === 0) {
      if (inTransaction) {
        await client.query('COMMIT');
      }
      return false; // No pending events
    }

    const event = pendingEvents[0];
    const published = await publishOutboxEvent(event, client);

    if (inTransaction) {
      await client.query('COMMIT');
      inTransaction = false;
    }

    return published;
  } catch (err: any) {
    if (inTransaction) {
      await client.query('ROLLBACK').catch(() => {});
    }
    throw err;
  } finally {
    if (!isExternalClient) {
      client.release();
    }
  }
};

/**
 * Sweeps pending outbox events from PostgreSQL and publishes them to BullMQ
 * using transaction-scoped row-level locking (FOR UPDATE SKIP LOCKED).
 */
export const processPendingOutboxEvents = async (limit = 50): Promise<number> => {
  try {
    let publishedCount = 0;
    for (let i = 0; i < limit; i++) {
      const processed = await processNextTransactionalOutboxEvent();
      if (!processed) {
        break; // No more rows to process or failed
      }
      publishedCount++;
    }

    if (publishedCount > 0) {
      console.log(`[OutboxPublisher] Successfully published ${publishedCount} pending outbox events.`);
    }

    return publishedCount;
  } catch (err: any) {
    // Database or connection error, will retry on next tick
    return 0;
  }
};

/**
 * Reconciles PostgreSQL scheduled emails with BullMQ queue.
 * Detects any scheduled emails missing from Redis (e.g. after Redis data loss, restart, or flush)
 * and safely re-enqueues them with deterministic job IDs.
 */
export const reconcileQueueWithDatabase = async (): Promise<ReconciliationResult> => {
  const result: ReconciliationResult = {
    scanned: 0,
    reconciled: 0,
    alreadyInQueue: 0,
    errors: 0,
  };

  try {
    const scheduledEmails = await emailRepository.getScheduledEmailsForReconciliation();
    result.scanned = scheduledEmails.length;

    for (const email of scheduledEmails) {
      try {
        const existingJob = await emailQueue.getJob(email.id);
        if (existingJob) {
          result.alreadyInQueue++;
          continue;
        }

        // Job is missing from Redis! Re-enqueue it
        const scheduledTime = new Date(email.scheduledAt).getTime();
        const now = Date.now();
        const delayMs = Math.max(0, scheduledTime - now);

        await addScheduledEmailJob(
          {
            id: email.id,
            senderEmail: email.senderEmail,
            recipient: email.recipient,
            subject: email.subject,
            body: email.body,
          },
          delayMs,
          email.id
        );

        result.reconciled++;
        console.log(`[QueueReconciliation] Recovered missing job for email ${email.id} into ${EMAIL_QUEUE_NAME}`);
      } catch (itemErr: any) {
        result.errors++;
        console.error(`[QueueReconciliation] Error reconciling email ${email.id}:`, itemErr.message);
      }
    }

    if (result.reconciled > 0) {
      console.log(
        `[QueueReconciliation] Complete. Scanned: ${result.scanned}, Recovered: ${result.reconciled}, Existing: ${result.alreadyInQueue}`
      );
    }
  } catch (err: any) {
    console.error('[QueueReconciliation] Reconciliation failed:', err.message);
  }

  return result;
};

// ========================================================
// Asynchronous Non-Cron Background Publisher Loop
// ========================================================

let publisherTimer: NodeJS.Timeout | null = null;
let isPublisherRunning = false;

export const startOutboxPublisher = (intervalMs = 5000): void => {
  if (isPublisherRunning) {
    return;
  }
  isPublisherRunning = true;

  const tick = async () => {
    if (!isPublisherRunning) return;
    try {
      await processPendingOutboxEvents();
    } catch {
      // Ignore background loop tick errors
    } finally {
      if (isPublisherRunning) {
        publisherTimer = setTimeout(tick, intervalMs);
        if (publisherTimer.unref) {
          publisherTimer.unref();
        }
      }
    }
  };

  publisherTimer = setTimeout(tick, intervalMs);
  if (publisherTimer.unref) {
    publisherTimer.unref();
  }
  console.log(`[OutboxPublisher] Started background publisher loop (${intervalMs}ms interval).`);
};

export const stopOutboxPublisher = (): void => {
  isPublisherRunning = false;
  if (publisherTimer) {
    clearTimeout(publisherTimer);
    publisherTimer = null;
  }
  console.log('[OutboxPublisher] Stopped background publisher loop.');
};

export const outboxService = {
  publishOutboxEvent,
  processNextTransactionalOutboxEvent,
  processPendingOutboxEvents,
  reconcileQueueWithDatabase,
  startOutboxPublisher,
  stopOutboxPublisher,
};

export default outboxService;
