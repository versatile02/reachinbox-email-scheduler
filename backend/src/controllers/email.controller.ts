import crypto from 'crypto';
import fs from 'fs';
import type { Request, Response } from 'express';
import { emailRepository, EMAIL_STATUSES, DEFAULT_USER_ID } from '../models/email.repository.js';
import { emailQueueService, emailQueue } from '../queues/email.queue.js';
import { elasticsearchService } from '../services/elasticsearch.service.js';
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
    const userId = req.user?.id || DEFAULT_USER_ID;

    // Process uploaded attachments (from multipart/form-data via multer)
    const uploadedFiles = (req.files as Express.Multer.File[]) || [];
    const attachments = uploadedFiles.map((file) => ({
      id: crypto.randomUUID(),
      filename: file.filename,
      originalName: file.originalname,
      mimeType: file.mimetype,
      mimetype: file.mimetype,
      size: file.size,
      path: file.path,
    }));

    // 1. Persist email record in PostgreSQL with 'scheduled' status
    let createdRecord;
    try {
      createdRecord = await emailRepository.createEmail({
        id: emailId,
        userId,
        senderEmail,
        recipient,
        subject,
        body,
        scheduledAt,
        attachments,
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
          attachments,
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

    // 3. Asynchronously index in Elasticsearch
    elasticsearchService.indexEmail(createdRecord).catch(() => {});

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
 * POST /api/emails/bulk
 * Schedules multiple emails or a batch campaign with pacing delay between recipients.
 */
export const scheduleBulkEmails = async (req: Request, res: Response): Promise<Response> => {
  try {
    const {
      recipients,
      emails: customEmailsList,
      senderEmail,
      subject,
      body,
      scheduledAt,
      delayBetweenEmailsMs = 0,
    } = req.body;

    const userId = req.user?.id || DEFAULT_USER_ID;
    const resolvedSender = (senderEmail || config.smtp.from).trim().toLowerCase();
    const scheduledRecords: any[] = [];
    const errors: any[] = [];

    // Case A: Multi-recipient list with shared subject/body and optional pacing delay
    if (Array.isArray(recipients) && recipients.length > 0) {
      if (!subject || typeof subject !== 'string' || subject.trim().length === 0) {
        return res.status(400).json({ error: 'Subject is required for bulk email scheduling' });
      }
      if (!body || typeof body !== 'string' || body.trim().length === 0) {
        return res.status(400).json({ error: 'Body is required for bulk email scheduling' });
      }

      const baseTime = scheduledAt ? new Date(scheduledAt).getTime() : Date.now();
      const stepDelay = Math.max(0, parseInt(String(delayBetweenEmailsMs), 10) || 0);

      for (let i = 0; i < recipients.length; i++) {
        const rawRecipient = recipients[i];
        const recipientEmail = typeof rawRecipient === 'string' ? rawRecipient.trim() : rawRecipient?.email?.trim();

        if (!recipientEmail || !EMAIL_REGEX.test(recipientEmail)) {
          errors.push({ recipient: rawRecipient, error: 'Invalid recipient email format' });
          continue;
        }

        const emailId = crypto.randomUUID();
        const targetTimeMs = Math.max(Date.now(), baseTime + i * stepDelay);
        const emailScheduledAt = new Date(targetTimeMs).toISOString();
        const delayMs = Math.max(0, targetTimeMs - Date.now());

        try {
          const created = await emailRepository.createEmail({
            id: emailId,
            userId,
            senderEmail: resolvedSender,
            recipient: recipientEmail,
            subject: subject.trim(),
            body: String(body),
            scheduledAt: emailScheduledAt,
          });

          await emailQueueService.addScheduledEmailJob(
            {
              id: emailId,
              senderEmail: resolvedSender,
              recipient: recipientEmail,
              subject: subject.trim(),
              body: String(body),
            },
            delayMs,
            emailId
          );

          elasticsearchService.indexEmail(created).catch(() => {});
          scheduledRecords.push(created);
        } catch (itemErr: any) {
          errors.push({ recipient: recipientEmail, error: itemErr.message });
        }
      }
    }
    // Case B: Explicit array of distinct email objects
    else if (Array.isArray(customEmailsList) && customEmailsList.length > 0) {
      for (const item of customEmailsList) {
        const validation = validateSchedulePayload(item);
        if (!validation.valid || !validation.sanitized) {
          errors.push({ payload: item, error: validation.error });
          continue;
        }

        const { id: requestedId, senderEmail: itemSender, recipient, subject: itemSubject, body: itemBody, scheduledAt: itemScheduledAt, delayMs } = validation.sanitized;
        const emailId = requestedId || crypto.randomUUID();

        try {
          const created = await emailRepository.createEmail({
            id: emailId,
            userId,
            senderEmail: itemSender,
            recipient,
            subject: itemSubject,
            body: itemBody,
            scheduledAt: itemScheduledAt,
          });

          await emailQueueService.addScheduledEmailJob(
            {
              id: emailId,
              senderEmail: itemSender,
              recipient,
              subject: itemSubject,
              body: itemBody,
            },
            delayMs,
            emailId
          );

          elasticsearchService.indexEmail(created).catch(() => {});
          scheduledRecords.push(created);
        } catch (itemErr: any) {
          errors.push({ id: emailId, recipient, error: itemErr.message });
        }
      }
    } else {
      return res.status(400).json({
        error: 'Either recipients array or emails array is required for bulk scheduling',
      });
    }

    return res.status(201).json({
      message: `${scheduledRecords.length} email(s) scheduled successfully`,
      count: scheduledRecords.length,
      data: scheduledRecords,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err: any) {
    console.error('[EmailController] Error in scheduleBulkEmails:', err.message);
    return res.status(500).json({ error: 'Failed to process bulk scheduling request', details: err.message });
  }
};

/**
 * GET /api/emails/search
 * Full-text search across subject, body, recipient using Elasticsearch (with PostgreSQL fallback).
 */
export const searchEmails = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { q, query: legacyQuery, status, senderEmail, page, limit } = req.query;
    const queryString = String(q || legacyQuery || '').trim();

    const result = await elasticsearchService.searchEmails({
      query: queryString,
      userId: req.user?.id,
      status: status ? String(status).toLowerCase() : undefined,
      senderEmail: senderEmail ? String(senderEmail).trim() : undefined,
      page: parseInt(String(page || '1'), 10),
      limit: parseInt(String(limit || '20'), 10),
    });

    return res.status(200).json({
      data: result.data,
      pagination: {
        total: result.total,
        page: result.page,
        limit: result.limit,
        totalPages: result.totalPages,
      },
      source: result.source,
    });
  } catch (err: any) {
    console.error('[EmailController] Error searching emails:', err.message);
    return res.status(500).json({ error: 'Search failed', details: err.message });
  }
};

/**
 * POST /api/emails/reindex
 * Bulk reindexes all database emails into Elasticsearch.
 */
export const reindexEmails = async (req: Request, res: Response): Promise<Response> => {
  try {
    const result = await elasticsearchService.reindexAllFromDatabase();
    return res.status(200).json({
      message: 'Reindex completed',
      ...result,
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Reindex failed', details: err.message });
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
      userId: req.user?.id,
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

    const email = await emailRepository.getEmailById(id, req.user?.id);
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

/**
 * GET /api/emails/:id/attachments/:attachmentId
 * Downloads an email attachment securely.
 */
export const downloadAttachment = async (req: Request, res: Response): Promise<void> => {
  try {
    const rawId = req.params.id;
    const rawAttId = req.params.attachmentId;
    const emailId = Array.isArray(rawId) ? rawId[0] : rawId;
    const attachmentId = Array.isArray(rawAttId) ? rawAttId[0] : rawAttId;

    if (!emailId || !UUID_REGEX.test(emailId)) {
      res.status(400).json({ error: 'Invalid email ID: must be a valid UUID' });
      return;
    }

    const email = await emailRepository.getEmailById(emailId, req.user?.id);
    if (!email) {
      res.status(404).json({ error: 'Email record not found' });
      return;
    }

    const att = (email.attachments || []).find(
      (a: any) => a.id === attachmentId || a.filename === attachmentId
    );

    if (!att || !att.path || !fs.existsSync(att.path)) {
      res.status(404).json({ error: 'Attachment file not found on disk' });
      return;
    }

    res.download(att.path, att.originalName || att.filename);
  } catch (err: any) {
    console.error('[EmailController] Attachment download error:', err.message);
    res.status(500).json({ error: 'Failed to download attachment', details: err.message });
  }
};

/**
 * GET /api/emails/:id/preview
 * Renders a full standalone webmail preview of the sent email.
 */
export const previewEmailHtml = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = String(req.params.id || '');
    if (!id) {
      res.status(400).send('<h3>Invalid email ID</h3>');
      return;
    }
    const email = await emailRepository.getEmailById(id);
    if (!email) {
      res.status(404).send('<h2 style="font-family:sans-serif;text-align:center;margin-top:50px;">Email not found</h2>');
      return;
    }

    const dateVal = email.sentAt || email.scheduledAt || email.createdAt || new Date();
    const formattedDate = new Date(dateVal).toLocaleString('en-US', {
      dateStyle: 'full',
      timeStyle: 'medium',
    });

    const isHtml = email.body && email.body.includes('<') && email.body.includes('>');
    const renderedBody = isHtml ? email.body : (email.body || '').replace(/\n/g, '<br/>');

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${email.subject} - ReachInbox Webmail Preview</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #f1f5f9; margin: 0; padding: 24px 16px; color: #0f172a; }
    .email-container { max-width: 720px; margin: 0 auto; background: #ffffff; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.06); border: 1px solid #e2e8f0; overflow: hidden; }
    .email-header { background: #0f172a; color: #ffffff; padding: 20px 24px; }
    .brand-tag { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #10b981; font-weight: 700; margin-bottom: 6px; }
    .email-title { margin: 0; font-size: 20px; font-weight: 700; color: #ffffff; }
    .email-meta { padding: 16px 24px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; font-size: 13px; line-height: 1.8; }
    .meta-row { display: flex; gap: 8px; }
    .meta-label { font-weight: 600; color: #64748b; min-width: 70px; }
    .meta-val { color: #0f172a; word-break: break-all; }
    .status-badge { display: inline-flex; align-items: center; gap: 4px; background: #ecfdf5; color: #059669; padding: 2px 8px; border-radius: 9999px; font-size: 11px; font-weight: 600; }
    .email-body { padding: 28px 24px; font-size: 15px; line-height: 1.6; color: #334155; min-height: 140px; }
    .attachments-section { padding: 16px 24px; background: #f8fafc; border-top: 1px solid #e2e8f0; }
    .att-title { font-size: 12px; font-weight: 700; text-transform: uppercase; color: #64748b; margin-bottom: 8px; }
    .att-item { display: inline-flex; align-items: center; gap: 6px; background: #ffffff; padding: 6px 12px; border-radius: 8px; border: 1px solid #cbd5e1; font-size: 13px; text-decoration: none; color: #0f172a; margin-right: 8px; margin-bottom: 6px; }
    .footer { text-align: center; padding: 16px; font-size: 12px; color: #94a3b8; }
  </style>
</head>
<body>
  <div class="email-container">
    <div class="email-header">
      <div class="brand-tag">ReachInbox Delivery Simulator (250 OK)</div>
      <h1 class="email-title">${email.subject}</h1>
    </div>
    <div class="email-meta">
      <div class="meta-row"><span class="meta-label">From:</span><span class="meta-val">${email.senderEmail}</span></div>
      <div class="meta-row"><span class="meta-label">To:</span><span class="meta-val">${email.recipient}</span></div>
      <div class="meta-row"><span class="meta-label">Date:</span><span class="meta-val">${formattedDate}</span></div>
      <div class="meta-row"><span class="meta-label">Status:</span><span class="status-badge">✓ 250 OK Delivered via BullMQ Worker</span></div>
      <div class="meta-row"><span class="meta-label">ID:</span><span class="meta-val">#${email.id}</span></div>
    </div>
    <div class="email-body">
      ${renderedBody}
    </div>
    ${email.attachments && email.attachments.length > 0 ? `
    <div class="attachments-section">
      <div class="att-title">Attachments (${email.attachments.length})</div>
      ${email.attachments.map((a: any) => `<a class="att-item" href="/api/emails/${email.id}/attachments/${a.id}" target="_blank">📎 ${a.originalName || a.filename} (${a.size ? Math.round(a.size/1024) + ' KB' : 'file'})</a>`).join('')}
    </div>` : ''}
  </div>
  <div class="footer">Captured by ReachInbox Background Worker • Neon PostgreSQL • Upstash Redis Queue</div>
</body>
</html>`);
  } catch (err: any) {
    res.status(500).send(`Failed to render preview: ${err.message}`);
  }
};

/**
 * DELETE /api/emails/:id
 * Deletes an email and removes any active/delayed job from BullMQ.
 */
export const deleteEmailById = async (req: Request, res: Response): Promise<Response> => {
  try {
    const rawId = req.params.id;
    const id = Array.isArray(rawId) ? rawId[0] : rawId;

    if (!id || !UUID_REGEX.test(id)) {
      return res.status(400).json({ error: 'Invalid email ID: must be a valid UUID' });
    }

    try {
      const job = await emailQueue.getJob(id);
      if (job) await job.remove();
    } catch {}

    const deleted = await emailRepository.deleteEmail(id, req.user?.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Email record not found or already deleted' });
    }

    return res.status(200).json({ success: true, message: 'Email deleted successfully' });
  } catch (err: any) {
    console.error('[EmailController] Error deleting email:', err.message);
    return res.status(500).json({ error: 'Failed to delete email', details: err.message });
  }
};

export const emailController = {
  scheduleEmail,
  scheduleBulkEmails,
  searchEmails,
  reindexEmails,
  listEmails,
  getEmailById,
  deleteEmailById,
  downloadAttachment,
  validateSchedulePayload,
  previewEmailHtml,
};

export default emailController;
