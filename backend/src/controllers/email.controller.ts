import crypto from 'crypto';
import type { Request, Response } from 'express';
import { emailRepository, EMAIL_STATUSES } from '../models/email.repository.js';
import { emailQueueService } from '../queues/email.queue.js';
import { config } from '../config/index.js';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ValidationResult {
  valid: boolean;
  error?: string;
  sanitized?: {
    id?: string;
    senderEmail: string;
    recipient: string;
    subject: string;
    body: string;
    scheduledAt: string;
    delayMs: number;
  };
}

/**
 * Validates scheduling request payload.
 */
export const validateSchedulePayload = (body: any = {}): ValidationResult => {
  const { id: customId, senderEmail, recipient, subject, body: emailBody, scheduledAt, delayMs } = body;

  // 0. Optional client-provided ID validation
  if (customId !== undefined && customId !== null) {
    if (typeof customId !== 'string' || !UUID_REGEX.test(customId.trim())) {
      return { valid: false, error: 'When provided, id must be a valid UUID' };
    }
  }

  // 1. Recipient validation
  if (!recipient || typeof recipient !== 'string' || !EMAIL_REGEX.test(recipient.trim())) {
    return { valid: false, error: 'Valid recipient email address is required (e.g. user@example.com)' };
  }

  // 2. Sender validation (optional, defaults to config.smtp.from)
  let resolvedSender = config.smtp.from;
  if (senderEmail !== undefined && senderEmail !== null) {
    if (typeof senderEmail !== 'string' || !EMAIL_REGEX.test(senderEmail.trim())) {
      return { valid: false, error: 'When provided, senderEmail must be a valid email address' };
    }
    resolvedSender = senderEmail.trim().toLowerCase();
  }

  // 3. Subject validation
  if (!subject || typeof subject !== 'string' || subject.trim().length === 0) {
    return { valid: false, error: 'Subject is required and cannot be empty' };
  }

  // 4. Body validation
  if (emailBody === undefined || emailBody === null || (typeof emailBody === 'string' && emailBody.trim().length === 0)) {
    return { valid: false, error: 'Body is required and cannot be empty' };
  }

  // 5. Timing validation: accept scheduledAt (ISO 8601 string) or delayMs (numeric)
  let targetDate: Date;
  let computedDelayMs = 0;

  if (scheduledAt !== undefined && scheduledAt !== null) {
    targetDate = new Date(scheduledAt);
    if (Number.isNaN(targetDate.getTime())) {
      return { valid: false, error: 'scheduledAt must be a valid ISO 8601 date string' };
    }

    const now = Date.now();
    const scheduledTime = targetDate.getTime();
    if (scheduledTime < now - 5000) {
      return { valid: false, error: 'scheduledAt must be a future date and time' };
    }

    computedDelayMs = Math.max(0, scheduledTime - now);
  } else if (delayMs !== undefined && delayMs !== null) {
    if (typeof delayMs !== 'number' || !Number.isFinite(delayMs) || delayMs < 0) {
      return { valid: false, error: 'delayMs must be a finite non-negative number in milliseconds' };
    }
    computedDelayMs = Math.floor(delayMs);
    targetDate = new Date(Date.now() + computedDelayMs);
  } else {
    return { valid: false, error: 'Either scheduledAt (ISO 8601 timestamp) or delayMs is required' };
  }

  return {
    valid: true,
    sanitized: {
      id: customId ? customId.trim() : undefined,
      senderEmail: resolvedSender,
      recipient: recipient.trim(),
      subject: subject.trim(),
      body: String(emailBody),
      scheduledAt: targetDate.toISOString(),
      delayMs: computedDelayMs,
    },
  };
};

/**
 * POST /api/emails/schedule
 * Schedules a new email job with PostgreSQL persistence and BullMQ queueing.
 */
