import crypto from 'crypto';
import { query } from '../config/database.js';

export const EMAIL_STATUSES = {
  SCHEDULED: 'scheduled',
  PROCESSING: 'processing',
  SENT: 'sent',
  FAILED: 'failed',
};

/**
 * Creates a new email record in the database.
 * @param {Object} emailData
 * @param {string} emailData.id - Unique UUID identifier
 * @param {string} emailData.recipient - Recipient email address
 * @param {string} emailData.subject - Email subject line
 * @param {string} emailData.body - Email content body
 * @param {Date|string} emailData.scheduledAt - Target dispatch timestamp
 * @returns {Promise<Object>} The created email record
 */
export async function createEmail({ id, recipient, subject, body, scheduledAt }) {
  const sql = `
    INSERT INTO emails (id, recipient, subject, body, scheduled_at, status, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
    RETURNING
      id,
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
  const params = [id, recipient, subject, body, new Date(scheduledAt), EMAIL_STATUSES.SCHEDULED];
  const { rows } = await query(sql, params);
  return rows[0];
}

/**
 * Retrieves a single email record by its UUID.
 * @param {string} id - Email record UUID
 * @returns {Promise<Object|null>}
 */
export async function getEmailById(id) {
  const sql = `
    SELECT
      id,
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
  const { rows } = await query(sql, [id]);
  return rows[0] || null;
}

/**
 * Retrieves a paginated list of email records with optional status filtering.
 * @param {Object} options
 * @param {string} [options.status] - Optional status filter (scheduled, processing, sent, failed)
 * @param {number} [options.page=1] - 1-based page index
 * @param {number} [options.limit=20] - Records per page
 * @returns {Promise<{ emails: Array, total: number, page: number, limit: number, totalPages: number }>}
 */
export async function listEmails({ status, page = 1, limit = 20 } = {}) {
  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const safeLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const offset = (safePage - 1) * safeLimit;

  const conditions = [];
  const params = [];

  if (status && Object.values(EMAIL_STATUSES).includes(status.toLowerCase())) {
    params.push(status.toLowerCase());
    conditions.push(`status = $${params.length}`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Get total count matching criteria
  const countSql = `SELECT COUNT(*) AS total FROM emails ${whereClause};`;
  const countResult = await query(countSql, params);
  const total = parseInt(countResult.rows[0].total, 10);

  // Get paginated rows
  const listParams = [...params, safeLimit, offset];
  const listSql = `
    SELECT
      id,
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
    ORDER BY scheduled_at ASC, created_at DESC
    LIMIT $${params.length + 1} OFFSET $${params.length + 2};
  `;

  const { rows } = await query(listSql, listParams);
  const totalPages = Math.ceil(total / safeLimit) || 1;

  return {
    emails: rows,
    total,
    page: safePage,
    limit: safeLimit,
    totalPages,
  };
}

/**
 * Atomically marks an email as 'processing' if it is currently 'scheduled'
 * or if it was previously claimed by a worker that crashed (stale lock recovery).
 * Assigns a unique claim ownership token to prevent zombie workers from renewing
 * or overwriting the lease.
 *
 * @param {string} id - Email record UUID
 * @param {string} [claimToken] - Unique ownership token (auto-generated if omitted)
 * @param {number} [leaseTimeoutSeconds=60] - Maximum duration in seconds a processing lease remains valid without heartbeat
 * @returns {Promise<Object|null>} Updated record if transition was acquired, null otherwise
 */
export async function markEmailProcessing(id, claimToken = null, leaseTimeoutSeconds = 60) {
  const token = claimToken || crypto.randomUUID();
  const safeTimeout = Math.max(10, parseInt(leaseTimeoutSeconds, 10) || 60);

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
      recipient,
      subject,
      body,
      scheduled_at AS "scheduledAt",
      status,
      claim_token AS "claimToken";
  `;
  const { rows } = await query(sql, [id, EMAIL_STATUSES.PROCESSING, token, EMAIL_STATUSES.SCHEDULED, safeTimeout]);
  return rows[0] || null;
}

/**
 * Renews the processing lease heartbeat for an actively executing email job.
 * Strictly verifies lease ownership token: a stale worker whose claim was superseded
 * cannot renew another worker's lease.
 *
 * @param {string} id - Email record UUID
 * @param {string} claimToken - Ownership token assigned when job was claimed
 * @returns {Promise<boolean>} True if heartbeat was updated, false if lease was lost or expired
 */
export async function touchEmailProcessing(id, claimToken) {
  if (!claimToken || typeof claimToken !== 'string') {
    return false;
  }

  const sql = `
    UPDATE emails
    SET updated_at = NOW()
    WHERE id = $1 AND status = $2 AND claim_token = $3
    RETURNING id;
  `;
  const { rows } = await query(sql, [id, EMAIL_STATUSES.PROCESSING, claimToken.trim()]);
  return rows.length > 0;
}

/**
 * Releases a 'processing' claim back to 'scheduled' status following a non-final attempt failure.
 * Clears the claim token. Verifies token ownership so a stale worker cannot reset a newer worker's active claim.
 *
 * @param {string} id - Email record UUID
 * @param {string} errorMessage - Error diagnostic from the failed attempt
 * @param {string} [claimToken] - Optional ownership token to fence against stale workers
 * @returns {Promise<Object|null>}
 */
export async function markEmailRetry(id, errorMessage, claimToken = null) {
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
  const { rows } = await query(sql, [
    id,
    EMAIL_STATUSES.SCHEDULED,
    errorMessage,
    EMAIL_STATUSES.PROCESSING,
    claimToken ? claimToken.trim() : null,
  ]);
  return rows[0] || null;
}

/**
 * Updates an email record to 'sent' status with delivery metadata.
 * Clears the claim token upon completion. Verifies token ownership if supplied.
 *
 * @param {string} id - Email record UUID
 * @param {Object} deliveryData
 * @param {Date} [deliveryData.sentAt]
 * @param {string} [deliveryData.etherealPreviewUrl]
 * @param {string} [deliveryData.claimToken] - Optional ownership token for fencing
 * @returns {Promise<Object|null>}
 */
export async function markEmailSent(id, { sentAt = new Date(), etherealPreviewUrl = null, claimToken = null } = {}) {
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
      recipient,
      subject,
      status,
      sent_at AS "sentAt",
      ethereal_preview_url AS "etherealPreviewUrl";
  `;
  const { rows } = await query(sql, [
    id,
    EMAIL_STATUSES.SENT,
    sentAt,
    etherealPreviewUrl,
    claimToken ? claimToken.trim() : null,
  ]);
  return rows[0] || null;
}

/**
 * Marks an email as 'failed' with error diagnostics.
 * Clears the claim token upon final failure.
 *
 * @param {string} id - Email record UUID
 * @param {string} errorMessage - Error description
 * @param {string} [claimToken] - Optional ownership token for fencing
 * @returns {Promise<Object|null>}
 */
export async function markEmailFailed(id, errorMessage, claimToken = null) {
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
  const { rows } = await query(sql, [
    id,
    EMAIL_STATUSES.FAILED,
    errorMessage,
    claimToken ? claimToken.trim() : null,
  ]);
  return rows[0] || null;
}

export const emailRepository = {
  createEmail,
  getEmailById,
  listEmails,
  markEmailProcessing,
  touchEmailProcessing,
  markEmailRetry,
  markEmailSent,
  markEmailFailed,
};

export default emailRepository;
