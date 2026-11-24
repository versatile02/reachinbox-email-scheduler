process.env.NODE_ENV = 'test';

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { reserveSendSlot, setRateLimitRedis } from '../src/services/ratelimit.service.js';

describe('Rate Limiting & Pacing Service Unit Tests', () => {
  let mockStorage: Map<string, any>;
  let mockRedis: any;

  beforeEach(() => {
    mockStorage = new Map();

    mockRedis = {
      eval: async (
        script: string,
        numKeys: number,
        pacingKey: string,
        quotaPrefix: string,
        limit: number,
        minDelayMs: number,
        nowMsOverride: number,
        emailId?: string
      ) => {
        const nowMs = nowMsOverride > 0 ? nowMsOverride : 1700000000000;
        const lastSlot = mockStorage.get(pacingKey) || 0;
        const candidateSlot = Math.max(nowMs, lastSlot + minDelayMs);
        const hourMs = 3600000;
        const candidateHour = Math.floor(candidateSlot / hourMs);
        const nextHourStartMs = (candidateHour + 1) * hourMs;
        const hourKey = `${quotaPrefix}:${candidateHour}`;
        const emailSetKey = `${quotaPrefix}:${candidateHour}:emails`;
        const emailSet: Set<string> = mockStorage.get(emailSetKey) || new Set();

        const currentCount = mockStorage.get(hourKey) || 0;

        // Idempotent retry check: if email already reserved in this window
        if (emailId && emailSet.has(emailId)) {
          mockStorage.set(pacingKey, candidateSlot);
          const sleepMs = Math.max(0, candidateSlot - nowMs);
          return [1, candidateSlot, sleepMs, nextHourStartMs, currentCount, limit];
        }

        if (currentCount >= limit) {
          const sleepMs = Math.max(0, nextHourStartMs - nowMs);
          return [0, candidateSlot, sleepMs, nextHourStartMs, currentCount, limit];
        }

        const newCount = currentCount + 1;
        mockStorage.set(hourKey, newCount);
        if (emailId) {
          emailSet.add(emailId);
          mockStorage.set(emailSetKey, emailSet);
        }
        mockStorage.set(pacingKey, candidateSlot);

        const sleepMs = Math.max(0, candidateSlot - nowMs);
        return [1, candidateSlot, sleepMs, nextHourStartMs, newCount, limit];
      },
      keys: async () => [],
      del: async () => 0,
      quit: async () => {},
    };

    setRateLimitRedis(mockRedis);
  });

  test('Permits first dispatch immediately without delay and reserves pacing slot', async () => {
    const sender = 'sender1@example.com';
    const nowMs = 1700000000000;

    const res = await reserveSendSlot(sender, 5, 2, undefined, nowMs);

    assert.equal(res.allowed, true);
    assert.equal(res.currentCount, 1);
    assert.equal(res.hourlyLimit, 5);
    assert.equal(res.sleepMs, 0, 'First email should dispatch immediately without sleep');
    assert.equal(res.dispatchSlot, nowMs);
  });

  test('Consecutive sends enforce minimum inter-send spacing (pacing delay)', async () => {
    const sender = 'sender2@example.com';
    const nowMs = 1700000000000;

    const res1 = await reserveSendSlot(sender, 10, 3, undefined, nowMs);
    assert.equal(res1.allowed, true);
    assert.equal(res1.dispatchSlot, nowMs);
    assert.equal(res1.sleepMs, 0);

    // Second call immediately at same nowMs must be spaced by 3000ms
    const res2 = await reserveSendSlot(sender, 10, 3, undefined, nowMs);
    assert.equal(res2.allowed, true);
    assert.equal(res2.dispatchSlot, nowMs + 3000);
    assert.equal(res2.sleepMs, 3000);
    assert.equal(res2.currentCount, 2);
  });

  test('Retrying the same email ID in the same window reuses quota idempotently without re-incrementing', async () => {
    const sender = 'idempotent@example.com';
    const emailId = 'email-uuid-1111';
    const nowMs = 1700000000000;

    // First attempt reserves quota (count = 1)
    const res1 = await reserveSendSlot(sender, 5, 2, emailId, nowMs);
    assert.equal(res1.allowed, true);
    assert.equal(res1.currentCount, 1);

    // Retry of the same emailId within the same hour window reuses the existing reservation
    const res2 = await reserveSendSlot(sender, 5, 2, emailId, nowMs);
    assert.equal(res2.allowed, true);
    assert.equal(res2.currentCount, 1, 'Current count must NOT increment on retry of same email');
  });

  test('Rejects and returns next window boundary when hourly quota is exceeded', async () => {
    const sender = 'sender3@example.com';
    const nowMs = 1700000000000;
    const limit = 2;

    await reserveSendSlot(sender, limit, 1, 'email-1', nowMs);
    await reserveSendSlot(sender, limit, 1, 'email-2', nowMs);

    // 3rd attempt with different email should be disallowed
    const res3 = await reserveSendSlot(sender, limit, 1, 'email-3', nowMs);

    assert.equal(res3.allowed, false);
    assert.equal(res3.currentCount, 2);
    assert.equal(res3.hourlyLimit, 2);
    assert.ok(res3.nextHourStartMs > nowMs);
    assert.equal(res3.sleepMs, res3.nextHourStartMs - nowMs);
  });

  test('Cross-window boundary alignment: spacing crossing into next hour reserves in next hour quota', async () => {
    const sender = 'boundary@example.com';
    const hourMs = 3600000;
    const currentHour = Math.floor(1700000000000 / hourMs);
    const nextHourStartMs = (currentHour + 1) * hourMs;
    const justBeforeBoundary = nextHourStartMs - 500; // 500ms before boundary

    // Set last slot right before boundary
    mockStorage.set(`rl:pacing:${sender}`, justBeforeBoundary);

    // Request with 2000ms delay pushes candidateSlot into next hour
    const res = await reserveSendSlot(sender, 5, 2, undefined, justBeforeBoundary);

    assert.equal(res.allowed, true);
    const targetHour = Math.floor(res.dispatchSlot / hourMs);
    assert.equal(targetHour, currentHour + 1, 'Target hour must be the next UTC hour window');
  });
});
