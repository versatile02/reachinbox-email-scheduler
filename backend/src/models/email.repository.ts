import crypto from 'crypto';
import { query } from '../config/database.js';
import type { EmailRecord, CreateEmailInput, SenderRecord, SlackIntegrationRecord, EmailStatus } from '../types/index.js';

export const EMAIL_STATUSES: Record<string, EmailStatus> = {
  SCHEDULED: 'scheduled',
  PROCESSING: 'processing',
  SENT: 'sent',
  FAILED: 'failed',
};

/**
 * Creates and persists a new email record in PostgreSQL.
 * @param {CreateEmailInput} input
 * @returns {Promise<EmailRecord>}
 */
export const createEmail = async (input: CreateEmailInput): Promise<EmailRecord> => {
  const id = input.id || crypto.randomUUID();
  const senderEmail = input.senderEmail || 'scheduler@reachinbox.ai';
  const senderId = input.senderId || null;
  const sql = `
    INSERT INTO emails (
      id,
      recipient,
      subject,
      body,
      scheduled_at,
      status,
      sender_email,
      sender_id,
      created_at,
      updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, 'scheduler@reachinbox.ai'), $8, NOW(), NOW())
    RETURNING
      id,
      sender_email AS "senderEmail",
      sender_id AS "senderId",
      recipient,
      subject,
      body,
      scheduled_at AS "scheduledAt",
      status,
      sent_at AS "sentAt",
      error_message AS "errorMessage",
      ethereal_preview_url AS "etherealPreviewUrl",
      created_at AS "createdAt",
      updated_at AS "updatedAt";
  `;

  const values = [
    id,
    input.recipient,
    input.subject,
    input.body,
    new Date(input.scheduledAt),
    EMAIL_STATUSES.SCHEDULED,
    senderEmail,
    senderId,
  ];

  const res = await query(sql, values);
  return res.rows[0];
};

/**
 * Retrieves an email record by its UUID.
 * @param {string} id
 * @returns {Promise<EmailRecord|null>}
 */
export const getEmailById = async (id: string): Promise<EmailRecord | null> => {
  const sql = `
    SELECT
      id,
      sender_email AS "senderEmail",
      sender_id AS "senderId",
      recipient,
      subject,
      body,
      scheduled_at AS "scheduledAt",
      status,
      sent_at AS "sentAt",
      error_message AS "errorMessage",
      ethereal_preview_url AS "etherealPreviewUrl",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM emails
    WHERE id = $1;
  `;
  const res = await query(sql, [id]);
  return res.rows[0] || null;
};

/**
 * Lists email records with optional status and sender filtering and pagination.
 */
