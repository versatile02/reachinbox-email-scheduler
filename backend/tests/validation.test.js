import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { validateSchedulePayload } from '../src/controllers/email.controller.js';

describe('Email Scheduling Payload Validation', () => {
  test('Rejects missing or invalid recipient email', () => {
    const r1 = validateSchedulePayload({ subject: 'Sub', body: 'Body', scheduledAt: new Date(Date.now() + 10000).toISOString() });
    assert.equal(r1.valid, false);
    assert.match(r1.error, /recipient/i);

    const r2 = validateSchedulePayload({ recipient: 'not-an-email', subject: 'Sub', body: 'Body', scheduledAt: new Date(Date.now() + 10000).toISOString() });
    assert.equal(r2.valid, false);
    assert.match(r2.error, /recipient/i);
  });

  test('Rejects missing or empty subject', () => {
    const r1 = validateSchedulePayload({ recipient: 'user@example.com', body: 'Body', scheduledAt: new Date(Date.now() + 10000).toISOString() });
    assert.equal(r1.valid, false);
    assert.match(r1.error, /subject/i);

    const r2 = validateSchedulePayload({ recipient: 'user@example.com', subject: '   ', body: 'Body', scheduledAt: new Date(Date.now() + 10000).toISOString() });
    assert.equal(r2.valid, false);
    assert.match(r2.error, /subject/i);
  });

  test('Rejects missing or empty body', () => {
    const r1 = validateSchedulePayload({ recipient: 'user@example.com', subject: 'Subject', scheduledAt: new Date(Date.now() + 10000).toISOString() });
    assert.equal(r1.valid, false);
    assert.match(r1.error, /body/i);

    const r2 = validateSchedulePayload({ recipient: 'user@example.com', subject: 'Subject', body: '   ', scheduledAt: new Date(Date.now() + 10000).toISOString() });
    assert.equal(r2.valid, false);
    assert.match(r2.error, /body/i);
  });

  test('Rejects missing scheduling timing (neither scheduledAt nor delayMs)', () => {
    const r = validateSchedulePayload({ recipient: 'user@example.com', subject: 'Subject', body: 'Body' });
    assert.equal(r.valid, false);
    assert.match(r.error, /scheduledAt.*delayMs/i);
  });

  test('Rejects past scheduledAt date', () => {
    const pastDate = new Date(Date.now() - 60000).toISOString();
    const r = validateSchedulePayload({
      recipient: 'user@example.com',
      subject: 'Subject',
      body: 'Body',
      scheduledAt: pastDate,
    });
    assert.equal(r.valid, false);
    assert.match(r.error, /future date/i);
  });

  test('Rejects invalid date string in scheduledAt', () => {
    const r = validateSchedulePayload({
      recipient: 'user@example.com',
      subject: 'Subject',
      body: 'Body',
      scheduledAt: 'not-a-date',
    });
    assert.equal(r.valid, false);
    assert.match(r.error, /valid ISO 8601/i);
  });

  test('Rejects invalid delayMs values', () => {
    const r1 = validateSchedulePayload({
      recipient: 'user@example.com',
      subject: 'Subject',
      body: 'Body',
      delayMs: -100,
    });
    assert.equal(r1.valid, false);
    assert.match(r1.error, /finite non-negative/i);

    const r2 = validateSchedulePayload({
      recipient: 'user@example.com',
      subject: 'Subject',
      body: 'Body',
      delayMs: 'invalid',
    });
    assert.equal(r2.valid, false);
  });

  test('Accepts valid future scheduledAt and computes positive delayMs', () => {
    const futureDate = new Date(Date.now() + 60000).toISOString();
    const r = validateSchedulePayload({
      recipient: 'user@example.com',
      subject: 'Meeting reminder',
      body: 'See you tomorrow at 10 AM',
      scheduledAt: futureDate,
    });

    assert.equal(r.valid, true);
    assert.equal(r.sanitized.recipient, 'user@example.com');
    assert.equal(r.sanitized.subject, 'Meeting reminder');
    assert.ok(r.sanitized.delayMs > 50000 && r.sanitized.delayMs <= 60000);
  });

  test('Accepts valid delayMs and computes ISO scheduledAt timestamp', () => {
    const delay = 30000;
    const r = validateSchedulePayload({
      recipient: 'user@example.com',
      subject: 'Meeting reminder',
      body: 'See you tomorrow at 10 AM',
      delayMs: delay,
    });

    assert.equal(r.valid, true);
    assert.equal(r.sanitized.delayMs, delay);
    assert.ok(new Date(r.sanitized.scheduledAt).getTime() > Date.now());
  });

  test('Rejects invalid custom id format', () => {
    const r = validateSchedulePayload({
      id: 'invalid-id-string',
      recipient: 'user@example.com',
      subject: 'Subject',
      body: 'Body',
      delayMs: 5000,
    });
    assert.equal(r.valid, false);
    assert.match(r.error, /id must be a valid UUID/i);
  });

  test('Accepts valid custom UUID id', () => {
    const customUuid = '123e4567-e89b-12d3-a456-426614174000';
    const r = validateSchedulePayload({
      id: customUuid,
      recipient: 'user@example.com',
      subject: 'Subject',
      body: 'Body',
      delayMs: 5000,
    });
    assert.equal(r.valid, true);
    assert.equal(r.sanitized.id, customUuid);
  });
});
