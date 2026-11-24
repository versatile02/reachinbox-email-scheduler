import { Queue, type JobsOptions, type Job } from 'bullmq';
import { getProducerConnectionOptions } from '../config/redis.js';

export const EMAIL_QUEUE_NAME = 'email-queue';

/**
 * Default options applied to each email job in the queue:
 * - 3 retry attempts with exponential backoff on transient errors
 * - Job retention limits to manage Redis memory consumption
 */
export const defaultEmailJobOptions: JobsOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 5000,
  },
  removeOnComplete: {
    age: 24 * 3600,
    count: 1000,
  },
  removeOnFail: {
    age: 7 * 24 * 3600,
    count: 5000,
  },
};

/**
 * Initialize reusable BullMQ Queue for scheduled emails using producer options.
 */
export const emailQueue = new Queue(EMAIL_QUEUE_NAME, {
  connection: getProducerConnectionOptions() as any,
  defaultJobOptions: defaultEmailJobOptions,
});

emailQueue.on('error', (err: any) => {
  if (process.env.NODE_ENV === 'test') {
    return;
  }
  const errorMessage = err?.message || (typeof err === 'object' ? JSON.stringify(err) : String(err));
  console.error(`[BullMQ:${EMAIL_QUEUE_NAME}] Queue notice: ${errorMessage}`);
});

export interface ScheduledEmailJobData {
  id: string;
  senderEmail?: string;
  recipient: string;
  subject: string;
  body: string;
  attachments?: Array<{
    id: string;
    filename: string;
    originalName?: string;
    mimeType?: string;
    mimetype?: string;
    size: number;
    path: string;
  }>;
  _heartbeatIntervalMs?: number;
}

/**
 * Adds an email job scheduled for delayed execution.
 */
export const addScheduledEmailJob = async (
  emailData: ScheduledEmailJobData,
  delayMs = 0,
  customJobId: string | null = null
): Promise<Job<ScheduledEmailJobData>> => {
  if (typeof delayMs !== 'number' || !Number.isFinite(delayMs) || delayMs < 0) {
    throw new TypeError(
      `Invalid delayMs: expected a finite, non-negative number, received ${typeof delayMs === 'number' ? delayMs : typeof delayMs}`
    );
  }

  if (customJobId !== null && customJobId !== undefined) {
    if (typeof customJobId !== 'string' || customJobId.trim().length === 0) {
      throw new TypeError(
        `Invalid customJobId: expected a non-empty string, received ${typeof customJobId === 'string' ? 'empty string' : typeof customJobId}`
      );
    }
  }

  const options: JobsOptions = {
    delay: Math.floor(delayMs),
  };

  if (typeof customJobId === 'string') {
    options.jobId = customJobId.trim();
  }

  return await emailQueue.add('sendEmail', emailData, options);
};

/**
 * Retrieves current job counts across states.
 */
export const getEmailQueueMetrics = async (timeoutMs = 2000): Promise<{
  status: string;
  queueName: string;
  isPaused?: boolean;
  counts?: any;
  redisStatus?: string;
  message?: string;
  error?: string;
}> => {
  try {
    let timer: NodeJS.Timeout | undefined;
    const countsPromise = (async () => {
      await emailQueue.waitUntilReady();
      const counts = await emailQueue.getJobCounts('waiting', 'active', 'delayed', 'completed', 'failed');
      const isPaused = await emailQueue.isPaused();
      return { counts, isPaused };
    })();

    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Queue metrics request timed out')), timeoutMs);
    });

    try {
      const { counts, isPaused } = await Promise.race([countsPromise, timeoutPromise]);
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
  } catch (err: any) {
    return {
      status: 'unreachable',
      queueName: EMAIL_QUEUE_NAME,
      error: err.message,
    };
  }
};

let queueClosePromise: Promise<void> | null = null;

export const closeEmailQueue = async (): Promise<void> => {
  if (queueClosePromise) {
    return queueClosePromise;
  }

  queueClosePromise = (async () => {
    try {
      await emailQueue.close();
      console.log(`[BullMQ:${EMAIL_QUEUE_NAME}] Queue connection closed gracefully.`);
    } catch (err: any) {
      console.error(`[BullMQ:${EMAIL_QUEUE_NAME}] Error closing queue: ${err.message}`);
      throw err;
    }
  })();

  return queueClosePromise;
};

export const emailQueueService = {
  addScheduledEmailJob,
  getEmailQueueMetrics,
  closeEmailQueue,
};

export default emailQueueService;
