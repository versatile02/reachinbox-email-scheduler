import type { Request, Response } from 'express';
import { getEmailQueueMetrics } from '../queues/email.queue.js';

/**
 * Controller to handle server health checks
 */
export const getHealthStatus = async (req: Request, res: Response): Promise<Response> => {
  const queueMetrics = await getEmailQueueMetrics(1500).catch((err) => ({
    status: 'unreachable',
    error: err.message,
  }));

  const healthData = {
    status: 'ok',
    message: 'ReachInbox Email Scheduler Backend is running',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    environment: process.env.NODE_ENV || 'development',
    queue: queueMetrics,
  };

  return res.status(200).json(healthData);
};

export const healthController = {
  getHealthStatus,
};

export default healthController;
