process.env.NODE_ENV = 'test';

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import app from '../src/app.js';
import { emailRepository } from '../src/models/email.repository.js';
import { emailQueueService, closeEmailQueue } from '../src/queues/email.queue.js';
import { closeDatabasePool } from '../src/config/database.js';

let server;
let baseUrl;

// Helper to make JSON HTTP requests
const request = ({ method, path, body }) => {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const req = http.request(
      url,
      {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
      },
      (res) => {
        let rawData = '';
        res.on('data', (chunk) => {
          rawData += chunk;
        });
        res.on('end', () => {
          try {
            const parsed = rawData ? JSON.parse(rawData) : {};
            resolve({ status: res.statusCode, headers: res.headers, body: parsed });
          } catch {
            resolve({ status: res.statusCode, headers: res.headers, text: rawData });
          }
        });
      }
    );

    req.on('error', reject);

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
};

describe('API Endpoints - /api/emails', () => {
  before(async () => {
    server = app.listen(0);
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    // Clean up lingering queue and pool handles so test process exits cleanly
    await closeEmailQueue().catch(() => {});
    await closeDatabasePool().catch(() => {});
  });

  describe('POST /api/emails/schedule', () => {
    test('Returns 400 when recipient is missing or invalid', async () => {
      const res = await request({
        method: 'POST',
        path: '/api/emails/schedule',
        body: { subject: 'Test', body: 'Hello', delayMs: 1000 },
      });

      assert.equal(res.status, 400);
      assert.match(res.body.error, /recipient/i);
    });

    test('Returns 400 when subject is missing or empty', async () => {
      const res = await request({
        method: 'POST',
        path: '/api/emails/schedule',
        body: { recipient: 'user@example.com', subject: '   ', body: 'Hello', delayMs: 1000 },
      });

      assert.equal(res.status, 400);
      assert.match(res.body.error, /subject/i);
    });

    test('Returns 400 when scheduledAt is in the past', async () => {
      const res = await request({
        method: 'POST',
        path: '/api/emails/schedule',
        body: {
          recipient: 'user@example.com',
          subject: 'Past',
          body: 'Hello',
          scheduledAt: new Date(Date.now() - 30000).toISOString(),
        },
      });

      assert.equal(res.status, 400);
      assert.match(res.body.error, /future date/i);
    });

    test('Returns 201 when payload is valid and persistence + queue succeed', async () => {
      emailRepository.createEmail = async (data) => ({
        ...data,
        status: 'scheduled',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      emailQueueService.addScheduledEmailJob = async () => ({
        id: 'job-success-1',
      });

      const res = await request({
        method: 'POST',
        path: '/api/emails/schedule',
        body: {
          recipient: 'developer@reachinbox.ai',
          subject: 'Assignment Completed',
          body: 'Here is the completed Task 2.2 implementation.',
          delayMs: 5000,
        },
      });

      assert.equal(res.status, 201);
      assert.equal(res.body.message, 'Email scheduled successfully');
      assert.equal(res.body.data.recipient, 'developer@reachinbox.ai');
      assert.equal(res.body.data.status, 'scheduled');
    });

    test('Returns 503 and marks email as failed when queue dispatch fails', async () => {
      emailRepository.createEmail = async (data) => ({
        ...data,
        status: 'scheduled',
      });

      let markedFailedId = null;
      emailRepository.markEmailFailed = async (id) => {
        markedFailedId = id;
        return { id, status: 'failed' };
      };

      emailQueueService.addScheduledEmailJob = async () => {
        throw new Error('Redis connection refused: ECONNREFUSED');
      };

      const res = await request({
        method: 'POST',
        path: '/api/emails/schedule',
        body: {
          recipient: 'fail@reachinbox.ai',
          subject: 'Will Fail Queue',
          body: 'Content',
          delayMs: 2000,
        },
      });

      assert.equal(res.status, 503);
      assert.match(res.body.error, /currently unavailable/i);
      assert.ok(markedFailedId, 'Email record should be updated to failed status');
    });

    test('Accepts client-provided UUID id and schedules with it', async () => {
      const customId = '11112222-3333-4444-5555-666677778888';
      let insertedId = null;
      emailRepository.createEmail = async (data) => {
        insertedId = data.id;
        return { ...data, status: 'scheduled' };
      };
      emailQueueService.addScheduledEmailJob = async () => ({ id: 'job-1' });

      const res = await request({
        method: 'POST',
        path: '/api/emails/schedule',
        body: {
          id: customId,
          recipient: 'client@example.com',
          subject: 'With custom ID',
          body: 'Hello',
          delayMs: 1000,
        },
      });

      assert.equal(res.status, 201);
      assert.equal(insertedId, customId);
      assert.equal(res.body.data.id, customId);
    });

    test('Returns 409 Conflict when an email with duplicate id is scheduled', async () => {
      emailRepository.createEmail = async () => {
        const err = new Error('duplicate key value violates unique constraint');
        err.code = '23505';
        throw err;
      };

      const res = await request({
        method: 'POST',
        path: '/api/emails/schedule',
        body: {
          id: '11112222-3333-4444-5555-666677778888',
          recipient: 'client@example.com',
          subject: 'Duplicate Test',
          body: 'Hello',
          delayMs: 1000,
        },
      });

      assert.equal(res.status, 409);
      assert.match(res.body.error, /already been scheduled/i);
    });
  });

  describe('GET /api/emails', () => {
    test('Returns 400 if invalid status query filter is supplied', async () => {
      const res = await request({
        method: 'GET',
        path: '/api/emails?status=invalid_status',
      });

      assert.equal(res.status, 400);
      assert.match(res.body.error, /invalid status filter/i);
    });

    test('Returns 200 with list and pagination metadata on valid request', async () => {
      emailRepository.listEmails = async ({ status, page, limit }) => ({
        emails: [
          {
            id: '00000000-0000-0000-0000-000000000010',
            recipient: 'test@reachinbox.ai',
            subject: 'Hello',
            status: status || 'scheduled',
          },
        ],
        total: 1,
        page,
        limit,
        totalPages: 1,
      });

      const res = await request({
        method: 'GET',
        path: '/api/emails?status=scheduled&page=1&limit=10',
      });

      assert.equal(res.status, 200);
      assert.equal(Array.isArray(res.body.data), true);
      assert.equal(res.body.data.length, 1);
      assert.equal(res.body.pagination.total, 1);
      assert.equal(res.body.pagination.page, 1);
    });
  });

  describe('GET /api/emails/:id', () => {
    test('Returns 400 for malformed UUID format', async () => {
      const res = await request({
        method: 'GET',
        path: '/api/emails/not-a-valid-uuid',
      });

      assert.equal(res.status, 400);
      assert.match(res.body.error, /valid UUID/i);
    });

    test('Returns 404 if email record does not exist', async () => {
      emailRepository.getEmailById = async () => null;

      const res = await request({
        method: 'GET',
        path: '/api/emails/00000000-0000-0000-0000-000000000099',
      });

      assert.equal(res.status, 404);
      assert.match(res.body.error, /not found/i);
    });

    test('Returns 200 and data if email record exists', async () => {
      const testUuid = '00000000-0000-0000-0000-000000000088';
      emailRepository.getEmailById = async (id) => ({
        id,
        recipient: 'test@reachinbox.ai',
        subject: 'Scheduled Subject',
        status: 'scheduled',
      });

      const res = await request({
        method: 'GET',
        path: `/api/emails/${testUuid}`,
      });

      assert.equal(res.status, 200);
      assert.equal(res.body.data.id, testUuid);
    });
  });
});
