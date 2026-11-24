import type { Request, Response } from 'express';
import { emailQueue, getEmailQueueMetrics } from '../queues/email.queue.js';
import { query } from '../config/database.js';
import { config } from '../config/index.js';
import { mailerService } from '../services/mailer.service.js';

/**
 * Controller to handle server and worker health checks.
 * Distinguishes API status, Worker status (active workers count),
 * Database connectivity, and SMTP provider.
 */
export const getHealthStatus = async (req: Request, res: Response): Promise<Response> => {
  // 1. Queue Metrics
  const queueMetrics = await getEmailQueueMetrics(1500).catch((err) => ({
    status: 'unreachable',
    error: err.message,
  }));

  // 2. Active BullMQ Workers check
  let workerStatus: { status: 'active' | 'inactive' | 'error'; activeWorkers: number; error?: string } = {
    status: 'inactive',
    activeWorkers: 0,
  };

  try {
    const workers = await emailQueue.getWorkers();
    workerStatus = {
      status: workers.length > 0 ? 'active' : 'inactive',
      activeWorkers: workers.length,
    };
  } catch (err: any) {
    workerStatus = {
      status: 'error',
      activeWorkers: 0,
      error: err.message,
    };
  }

  // 3. Database connectivity check
  const dbStart = Date.now();
  let dbStatus: { status: 'connected' | 'error'; latencyMs?: number; error?: string } = {
    status: 'error',
  };

  try {
    await query('SELECT 1');
    dbStatus = {
      status: 'connected',
      latencyMs: Date.now() - dbStart,
    };
  } catch (err: any) {
    dbStatus = {
      status: 'error',
      error: err.message,
    };
  }

  // 4. SMTP Provider details
  const smtpDetails = {
    provider: config.smtp.provider,
    transportType: mailerService.getTransportType(),
    host: config.smtp.host,
    port: config.smtp.port,
    hasAuth: Boolean(config.smtp.user && config.smtp.pass),
  };

  const healthData = {
    status: dbStatus.status === 'connected' ? 'ok' : 'degraded',
    message: 'ReachInbox Email Scheduler Backend is running',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    environment: process.env.NODE_ENV || 'development',
    api: {
      status: 'ok',
      uptimeSeconds: Math.floor(process.uptime()),
    },
    worker: workerStatus,
    database: dbStatus,
    smtp: smtpDetails,
    queue: queueMetrics,
  };

  const statusCode = dbStatus.status === 'connected' ? 200 : 503;
  return res.status(statusCode).json(healthData);
};

export const healthController = {
  getHealthStatus,
};

export default healthController;
