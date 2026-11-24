import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  createEmail,
  getEmailById,
  listEmails,
  markEmailProcessing,
  touchEmailProcessing,
  markEmailRetry,
  markEmailSent,
  markEmailFailed,
  EMAIL_STATUSES,
} from '../src/models/email.repository.js';
import { pool, isDatabaseConfigured } from '../src/config/database.js';

describe('Email Repository Unit Tests', () => {
  let capturedQuery;
  let capturedParams;
  let originalQuery;

  beforeEach(() => {
    capturedQuery = null;
    capturedParams = null;
    originalQuery = pool.query;
  });

  test('createEmail executes parameterized INSERT and returns camelCased record', async () => {
    pool.query = async (sql, params) => {
      capturedQuery = sql;
      capturedParams = params;
      return {
        rows: [
          {
            id: params[0],
            recipient: params[1],
            subject: params[2],
            body: params[3],
            scheduledAt: params[4],
            status: params[5],
            sentAt: null,
            errorMessage: null,
            etherealPreviewUrl: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      };
    };

    const targetDate = new Date(Date.now() + 10000);
    const email = await createEmail({
      id: '11111111-1111-1111-1111-111111111111',
      recipient: 'user@example.com',
      subject: 'Test Subject',
      body: 'Test Body',
      scheduledAt: targetDate,
    });

    assert.match(capturedQuery, /INSERT INTO emails/i);
    assert.equal(capturedParams[0], '11111111-1111-1111-1111-111111111111');
    assert.equal(capturedParams[1], 'user@example.com');
    assert.equal(capturedParams[5], EMAIL_STATUSES.SCHEDULED);
    assert.equal(email.status, 'scheduled');
  });

  test('getEmailById queries by UUID and returns null when not found', async () => {
    pool.query = async (sql, params) => {
      capturedQuery = sql;
      capturedParams = params;
      return { rows: [] };
    };

    const email = await getEmailById('22222222-2222-2222-2222-222222222222');
    assert.ok(capturedQuery.includes('FROM emails'));
    assert.ok(capturedQuery.includes('WHERE id = $1'));
    assert.equal(capturedParams[0], '22222222-2222-2222-2222-222222222222');
    assert.equal(email, null);
  });

  test('listEmails supports pagination and status filtering', async () => {
    let callCount = 0;
    pool.query = async (sql, params) => {
      callCount++;
      if (sql.includes('COUNT(*)')) {
        return { rows: [{ total: '1' }] };
      }
      return {
        rows: [
          {
            id: '33333333-3333-3333-3333-333333333333',
            recipient: 'test@example.com',
            status: 'sent',
          },
        ],
      };
    };

    const result = await listEmails({ status: 'sent', page: 2, limit: 10 });
    assert.equal(result.total, 1);
    assert.equal(result.page, 2);
    assert.equal(result.limit, 10);
    assert.equal(result.emails.length, 1);
  });

  test('markEmailProcessing applies atomic concurrency guard with parameterized lease timeout and claim token', async () => {
    pool.query = async (sql, params) => {
      capturedQuery = sql;
      capturedParams = params;
      return {
        rows: [
          {
            id: params[0],
            status: params[1],
            claimToken: params[2],
          },
        ],
      };
    };

    const token = 'token-uuid-12345';
    const res = await markEmailProcessing('44444444-4444-4444-4444-444444444444', token, 60);
    assert.ok(capturedQuery.includes('WHERE id = $1'));
    assert.ok(capturedQuery.includes('claim_token = $3'));
    assert.ok(capturedQuery.includes('status = $4'));
    assert.ok(capturedQuery.includes("updated_at < NOW() - ($5 * INTERVAL '1 second')"));
    assert.equal(capturedParams[1], EMAIL_STATUSES.PROCESSING);
    assert.equal(capturedParams[2], token);
    assert.equal(capturedParams[3], EMAIL_STATUSES.SCHEDULED);
    assert.equal(capturedParams[4], 60);
    assert.equal(res.status, 'processing');
  });

  test('touchEmailProcessing verifies claim token ownership and rejects stale tokens', async () => {
    let touchedParams = null;
    pool.query = async (sql, params) => {
      capturedQuery = sql;
      touchedParams = params;
      if (params[2] === 'valid-active-token') {
        return { rows: [{ id: params[0] }] };
      }
      return { rows: [] }; // Stale token matches zero rows
    };

    // Valid active token succeeds
    const success = await touchEmailProcessing('44444444-4444-4444-4444-444444444444', 'valid-active-token');
    assert.ok(capturedQuery.includes('UPDATE emails'));
    assert.ok(capturedQuery.includes('SET updated_at = NOW()'));
    assert.ok(capturedQuery.includes('WHERE id = $1 AND status = $2 AND claim_token = $3'));
    assert.equal(touchedParams[0], '44444444-4444-4444-4444-444444444444');
    assert.equal(touchedParams[1], EMAIL_STATUSES.PROCESSING);
    assert.equal(touchedParams[2], 'valid-active-token');
    assert.equal(success, true);

    // Stale token from superseded worker fails
    const staleSuccess = await touchEmailProcessing('44444444-4444-4444-4444-444444444444', 'stale-superseded-token');
    assert.equal(staleSuccess, false, 'Stale token must not renew lease');

    // Missing token fails fast without query
    const missingSuccess = await touchEmailProcessing('44444444-4444-4444-4444-444444444444', null);
    assert.equal(missingSuccess, false);
  });

  test('markEmailRetry resets processing claim back to scheduled and clears claim_token', async () => {
    pool.query = async (sql, params) => {
      capturedQuery = sql;
      capturedParams = params;
      return {
        rows: [
          {
            id: params[0],
            status: params[1],
            errorMessage: params[2],
          },
        ],
      };
    };

    const res = await markEmailRetry('77777777-7777-7777-7777-777777777777', 'SMTP connection timeout', 'retry-token-123');
    assert.ok(capturedQuery.includes('WHERE id = $1 AND status = $4 AND (claim_token = $5 OR $5 IS NULL)'));
    assert.ok(capturedQuery.includes('claim_token = NULL'));
    assert.equal(capturedParams[1], EMAIL_STATUSES.SCHEDULED);
    assert.equal(capturedParams[2], 'SMTP connection timeout');
    assert.equal(capturedParams[3], EMAIL_STATUSES.PROCESSING);
    assert.equal(capturedParams[4], 'retry-token-123');
    assert.equal(res.status, 'scheduled');
  });

  test('markEmailSent updates status to sent with metadata and verifies claim_token', async () => {
    pool.query = async (sql, params) => {
      capturedQuery = sql;
      capturedParams = params;
      return {
        rows: [
          {
            id: params[0],
            status: params[1],
            etherealPreviewUrl: params[3],
          },
        ],
      };
    };

    const preview = 'https://ethereal.email/message/test';
    const res = await markEmailSent('55555555-5555-5555-5555-555555555555', {
      etherealPreviewUrl: preview,
      claimToken: 'sent-token-123',
    });

    assert.ok(capturedQuery.includes('WHERE id = $1 AND (claim_token = $5 OR $5 IS NULL)'));
    assert.ok(capturedQuery.includes('claim_token = NULL'));
    assert.equal(capturedParams[1], EMAIL_STATUSES.SENT);
    assert.equal(capturedParams[3], preview);
    assert.equal(capturedParams[4], 'sent-token-123');
    assert.equal(res.status, 'sent');
  });

  test('markEmailFailed updates status to failed with error message and clears claim_token', async () => {
    pool.query = async (sql, params) => {
      capturedQuery = sql;
      capturedParams = params;
      return {
        rows: [
          {
            id: params[0],
            status: params[1],
            errorMessage: params[2],
          },
        ],
      };
    };

    const res = await markEmailFailed('66666666-6666-6666-6666-666666666666', 'SMTP timeout', 'failed-token-123');
    assert.ok(capturedQuery.includes('WHERE id = $1 AND (claim_token = $4 OR $4 IS NULL)'));
    assert.ok(capturedQuery.includes('claim_token = NULL'));
    assert.equal(capturedParams[1], EMAIL_STATUSES.FAILED);
    assert.equal(capturedParams[2], 'SMTP timeout');
    assert.equal(capturedParams[3], 'failed-token-123');
    assert.equal(res.status, 'failed');
  });
});
