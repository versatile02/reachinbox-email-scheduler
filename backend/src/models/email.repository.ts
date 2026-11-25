import crypto from 'crypto';
import pg from 'pg';
import { query, pool } from '../config/database.js';
import type {
  EmailRecord,
  CreateEmailInput,
  SenderRecord,
  SlackIntegrationRecord,
  EmailStatus,
  UserRecord,
  UserSessionRecord,
  OutboxEventRecord
} from '../types/index.js';

export const EMAIL_STATUSES: Record<string, EmailStatus> = {
  SCHEDULED: 'scheduled',
  PROCESSING: 'processing',
  SENT: 'sent',
  FAILED: 'failed',
};

export const DEFAULT_USER_ID = '00000000-0000-0000-0000-000000000001';

// ========================================================
// User & Session Repository Operations
// ========================================================

export const getUserById = async (id: string): Promise<UserRecord | null> => {
  const sql = `
    SELECT id, email, name, avatar_url AS "avatarUrl", google_id AS "googleId", password_hash AS "passwordHash", created_at AS "createdAt", updated_at AS "updatedAt"
    FROM users WHERE id = $1;
  `;
  const res = await query(sql, [id]);
  return res.rows[0] || null;
};

export const getUserByEmail = async (email: string): Promise<UserRecord | null> => {
  const sql = `
    SELECT id, email, name, avatar_url AS "avatarUrl", google_id AS "googleId", password_hash AS "passwordHash", created_at AS "createdAt", updated_at AS "updatedAt"
    FROM users WHERE LOWER(email) = LOWER($1);
  `;
  const res = await query(sql, [email.trim()]);
  return res.rows[0] || null;
};

export const getUserByGoogleId = async (googleId: string): Promise<UserRecord | null> => {
  const sql = `
    SELECT id, email, name, avatar_url AS "avatarUrl", google_id AS "googleId", password_hash AS "passwordHash", created_at AS "createdAt", updated_at AS "updatedAt"
    FROM users WHERE google_id = $1;
  `;
  const res = await query(sql, [googleId]);
  return res.rows[0] || null;
};

export const createUser = async (input: {
  id?: string;
  email: string;
  name: string;
  avatarUrl?: string | null;
  googleId?: string | null;
  passwordHash?: string | null;
}): Promise<UserRecord> => {
  const id = input.id || crypto.randomUUID();
  const sql = `
    INSERT INTO users (id, email, name, avatar_url, google_id, password_hash, created_at, updated_at)
    VALUES ($1, LOWER($2), $3, $4, $5, $6, NOW(), NOW())
    ON CONFLICT (email) DO UPDATE SET
      name = EXCLUDED.name,
      avatar_url = COALESCE(EXCLUDED.avatar_url, users.avatar_url),
      google_id = COALESCE(EXCLUDED.google_id, users.google_id),
      password_hash = COALESCE(EXCLUDED.password_hash, users.password_hash),
      updated_at = NOW()
    RETURNING id, email, name, avatar_url AS "avatarUrl", google_id AS "googleId", password_hash AS "passwordHash", created_at AS "createdAt", updated_at AS "updatedAt";
  `;
  const values = [id, input.email.trim(), input.name.trim(), input.avatarUrl || null, input.googleId || null, input.passwordHash || null];
  const res = await query(sql, values);
  return res.rows[0];
};

export const createSession = async (id: string, userId: string, expiresAt: Date): Promise<UserSessionRecord> => {
  const sql = `
    INSERT INTO user_sessions (id, user_id, expires_at, created_at)
    VALUES ($1, $2, $3, NOW())
    RETURNING id, user_id AS "userId", expires_at AS "expiresAt", created_at AS "createdAt";
  `;
  const res = await query(sql, [id, userId, expiresAt]);
  return res.rows[0];
};

