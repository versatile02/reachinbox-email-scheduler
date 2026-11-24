process.env.NODE_ENV = 'test';

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DelayedError } from 'bullmq';
import { processEmailJob } from '../src/workers/email.worker.js';
import { emailRepository } from '../src/models/email.repository.js';
import { ratelimitService } from '../src/services/ratelimit.service.js';

describe('Safe BullMQ Rescheduling & Multi-Sender Rate Limiting Worker Tests', () => {
  beforeEach(() => {
    // Default safe stubs
    emailRepository.touchEmailProcessing = async () => true;
  });

  test('When rate limit is exceeded, worker updates DB, moves job to delayed, and throws DelayedError', async () => {
    const testId = '00000000-0000-0000-0000-000000000099';
    const nextWindowMs = Date.now() + 1800000; // 30 minutes from now

    emailRepository.getEmailById = async () => ({
      id: testId,
      status: 'scheduled',
      senderEmail: 'limited@example.com',
      recipient: 'target@example.com',
      subject: 'Exceeded Test',
      body: 'Hello',
      scheduledAt: new Date(Date.now() - 5000),
    });

    emailRepository.markEmailProcessing = async () => ({
      id: testId,
      status: 'processing',
      senderEmail: 'limited@example.com',
      recipient: 'target@example.com',
      subject: 'Exceeded Test',
      body: 'Hello',
      scheduledAt: new Date(Date.now() - 5000),
    });

    let rescheduleCalled = false;
    let rescheduledDate: any = null;
    emailRepository.markEmailReschedule = async (id, token, nextDate) => {
      rescheduleCalled = true;
      rescheduledDate = nextDate;
      return { id, status: 'scheduled' } as any;
    };

    // Stub rate limiter to return limit reached
    ratelimitService.reserveSendSlot = async () => ({
      allowed: false,
      dispatchSlot: Date.now(),
      sleepMs: 1800000,
      nextHourStartMs: nextWindowMs,
      currentCount: 5,
      hourlyLimit: 5,
    });

    let moveToDelayedCalled = false;
    let delayedTimestamp: number | null = null;

    const mockJob: any = {
      id: testId, // Deterministic ID matching email record
      data: { id: testId },
      token: 'worker-token-test-123',
      attemptsMade: 0,
      moveToDelayed: async (ts: number, token: string) => {
        moveToDelayedCalled = true;
        delayedTimestamp = ts;
      },
    };

    await assert.rejects(
      () => processEmailJob(mockJob),
      (err: any) => {
        assert.ok(err instanceof DelayedError, 'Worker must throw BullMQ DelayedError on safe rescheduling');
        return true;
      }
    );

    assert.equal(rescheduleCalled, true, 'Database status must be updated to scheduled with new scheduled_at');
    assert.equal(rescheduledDate.getTime(), nextWindowMs);
    assert.equal(moveToDelayedCalled, true, 'BullMQ moveToDelayed must be invoked with next window timestamp');
    assert.equal(delayedTimestamp, nextWindowMs);
  });

  test('Premature trigger guard: moves job back to delayed if scheduledAt is ahead of time', async () => {
    const testId = '00000000-0000-0000-0000-000000000098';
    const futureTime = Date.now() + 60000; // 60s in future

    emailRepository.getEmailById = async () => ({
      id: testId,
      status: 'scheduled',
      senderEmail: 'future@example.com',
      recipient: 'future@example.com',
      subject: 'Future Test',
      body: 'Hello',
      scheduledAt: new Date(futureTime),
    });

    let movedTimestamp = null;
    const mockJob: any = {
      id: testId,
      data: { id: testId },
      token: 'worker-token-future',
      attemptsMade: 0,
      moveToDelayed: async (ts: number) => {
        movedTimestamp = ts;
      },
    };

    await assert.rejects(
      () => processEmailJob(mockJob),
      (err: any) => {
        assert.ok(err instanceof DelayedError);
        return true;
      }
    );

    assert.equal(movedTimestamp, futureTime);
  });
});