export const scheduleEmail = async (req: Request, res: Response): Promise<Response> => {
  try {
    const validation = validateSchedulePayload(req.body);
    if (!validation.valid || !validation.sanitized) {
      return res.status(400).json({ error: validation.error });
    }

    const { id: requestedId, senderEmail, recipient, subject, body, scheduledAt, delayMs } = validation.sanitized;
    const emailId = requestedId || crypto.randomUUID();

    // 1. Persist email record in PostgreSQL with 'scheduled' status
    let createdRecord;
    try {
      createdRecord = await emailRepository.createEmail({
        id: emailId,
        senderEmail,
        recipient,
        subject,
        body,
        scheduledAt,
      });
    } catch (dbErr: any) {
      if (dbErr.code === '23505') {
        console.warn(`[EmailController] Duplicate email ID rejected: ${emailId}`);
        return res.status(409).json({
          error: `An email with ID '${emailId}' has already been scheduled. Duplicate submission rejected.`,
          emailId,
        });
      }
      console.error('[EmailController] Database insertion error:', dbErr.message);
      return res.status(500).json({
        error: 'Failed to persist email record in database',
        details: dbErr.message,
      });
    }

    // 2. Enqueue job into BullMQ with delay and custom idempotency ID
    try {
      await emailQueueService.addScheduledEmailJob(
        {
          id: emailId,
          senderEmail,
          recipient,
          subject,
          body,
        },
        delayMs,
        emailId
      );
    } catch (queueErr: any) {
      console.error('[EmailController] Queue dispatch failed for email', emailId, ':', queueErr.message);

      await emailRepository.markEmailFailed(emailId, `Queue unavailable: ${queueErr.message}`).catch((e: any) => {
        console.error('[EmailController] Failed updating status to failed:', e.message);
      });

      return res.status(503).json({
        error: 'Email scheduling service is currently unavailable. Please try again.',
        details: queueErr.message,
        emailId,
        status: 'failed',
      });
    }

    return res.status(201).json({
      message: 'Email scheduled successfully',
      data: createdRecord,
    });
  } catch (err: any) {
    console.error('[EmailController] Unexpected error in scheduleEmail:', err.message);
    return res.status(500).json({
      error: 'An unexpected internal error occurred while scheduling email',
      details: err.message,
    });
  }
};

/**
 * GET /api/emails
 * Lists emails with optional status and sender filtering and pagination.
 */
export const listEmails = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { status, senderEmail, page, limit } = req.query;

    const normalizedStatus = status ? String(status).toLowerCase() : undefined;
    if (normalizedStatus && !Object.values(EMAIL_STATUSES).includes(normalizedStatus as any)) {
      return res.status(400).json({
        error: `Invalid status filter. Allowed values: ${Object.values(EMAIL_STATUSES).join(', ')}`,
      });
    }

    const result = await emailRepository.listEmails({
      status: normalizedStatus,
      senderEmail: senderEmail ? String(senderEmail).trim() : undefined,
      page: parseInt(String(page || '1'), 10),
      limit: parseInt(String(limit || '20'), 10),
    });

    return res.status(200).json({
      data: (result as any).data || (result as any).emails || [],
      pagination: {
        total: result.total,
        page: result.page,
        limit: result.limit,
        totalPages: result.totalPages,
      },
    });
  } catch (err: any) {
    console.error('[EmailController] Error listing emails:', err.message);
    return res.status(500).json({
      error: 'Failed to retrieve email records',
      details: err.message,
    });
  }
};

/**
 * GET /api/emails/:id
 * Retrieves a single email record by UUID.
 */
export const getEmailById = async (req: Request, res: Response): Promise<Response> => {
  try {
    const rawId = req.params.id;
    const id = Array.isArray(rawId) ? rawId[0] : rawId;

    if (!id || !UUID_REGEX.test(id)) {
      return res.status(400).json({ error: 'Invalid email ID: must be a valid UUID' });
    }

    const email = await emailRepository.getEmailById(id);
    if (!email) {
      return res.status(404).json({ error: `Email record with ID '${id}' not found` });
    }

    return res.status(200).json({ data: email });
  } catch (err: any) {
    console.error(`[EmailController] Error retrieving email:`, err.message);
    return res.status(500).json({
      error: 'Failed to retrieve email record',
      details: err.message,
    });
  }
};

export const emailController = {
  scheduleEmail,
  listEmails,
  getEmailById,
  validateSchedulePayload,
};

export default emailController;