export const getSession = async (id: string): Promise<{ session: UserSessionRecord; user: UserRecord } | null> => {
  const sql = `
    SELECT
      s.id, s.user_id AS "userId", s.expires_at AS "expiresAt", s.created_at AS "createdAt",
      u.id AS "u_id", u.email AS "u_email", u.name AS "u_name", u.avatar_url AS "u_avatarUrl", u.google_id AS "u_googleId", u.created_at AS "u_createdAt"
    FROM user_sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.id = $1 AND s.expires_at > NOW();
  `;
  const res = await query(sql, [id]);
  if (!res.rows[0]) return null;
  const row = res.rows[0];
  return {
    session: {
      id: row.id,
      userId: row.userId,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
    },
    user: {
      id: row.u_id,
      email: row.u_email,
      name: row.u_name,
      avatarUrl: row.u_avatarUrl,
      googleId: row.u_googleId,
      createdAt: row.u_createdAt,
    },
  };
};

export const deleteSession = async (id: string): Promise<boolean> => {
  const sql = `DELETE FROM user_sessions WHERE id = $1;`;
  const res = await query(sql, [id]);
  return res.rowCount !== null && res.rowCount > 0;
};

// ========================================================
// Email Repository Operations
// ========================================================

/**
 * Creates and persists a new email record in PostgreSQL.
 */
export const createEmail = async (input: CreateEmailInput): Promise<EmailRecord> => {
  const id = input.id || crypto.randomUUID();
  const userId = input.userId || DEFAULT_USER_ID;
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
      user_id,
      attachments,
      created_at,
      updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, 'scheduler@reachinbox.ai'), $8, $9, COALESCE($10, '[]'::jsonb), NOW(), NOW())
    RETURNING
      id,
      user_id AS "userId",
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
      attachments,
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
    userId,
    JSON.stringify(input.attachments || []),
  ];

  const res = await query(sql, values);
  return res.rows[0];
};

/**
 * Creates an email and a corresponding outbox event within a single database transaction.
 */
export const createEmailWithOutbox = async (input: CreateEmailInput): Promise<{ email: EmailRecord; outboxEventId: string }> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const id = input.id || crypto.randomUUID();
    const userId = input.userId || DEFAULT_USER_ID;
    const senderEmail = input.senderEmail || 'scheduler@reachinbox.ai';
    const senderId = input.senderId || null;

    const emailSql = `
      INSERT INTO emails (
        id, user_id, recipient, subject, body, scheduled_at, status, sender_email, sender_id, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, 'scheduler@reachinbox.ai'), $8, NOW(), NOW())
      RETURNING
        id, user_id AS "userId", sender_email AS "senderEmail", sender_id AS "senderId",
        recipient, subject, body, scheduled_at AS "scheduledAt", status, sent_at AS "sentAt",
        error_message AS "errorMessage", ethereal_preview_url AS "etherealPreviewUrl",
        created_at AS "createdAt", updated_at AS "updatedAt";
    `;
    const emailRes = await client.query(emailSql, [
      id,
      userId,
      input.recipient,
      input.subject,
      input.body,
      new Date(input.scheduledAt),
      EMAIL_STATUSES.SCHEDULED,
      senderEmail,
      senderId,
    ]);
    const email = emailRes.rows[0];

    const outboxId = crypto.randomUUID();
    const outboxSql = `
      INSERT INTO outbox_events (id, email_id, event_type, payload, status, created_at)
      VALUES ($1, $2, 'EMAIL_SCHEDULED', $3, 'pending', NOW())
      RETURNING id;
    `;
    const payload = {
      id: email.id,
      userId: email.userId,
      senderEmail: email.senderEmail,
      recipient: email.recipient,
      subject: email.subject,
      body: email.body,
      scheduledAt: email.scheduledAt,
    };
    const outboxRes = await client.query(outboxSql, [outboxId, email.id, JSON.stringify(payload)]);

    await client.query('COMMIT');
    return { email, outboxEventId: outboxRes.rows[0].id };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

/**
 * Retrieves an email record by its UUID.
 */
export const getEmailById = async (id: string, userId?: string): Promise<EmailRecord | null> => {
  let sql = `
    SELECT
      id,
      user_id AS "userId",
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
      attachments,
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM emails
    WHERE id = $1
  `;
  const params: any[] = [id];
  if (userId) {
    params.push(userId);
    sql += ` AND user_id = $2;`;
  } else {
    sql += `;`;
  }
  const res = await query(sql, params);
  return res.rows[0] || null;
};

/**
 * Lists email records with optional status, sender, and user filtering with pagination.
 */
