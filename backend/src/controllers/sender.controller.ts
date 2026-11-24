import type { Request, Response } from 'express';
import { emailRepository } from '../models/email.repository.js';
import { config } from '../config/index.js';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * GET /api/senders
 * Returns list of configured senders with rate limit configurations.
 */
export const listSenders = async (req: Request, res: Response): Promise<Response> => {
  try {
    const senders = await emailRepository.listSenders();
    return res.status(200).json({ data: senders });
  } catch (err: any) {
    console.error('[SenderController] Error listing senders:', err.message);
    return res.status(500).json({ error: 'Failed to retrieve senders', details: err.message });
  }
};

/**
 * POST /api/senders
 * Creates or registers a new sender identity.
 */
export const createSender = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { email, name, hourlyLimit, minDelaySeconds } = req.body;

    if (!email || typeof email !== 'string' || !EMAIL_REGEX.test(email.trim())) {
      return res.status(400).json({ error: 'A valid email address is required' });
    }

    const resolvedHourlyLimit =
      hourlyLimit !== undefined && Number.isInteger(Number(hourlyLimit)) && Number(hourlyLimit) > 0
        ? Number(hourlyLimit)
        : config.rateLimit.defaultHourlyLimit;

    const resolvedMinDelay =
      minDelaySeconds !== undefined && Number(minDelaySeconds) >= 0
        ? Number(minDelaySeconds)
        : config.rateLimit.defaultMinDelaySeconds;

    const sender = await emailRepository.createSender({
      email: email.trim().toLowerCase(),
      name: name ? String(name).trim() : email.trim().split('@')[0],
      hourlyLimit: resolvedHourlyLimit,
      minDelaySeconds: resolvedMinDelay,
    });

    return res.status(201).json({
      message: 'Sender created successfully',
      data: sender,
    });
  } catch (err: any) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A sender with this email address already exists' });
    }
    console.error('[SenderController] Error creating sender:', err.message);
    return res.status(500).json({ error: 'Failed to create sender', details: err.message });
  }
};

export const senderController = {
  listSenders,
  createSender,
};

export default senderController;