export const listEmails = async (options: {
  status?: string;
  senderEmail?: string;
  page?: number;
  limit?: number;
} = {}): Promise<{ emails: EmailRecord[]; data: EmailRecord[]; total: number; page: number; limit: number; totalPages: number }> => {
  const page = Math.max(1, options.page || 1);
  const limit = Math.min(100, Math.max(1, options.limit || 20));
  const offset = (page - 1) * limit;

  const conditions: string[] = [];
  const params: any[] = [];

  if (options.status) {
    params.push(options.status);
    conditions.push(`status = $${params.length}`);
  }

  if (options.senderEmail) {
    params.push(options.senderEmail);
    conditions.push(`sender_email = $${params.length}`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countSql = `SELECT COUNT(*) AS total FROM emails ${whereClause};`;
  const countRes = await query(countSql, params);
  const total = parseInt(countRes.rows[0]?.total || '0', 10);

  const dataSql = `
    SELECT
      id,
      sender_email AS "senderEmail",
      sender_id AS "senderId",
      recipient,
      subject,
      body,
      scheduled_at AS "scheduledAt",
      status,
      sent_at AS "sentAt",
      error_message AS "errorMessage",
      ethereal_preview_url AS "etherealPreviewUrl",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM emails
    ${whereClause}
    ORDER BY created_at DESC
    LIMIT $${params.length + 1} OFFSET $${params.length + 2};
  `;

  const dataRes = await query(dataSql, [...params, limit, offset]);

  return {
    emails: dataRes.rows,
    data: dataRes.rows,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit) || 1,
  };
};

/**
 * Atomically marks an email as 'processing' with a bounded lease timeout and a unique claim token.
 */
export const markEmailProcessing = async (
  id: string,
  claimToken: string,
  leaseTimeoutSeconds = 60
): Promise<EmailRecord | null> => {
  const sql = `
    UPDATE emails
    SET
      status = $2,
      claim_token = $3,
      updated_at = NOW()
    WHERE id = $1
      AND (
        status = $4
        OR (status = $2 AND updated_at < NOW() - ($5 * INTERVAL '1 second'))
      )
    RETURNING
      id,
      sender_email AS "senderEmail",
      sender_id AS "senderId",
      recipient,
      subject,
      body,
      scheduled_at AS "scheduledAt",
      status,
      sent_at AS "sentAt",
      error_message AS "errorMessage",
      ethereal_preview_url AS "etherealPreviewUrl",
      created_at AS "createdAt",
      updated_at AS "updatedAt";
  `;

  const values = [
    id,
    EMAIL_STATUSES.PROCESSING,
    claimToken,
    EMAIL_STATUSES.SCHEDULED,
    leaseTimeoutSeconds,
  ];

  const res = await query(sql, values);
  return res.rows[0] || null;
};

/**
 * Renews the lease timestamp on a record currently in 'processing' status.
 * Enforces claim token ownership. Returns false if token was superseded or null.
 */
export const touchEmailProcessing = async (id: string, claimToken: string | null | undefined): Promise<boolean> => {
  if (!claimToken || typeof claimToken !== 'string') {
    return false;
  }
  const sql = `
    UPDATE emails
    SET updated_at = NOW()
    WHERE id = $1 AND status = $2 AND claim_token = $3
    RETURNING id;
  `;
  const res = await query(sql, [id, EMAIL_STATUSES.PROCESSING, claimToken.trim()]);
  const hasRows = Array.isArray(res.rows) && res.rows.length > 0;
  const hasCount = typeof res.rowCount === 'number' && res.rowCount > 0;
  return hasRows || hasCount;
};

/**
 * Reschedules a job into the next window after rate-limiting.
 * Resets status to 'scheduled', updates scheduled_at, and releases claim_token.
 */
export const markEmailReschedule = async (
  id: string,
  claimToken: string,
  nextScheduledAt: Date | string
): Promise<EmailRecord | null> => {
  const sql = `
    UPDATE emails
    SET
      status = $2,
      scheduled_at = $3,
      claim_token = NULL,
      updated_at = NOW()
    WHERE id = $1 AND claim_token = $4
    RETURNING
      id,
      sender_email AS "senderEmail",
      sender_id AS "senderId",
      recipient,
      subject,
      status,
      scheduled_at AS "scheduledAt";
  `;

  const values = [id, EMAIL_STATUSES.SCHEDULED, nextScheduledAt, claimToken];
  const res = await query(sql, values);
  return res.rows[0] || null;
};

/**
 * Releases a processing claim back to 'scheduled' status upon a non-final attempt failure.
 */
export const markEmailRetry = async (
  id: string,
  errorMessage: string,
  claimToken: string | null = null
): Promise<EmailRecord | null> => {
  const sql = `
    UPDATE emails
    SET
      status = $2,
      error_message = $3,
      claim_token = NULL,
      updated_at = NOW()
    WHERE id = $1 AND status = $4 AND (claim_token = $5 OR $5 IS NULL)
    RETURNING id, status, error_message AS "errorMessage";
  `;

  const values = [
    id,
    EMAIL_STATUSES.SCHEDULED,
    errorMessage,
    EMAIL_STATUSES.PROCESSING,
    claimToken ? claimToken.trim() : null,
  ];
  const res = await query(sql, values);
  return res.rows[0] || null;
};

/**
 * Transitions an email record to 'sent' status with delivery metadata.
 * Validates matching claimToken and clears claim_token to NULL.
 */
export const markEmailSent = async (
  id: string,
  data: { sentAt?: Date | string; etherealPreviewUrl?: string | null; claimToken?: string | null } = {}
): Promise<EmailRecord | null> => {
  const sql = `
    UPDATE emails
    SET
      status = $2,
      sent_at = $3,
      ethereal_preview_url = $4,
      claim_token = NULL,
      error_message = NULL,
      updated_at = NOW()
    WHERE id = $1 AND (claim_token = $5 OR $5 IS NULL)
    RETURNING
      id,
      sender_email AS "senderEmail",
      recipient,
      subject,
      status,
      sent_at AS "sentAt",
      ethereal_preview_url AS "etherealPreviewUrl";
  `;

  const values = [
    id,
    EMAIL_STATUSES.SENT,
    data.sentAt || new Date(),
    data.etherealPreviewUrl || null,
    data.claimToken ? data.claimToken.trim() : null,
  ];
  const res = await query(sql, values);
  return res.rows[0] || null;
};

/**
 * Marks an email as permanently 'failed' when all retry attempts are exhausted.
 */
export const markEmailFailed = async (
  id: string,
  errorMessage: string,
  claimToken: string | null = null
): Promise<EmailRecord | null> => {
  const sql = `
    UPDATE emails
    SET
      status = $2,
      error_message = $3,
      claim_token = NULL,
      updated_at = NOW()
    WHERE id = $1 AND (claim_token = $4 OR $4 IS NULL)
    RETURNING id, status, error_message AS "errorMessage";
  `;

  const values = [
    id,
    EMAIL_STATUSES.FAILED,
    errorMessage,
    claimToken ? claimToken.trim() : null,
  ];
  const res = await query(sql, values);
  return res.rows[0] || null;
};

// ========================================================
// Sender Repository Operations
// ========================================================

export const getSenderByEmail = async (email: string): Promise<SenderRecord | null> => {
  const sql = `
    SELECT
      id,
      email,
      name,
      hourly_limit AS "hourlyLimit",
      min_delay_seconds AS "minDelaySeconds",
      smtp_host AS "smtpHost",
      smtp_port AS "smtpPort",
      smtp_user AS "smtpUser",
      smtp_pass_encrypted AS "smtpPassEncrypted",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM senders
    WHERE email = $1;
  `;
  const res = await query(sql, [email.trim().toLowerCase()]);
  return res.rows[0] || null;
};

export const listSenders = async (): Promise<SenderRecord[]> => {
  const sql = `
    SELECT
      id,
      email,
      name,
      hourly_limit AS "hourlyLimit",
      min_delay_seconds AS "minDelaySeconds",
      smtp_host AS "smtpHost",
      smtp_port AS "smtpPort",
      smtp_user AS "smtpUser",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM senders
    ORDER BY created_at ASC;
  `;
  const res = await query(sql);
  return res.rows;
};

export const createSender = async (input: {
  email: string;
  name: string;
  hourlyLimit?: number;
  minDelaySeconds?: number;
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPassEncrypted?: string;
}): Promise<SenderRecord> => {
  const id = crypto.randomUUID();
  const sql = `
    INSERT INTO senders (
      id, email, name, hourly_limit, min_delay_seconds, smtp_host, smtp_port, smtp_user, smtp_pass_encrypted, created_at, updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
    ON CONFLICT (email) DO UPDATE SET
      name = EXCLUDED.name,
      hourly_limit = EXCLUDED.hourly_limit,
      min_delay_seconds = EXCLUDED.min_delay_seconds,
      updated_at = NOW()
    RETURNING
      id,
      email,
      name,
      hourly_limit AS "hourlyLimit",
      min_delay_seconds AS "minDelaySeconds",
      created_at AS "createdAt",
      updated_at AS "updatedAt";
  `;

  const values = [
    id,
    input.email.trim().toLowerCase(),
    input.name.trim(),
    input.hourlyLimit || 200,
    input.minDelaySeconds || 2,
    input.smtpHost || null,
    input.smtpPort || null,
    input.smtpUser || null,
    input.smtpPassEncrypted || null,
  ];

  const res = await query(sql, values);
  return res.rows[0];
};

// ========================================================
// Slack Integration Repository Operations
// ========================================================

export const getSlackIntegration = async (): Promise<SlackIntegrationRecord | null> => {
  const sql = `
    SELECT
      id,
      team_id AS "teamId",
      team_name AS "teamName",
      channel_id AS "channelId",
      channel_name AS "channelName",
      webhook_url_encrypted AS "webhookUrl",
      access_token_encrypted AS "accessToken",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM slack_integrations
    ORDER BY created_at DESC
    LIMIT 1;
  `;
  const res = await query(sql);
  return res.rows[0] || null;
};

export const saveSlackIntegration = async (input: {
  teamId?: string;
  teamName?: string;
  channelId?: string;
  channelName?: string;
  webhookUrlEncrypted: string;
  accessTokenEncrypted?: string;
}): Promise<SlackIntegrationRecord> => {
  const id = crypto.randomUUID();
  const sql = `
    INSERT INTO slack_integrations (
      id, team_id, team_name, channel_id, channel_name, webhook_url_encrypted, access_token_encrypted, created_at, updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
    RETURNING
      id,
      team_id AS "teamId",
      team_name AS "teamName",
      channel_id AS "channelId",
      channel_name AS "channelName",
      webhook_url_encrypted AS "webhookUrl",
      created_at AS "createdAt",
      updated_at AS "updatedAt";
  `;

  const values = [
    id,
    input.teamId || null,
    input.teamName || null,
    input.channelId || null,
    input.channelName || null,
    input.webhookUrlEncrypted,
    input.accessTokenEncrypted || null,
  ];

  const res = await query(sql, values);
  return res.rows[0];
};

export const deleteSlackIntegration = async (): Promise<boolean> => {
  const sql = `DELETE FROM slack_integrations;`;
  const res = await query(sql);
  return res.rowCount !== null && res.rowCount > 0;
};

export const emailRepository = {
  createEmail,
  getEmailById,
  listEmails,
  markEmailProcessing,
  touchEmailProcessing,
  markEmailReschedule,
  markEmailRetry,
  markEmailSent,
  markEmailFailed,
  getSenderByEmail,
  listSenders,
  createSender,
  getSlackIntegration,
  saveSlackIntegration,
  deleteSlackIntegration,
};

export default emailRepository;