export const listEmails = async (options: {
  userId?: string;
  status?: string;
  senderEmail?: string;
  search?: string;
  page?: number;
  limit?: number;
} = {}): Promise<{ emails: EmailRecord[]; data: EmailRecord[]; total: number; page: number; limit: number; totalPages: number }> => {
  const page = Math.max(1, options.page || 1);
  const limit = Math.min(100, Math.max(1, options.limit || 20));
  const offset = (page - 1) * limit;

  const conditions: string[] = [];
  const params: any[] = [];

  if (options.userId) {
    params.push(options.userId);
    conditions.push(`user_id = $${params.length}`);
  }

  if (options.status) {
    params.push(options.status);
    conditions.push(`status = $${params.length}`);
  }

  if (options.senderEmail) {
    params.push(options.senderEmail);
    conditions.push(`sender_email = $${params.length}`);
  }

  if (options.search) {
    params.push(`%${options.search.trim()}%`);
    const searchIdx = params.length;
    conditions.push(`(recipient ILIKE $${searchIdx} OR subject ILIKE $${searchIdx} OR body ILIKE $${searchIdx})`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countSql = `SELECT COUNT(*) AS total FROM emails ${whereClause};`;
  const countRes = await query(countSql, params);
  const total = parseInt(countRes.rows[0]?.total || '0', 10);

  const dataSql = `
    SELECT
      id,
      user_id AS "userId",
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
      attachments,
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
  const token = claimToken || crypto.randomUUID();
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
      user_id AS "userId",
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
      attachments,
      claim_token AS "claimToken",
      created_at AS "createdAt",
      updated_at AS "updatedAt";
  `;

  const values = [
    id,
    EMAIL_STATUSES.PROCESSING,
    token,
    EMAIL_STATUSES.SCHEDULED,
    leaseTimeoutSeconds,
  ];

  const res = await query(sql, values);
  return res.rows[0] || null;
};

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
      user_id AS "userId",
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

export const markEmailSent = async (
  id: string,
  dataOrToken: { sentAt?: Date | string; etherealPreviewUrl?: string | null; claimToken?: string | null } | string = {},
  previewUrlParam: string | null = null
): Promise<EmailRecord | null> => {
  let sentAt: Date | string = new Date();
  let etherealPreviewUrl: string | null = null;
  let claimToken: string | null = null;

  if (typeof dataOrToken === 'string') {
    claimToken = dataOrToken;
    etherealPreviewUrl = previewUrlParam;
  } else if (dataOrToken && typeof dataOrToken === 'object') {
    sentAt = dataOrToken.sentAt || new Date();
    etherealPreviewUrl = dataOrToken.etherealPreviewUrl || null;
    claimToken = dataOrToken.claimToken || null;
  }

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
      user_id AS "userId",
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
    sentAt,
    etherealPreviewUrl,
    claimToken ? claimToken.trim() : null,
  ];
  const res = await query(sql, values);
  return res.rows[0] || null;
};

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
    RETURNING
      id,
      user_id AS "userId",
      sender_email AS "senderEmail",
      recipient,
      subject,
      status,
      error_message AS "errorMessage";
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

export const getSenderByEmail = async (email: string, userId?: string): Promise<SenderRecord | null> => {
  let sql = `
    SELECT
      id,
      user_id AS "userId",
      email,
      name,
      hourly_limit AS "hourlyLimit",
      min_delay_seconds AS "minDelaySeconds",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM senders
    WHERE LOWER(email) = LOWER($1)
  `;
  const params: any[] = [email.trim()];
  if (userId) {
    params.push(userId);
    sql += ` AND user_id = $2`;
  }
  sql += ` LIMIT 1;`;
  const res = await query(sql, params);
  return res.rows[0] || null;
};

export const listSenders = async (userId?: string): Promise<SenderRecord[]> => {
  let sql = `
    SELECT
      id,
      user_id AS "userId",
      email,
      name,
      hourly_limit AS "hourlyLimit",
      min_delay_seconds AS "minDelaySeconds",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM senders
  `;
  const params: any[] = [];
  if (userId) {
    params.push(userId);
    sql += ` WHERE user_id = $1`;
  }
  sql += ` ORDER BY name ASC;`;
  const res = await query(sql, params);
  return res.rows;
};

export const createSender = async (input: {
  userId?: string;
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
  const userId = input.userId || DEFAULT_USER_ID;

  // Pre-check ownership if sender already exists
  const existing = await getSenderByEmail(input.email);
  if (existing && existing.userId && existing.userId !== userId) {
    const conflictErr: any = new Error('A sender with this email address is already registered by another account');
    conflictErr.code = '409_CONFLICT_OWNER';
    throw conflictErr;
  }

  const sql = `
    INSERT INTO senders (
      id, user_id, email, name, hourly_limit, min_delay_seconds, smtp_host, smtp_port, smtp_user, smtp_pass_encrypted, created_at, updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
    ON CONFLICT (email) DO UPDATE SET
      name = EXCLUDED.name,
      hourly_limit = EXCLUDED.hourly_limit,
      min_delay_seconds = EXCLUDED.min_delay_seconds,
      updated_at = NOW()
    WHERE senders.user_id = EXCLUDED.user_id
    RETURNING
      id,
      user_id AS "userId",
      email,
      name,
      hourly_limit AS "hourlyLimit",
      min_delay_seconds AS "minDelaySeconds",
      created_at AS "createdAt",
      updated_at AS "updatedAt";
  `;

  const values = [
    id,
    userId,
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
  if (!res.rows[0]) {
    const conflictErr: any = new Error('A sender with this email address is already registered by another account');
    conflictErr.code = '409_CONFLICT_OWNER';
    throw conflictErr;
  }
  return res.rows[0];
};

// ========================================================
// Slack Integration Repository Operations
// ========================================================

export const getSlackIntegration = async (userId?: string): Promise<SlackIntegrationRecord | null> => {
  let sql = `
    SELECT
      id,
      user_id AS "userId",
      team_id AS "teamId",
      team_name AS "teamName",
      channel_id AS "channelId",
      channel_name AS "channelName",
      webhook_url_encrypted AS "webhookUrl",
      access_token_encrypted AS "accessToken",
      authed_user_id AS "authedUserId",
      scope,
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM slack_integrations
  `;
  const params: any[] = [];
  if (userId) {
    params.push(userId);
    sql += ` WHERE user_id = $1`;
  }
  sql += ` ORDER BY created_at DESC LIMIT 1;`;
  const res = await query(sql, params);
  return res.rows[0] || null;
};

export const saveSlackIntegration = async (input: {
  userId?: string;
  teamId?: string;
  teamName?: string;
  channelId?: string;
  channelName?: string;
  webhookUrlEncrypted: string;
  accessTokenEncrypted?: string;
  authedUserId?: string;
  scope?: string;
}): Promise<SlackIntegrationRecord> => {
  const id = crypto.randomUUID();
  const userId = input.userId || DEFAULT_USER_ID;
  const sql = `
    INSERT INTO slack_integrations (
      id, user_id, team_id, team_name, channel_id, channel_name, webhook_url_encrypted, access_token_encrypted, authed_user_id, scope, created_at, updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
    RETURNING
      id,
      user_id AS "userId",
      team_id AS "teamId",
      team_name AS "teamName",
      channel_id AS "channelId",
      channel_name AS "channelName",
      webhook_url_encrypted AS "webhookUrl",
      authed_user_id AS "authedUserId",
      scope,
      created_at AS "createdAt",
      updated_at AS "updatedAt";
  `;

  const values = [
    id,
    userId,
    input.teamId || null,
    input.teamName || null,
    input.channelId || null,
    input.channelName || null,
    input.webhookUrlEncrypted,
    input.accessTokenEncrypted || null,
    input.authedUserId || null,
    input.scope || null,
  ];

  const res = await query(sql, values);
  return res.rows[0];
};

export const deleteSlackIntegration = async (userId?: string): Promise<boolean> => {
  let sql = `DELETE FROM slack_integrations`;
  const params: any[] = [];
  if (userId) {
    params.push(userId);
    sql += ` WHERE user_id = $1`;
  }
  sql += `;`;
  const res = await query(sql, params);
  return res.rowCount !== null && res.rowCount > 0;
};

// ========================================================
// Outbox & Reconciliation Operations
// ========================================================

export const getPendingOutboxEvents = async (limit = 50, client?: pg.PoolClient): Promise<OutboxEventRecord[]> => {
  const sql = `
    SELECT
      id,
      email_id AS "emailId",
      event_type AS "eventType",
      payload,
      status,
      attempts,
      last_attempt_at AS "lastAttemptAt",
      error_message AS "errorMessage",
      created_at AS "createdAt",
      published_at AS "publishedAt"
    FROM outbox_events
    WHERE status = 'pending' AND attempts < 10
    ORDER BY created_at ASC
    LIMIT $1
    FOR UPDATE SKIP LOCKED;
  `;
  const res = client ? await client.query(sql, [limit]) : await query(sql, [limit]);
  return res.rows;
};

export const markOutboxPublished = async (id: string, client?: pg.PoolClient): Promise<void> => {
  const sql = `
    UPDATE outbox_events
    SET status = 'published', published_at = NOW(), error_message = NULL
    WHERE id = $1;
  `;
  if (client) {
    await client.query(sql, [id]);
  } else {
    await query(sql, [id]);
  }
};

export const markOutboxFailed = async (id: string, errorMessage: string, client?: pg.PoolClient): Promise<void> => {
  const sql = `
    UPDATE outbox_events
    SET attempts = attempts + 1, last_attempt_at = NOW(), error_message = $2
    WHERE id = $1;
  `;
  if (client) {
    await client.query(sql, [id, errorMessage]);
  } else {
    await query(sql, [id, errorMessage]);
  }
};

export const getScheduledEmailsForReconciliation = async (): Promise<EmailRecord[]> => {
  const sql = `
    SELECT
      id,
      user_id AS "userId",
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
    WHERE status = 'scheduled'
    ORDER BY scheduled_at ASC
    LIMIT 500;
  `;
  const res = await query(sql);
  return res.rows;
};

// ========================================================
// OAuth States Operations (CSRF validation)
// ========================================================

export const saveOAuthState = async (
  state: string,
  provider: string,
  redirectUrl?: string,
  userId?: string
): Promise<void> => {
  const sql = `
    INSERT INTO oauth_states (state, provider, redirect_url, user_id, expires_at, created_at)
    VALUES ($1, $2, $3, $4, NOW() + INTERVAL '15 minutes', NOW())
    ON CONFLICT (state) DO UPDATE SET
      redirect_url = EXCLUDED.redirect_url,
      expires_at = NOW() + INTERVAL '15 minutes';
  `;
  await query(sql, [state, provider, redirectUrl || null, userId || null]);
};

export const verifyAndConsumeOAuthState = async (
  state: string,
  provider: string
): Promise<{ valid: boolean; redirectUrl?: string; userId?: string }> => {
  const sql = `
    DELETE FROM oauth_states
    WHERE state = $1 AND provider = $2 AND expires_at > NOW()
    RETURNING redirect_url AS "redirectUrl", user_id AS "userId";
  `;
  const res = await query(sql, [state, provider]);
  if (!res.rows[0]) {
    return { valid: false };
  }
  return {
    valid: true,
    redirectUrl: res.rows[0].redirectUrl || undefined,
    userId: res.rows[0].userId || undefined,
  };
};

export const deleteEmail = async (id: string, userId?: string): Promise<boolean> => {
  await query('DELETE FROM outbox_events WHERE email_id = $1;', [id]);
  let sql = 'DELETE FROM emails WHERE id = $1';
  const params: any[] = [id];
  if (userId) {
    sql += ' AND user_id = $2';
    params.push(userId);
  }
  const res = await query(sql, params);
  return (res.rowCount ?? 0) > 0;
};

export const emailRepository = {
  getUserById,
  getUserByEmail,
  getUserByGoogleId,
  createUser,
  createSession,
  getSession,
  deleteSession,
  createEmail,
  createEmailWithOutbox,
  getEmailById,
  deleteEmail,
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
  getPendingOutboxEvents,
  markOutboxPublished,
  markOutboxFailed,
  getScheduledEmailsForReconciliation,
  saveOAuthState,
  verifyAndConsumeOAuthState,
};

export default emailRepository;
