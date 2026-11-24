import type { Request, Response } from 'express';
import { emailRepository } from '../models/email.repository.js';
import { config } from '../config/index.js';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * GET /api/senders
 * Returns list of configured senders scoped strictly to the authenticated user.
 */
export const listSenders = async (req: Request, res: Response): Promise<Response> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required to list senders' });
    }

    const senders = await emailRepository.listSenders(userId);
    return res.status(200).json({ data: senders });
  } catch (err: any) {
    console.error('[SenderController] Error listing senders:', err.message);
    return res.status(500).json({ error: 'Failed to retrieve senders', details: err.message });
  }
};

/**
 * POST /api/senders
 * Creates or registers a new sender identity scoped strictly to the authenticated user.
 */
export const createSender = async (req: Request, res: Response): Promise<Response> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required to create a sender' });
    }

    const { email, name, hourlyLimit, minDelaySeconds } = req.body;

    if (!email || typeof email !== 'string' || !EMAIL_REGEX.test(email.trim())) {
      return res.status(400).json({ error: 'A valid email address is required' });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Verify ownership: ensure one user cannot overwrite or hijack another user's sender
    const existing = await emailRepository.getSenderByEmail(normalizedEmail);
    if (existing && existing.userId && existing.userId !== userId) {
      return res.status(409).json({
        error: 'A sender with this email address is already registered by another account',
      });
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
      userId,
      email: normalizedEmail,
      name: name ? String(name).trim() : normalizedEmail.split('@')[0],
      hourlyLimit: resolvedHourlyLimit,
      minDelaySeconds: resolvedMinDelay,
    });

    return res.status(201).json({
      message: 'Sender created successfully',
      data: sender,
    });
  } catch (err: any) {
    if (err.code === '23505' || err.code === '409_CONFLICT_OWNER') {
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
