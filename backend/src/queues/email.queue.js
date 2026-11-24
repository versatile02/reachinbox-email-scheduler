import { Queue } from 'bullmq';
import { getRedisConnectionOptions } from '../config/redis.js';

export const EMAIL_QUEUE_NAME = 'email-queue';

/**
 * Default options applied to each email job in the queue:
 * - 3 retry attempts with exponential backoff on transient errors
 * - Job retention limits to manage Redis memory consumption
 */
export const defaultEmailJobOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 5000, // 3 total attempts: 1 initial attempt + 2 retries (first retry after 5s, second retry after 10s)
  },
  removeOnComplete: {
    age: 24 * 3600, // Retain completed jobs for 24 hours
    count: 1000,    // Retain maximum 1,000 completed jobs
  },
  removeOnFail: {
    age: 7 * 24 * 3600, // Retain failed jobs for 7 days for debugging
    count: 5000,       // Retain maximum 5,000 failed jobs
  },
};

/**
 * Initialize reusable BullMQ Queue for scheduled emails
 */
export const emailQueue = new Queue(EMAIL_QUEUE_NAME, {
  connection: getRedisConnectionOptions(),
  defaultJobOptions: defaultEmailJobOptions,
});

// Attach queue error listener to prevent uncaught exceptions on Redis disconnects
emailQueue.on('error', (err) => {
  const errorMessage = err?.message || (typeof err === 'object' ? JSON.stringify(err) : String(err));
  console.error(`[BullMQ:${EMAIL_QUEUE_NAME}] Queue notice: ${errorMessage}`);
});

/**
 * Adds an email job scheduled for delayed execution.
 * 
 * Note on fractional delays: BullMQ and Redis sorted sets require integer millisecond timestamps.
 * Any fractional delay supplied (e.g. 1500.8ms) is floored (rounded down) to the nearest whole
 * millisecond integer (e.g. 1500ms) via Math.floor().
 * 
 * @param {Object} emailData - Email payload (recipient, subject, body, metadata)
 * @param {number} [delayMs=0] - Non-negative, finite numeric delay in milliseconds (fractional values are floored)
 * @param {string} [customJobId] - Optional non-empty string identifier for idempotency
 * @returns {Promise<import('bullmq').Job>}
 */
export const addScheduledEmailJob = async (emailData, delayMs = 0, customJobId = null) => {
  // Validate delayMs: must be a finite, non-negative number
  if (typeof delayMs !== 'number' || !Number.isFinite(delayMs) || delayMs < 0) {
    throw new TypeError(
      `Invalid delayMs: expected a finite, non-negative number, received ${typeof delayMs === 'number' ? delayMs : typeof delayMs}`
    );
  }

  // Validate customJobId when supplied (null/undefined are valid for default auto-generated IDs)
  if (customJobId !== null && customJobId !== undefined) {
    if (typeof customJobId !== 'string' || customJobId.trim().length === 0) {
      throw new TypeError(
        `Invalid customJobId: expected a non-empty string, received ${typeof customJobId === 'string' ? 'empty string' : typeof customJobId}`
      );
    }
  }

  const options = {
    delay: Math.floor(delayMs),
  };

  if (typeof customJobId === 'string') {
    options.jobId = customJobId.trim();
  }

  return await emailQueue.add('sendEmail', emailData, options);
};

/**
 * Retrieves current job counts across states.
 * Fails gracefully if Redis is not in a ready state.
 * @param {number} [timeoutMs=2000] - Maximum duration to wait before timing out
 * @returns {Promise<Object>}
 */
export const getEmailQueueMetrics = async (timeoutMs = 2000) => {
  try {
    const client = await emailQueue.client;
    if (!client || client.status !== 'ready') {
      const currentStatus = client?.status || 'disconnected';
      return {
        status: 'unreachable',
        queueName: EMAIL_QUEUE_NAME,
        redisStatus: currentStatus,
        message: `Redis is currently in '${currentStatus}' state. Ensure Redis server is running.`,
      };
    }

    let timer;
    const countsPromise = emailQueue.getJobCounts('waiting', 'active', 'delayed', 'completed', 'failed');
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Queue metrics request timed out')), timeoutMs);
    });

    try {
      const counts = await Promise.race([countsPromise, timeoutPromise]);
      const isPaused = await emailQueue.isPaused();
      return {
        status: 'healthy',
        queueName: EMAIL_QUEUE_NAME,
        isPaused,
        counts,
      };
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  } catch (err) {
    return {
      status: 'unreachable',
      queueName: EMAIL_QUEUE_NAME,
      error: err.message,
    };
  }
};

let queueClosePromise = null;

/**
 * Gracefully closes the queue connection during application shutdown.
 * Prevents duplicate-close operations while propagating errors to the caller.
 * @returns {Promise<void>}
 */
export const closeEmailQueue = async () => {
  if (queueClosePromise) {
    return queueClosePromise;
  }

  queueClosePromise = (async () => {
    try {
      await emailQueue.close();
      console.log(`[BullMQ:${EMAIL_QUEUE_NAME}] Queue connection closed gracefully.`);
    } catch (err) {
      console.error(`[BullMQ:${EMAIL_QUEUE_NAME}] Error closing queue: ${err.message}`);
      throw err;
    }
  })();

  return queueClosePromise;
};
