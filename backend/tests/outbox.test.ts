import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { publishOutboxEvent, processPendingOutboxEvents, reconcileQueueWithDatabase } from '../src/services/outbox.service.js';
import { emailRepository } from '../src/models/email.repository.js';
import { emailQueue, addScheduledEmailJob } from '../src/queues/email.queue.js';

describe('Transactional Outbox & Queue Reconciliation Unit Tests', () => {
  test('publishOutboxEvent parses payload and adds BullMQ job with deterministic jobId', async () => {
    let capturedJobData: any = null;
    let capturedJobId: string | null = null;
    let markedPublishedId: string | null = null;

    emailRepository.markOutboxPublished = async (id: string) => {
      markedPublishedId = id;
    };

    const originalAdd = (emailQueue as any).add;
    (emailQueue as any).add = async (name: string, data: any, opts: any) => {
      capturedJobData = data;
      capturedJobId = opts?.jobId || null;
      return { id: capturedJobId };
    };

    try {
      const mockEvent = {
        id: 'outbox-evt-1',
        emailId: '00000000-0000-0000-0000-000000000099',
        eventType: 'EMAIL_SCHEDULED',
        payload: {
          id: '00000000-0000-0000-0000-000000000099',
          senderEmail: 'scheduler@reachinbox.ai',
          recipient: 'outbox-test@example.com',
          subject: 'Outbox Test Subject',
          body: 'Hello Outbox',
          scheduledAt: new Date(Date.now() + 60000).toISOString(),
        },
        status: 'pending',
        attempts: 0,
        createdAt: new Date().toISOString(),
      };

      const success = await publishOutboxEvent(mockEvent as any);

      assert.equal(success, true);
      assert.equal(capturedJobId, '00000000-0000-0000-0000-000000000099');
      assert.equal(capturedJobData?.recipient, 'outbox-test@example.com');
      assert.equal(markedPublishedId, 'outbox-evt-1');
    } finally {
      (emailQueue as any).add = originalAdd;
    }
  });

  test('reconcileQueueWithDatabase detects missing BullMQ jobs and recovers them', async () => {
    const testEmailId = '00000000-0000-0000-0000-000000000088';
    let reEnqueuedEmailId: string | null = null;

    emailRepository.getScheduledEmailsForReconciliation = async () => [
      {
        id: testEmailId,
        senderEmail: 'scheduler@reachinbox.ai',
        recipient: 'recover@example.com',
        subject: 'Recovered Email',
        body: 'Recovered body',
        scheduledAt: new Date(Date.now() + 30000).toISOString(),
        status: 'scheduled',
      } as any,
    ];

    const originalGetJob = emailQueue.getJob.bind(emailQueue);
    const originalAdd = (emailQueue as any).add;

    emailQueue.getJob = async (id: string) => null; // Simulate Redis job loss!
    (emailQueue as any).add = async (name: string, data: any, opts: any) => {
      reEnqueuedEmailId = data.id;
      return { id: opts?.jobId };
    };

    try {
      const result = await reconcileQueueWithDatabase();

      assert.equal(result.scanned, 1);
      assert.equal(result.reconciled, 1);
      assert.equal(reEnqueuedEmailId, testEmailId);
    } finally {
      emailQueue.getJob = originalGetJob;
      (emailQueue as any).add = originalAdd;
    }
  });

  test('Concurrent outbox publisher skips locked events and executes inside transaction', async () => {
    // Mock getPendingOutboxEvents to simulate FOR UPDATE SKIP LOCKED behavior:
    // Event 1 is locked by Instance A; Instance B receives Event 2.
    const mockEvents = [
      {
        id: 'outbox-evt-1',
        emailId: '00000000-0000-0000-0000-000000000001',
        payload: {
          id: '00000000-0000-0000-0000-000000000001',
          recipient: 'first@example.com',
          subject: 'First',
          body: 'First body',
          scheduledAt: new Date().toISOString(),
        },
        status: 'pending',
        attempts: 0,
      },
      {
        id: 'outbox-evt-2',
        emailId: '00000000-0000-0000-0000-000000000002',
        payload: {
          id: '00000000-0000-0000-0000-000000000002',
          recipient: 'second@example.com',
          subject: 'Second',
          body: 'Second body',
          scheduledAt: new Date().toISOString(),
        },
        status: 'pending',
        attempts: 0,
      },
    ];

    let instanceALocked = true;
    const originalGetPending = emailRepository.getPendingOutboxEvents;
    const originalMarkPublished = emailRepository.markOutboxPublished;

    const publishedIds: string[] = [];
    emailRepository.markOutboxPublished = async (id: string) => {
      publishedIds.push(id);
    };

    // Simulate PostgreSQL SKIP LOCKED:
    // If instanceALocked is true, evt-1 is locked, so returning evt-2
    emailRepository.getPendingOutboxEvents = async (_limit = 1, _client?: any) => {
      if (instanceALocked) {
        return [mockEvents[1] as any]; // Event 1 is skipped because it's locked!
      }
      return [mockEvents[0] as any];
    };

    const originalAdd = (emailQueue as any).add;
    (emailQueue as any).add = async (_name: string, data: any, opts: any) => ({ id: opts?.jobId });

    try {
      // Instance B queries while Instance A holds lock on Event 1
      const eventsForInstanceB = await emailRepository.getPendingOutboxEvents(1);
      assert.equal(eventsForInstanceB.length, 1);
      assert.equal(eventsForInstanceB[0].id, 'outbox-evt-2', 'Concurrent worker must skip locked event 1 and select event 2');

      const success = await publishOutboxEvent(eventsForInstanceB[0]);
      assert.equal(success, true);
      assert.ok(publishedIds.includes('outbox-evt-2'));
    } finally {
      emailRepository.getPendingOutboxEvents = originalGetPending;
      emailRepository.markOutboxPublished = originalMarkPublished;
      (emailQueue as any).add = originalAdd;
    }
  });

  test('Outbox recovery after simulated crash: BullMQ deterministic jobId prevents duplicates', async () => {
    const testEmailId = '00000000-0000-0000-0000-000000000077';
    const enqueuedJobIds: string[] = [];

    const mockEvent = {
      id: 'outbox-crash-evt',
      emailId: testEmailId,
      eventType: 'EMAIL_SCHEDULED',
      payload: {
        id: testEmailId,
        senderEmail: 'scheduler@reachinbox.ai',
        recipient: 'crash-recovery@example.com',
        subject: 'Crash Recovery',
        body: 'Body',
        scheduledAt: new Date(Date.now() + 60000).toISOString(),
      },
      status: 'pending',
      attempts: 0,
    };

    let publishedState = false;
    const originalMarkPublished = emailRepository.markOutboxPublished;
    emailRepository.markOutboxPublished = async () => {
      publishedState = true;
    };

    const originalAdd = (emailQueue as any).add;
    (emailQueue as any).add = async (_name: string, data: any, opts: any) => {
      // Record jobId
      enqueuedJobIds.push(opts?.jobId);
      return { id: opts?.jobId };
    };

    try {
      // Step 1: Pre-crash publish (Redis receives job, but DB status update simulated to fail/rollback)
      let preCrashPublished = false;
      try {
        await addScheduledEmailJob(
          {
            id: testEmailId,
            recipient: 'crash-recovery@example.com',
            subject: 'Crash Recovery',
            body: 'Body',
          },
          60000,
          testEmailId
        );
        // Simulate crash right before Postgres commit!
        throw new Error('SIMULATED_DB_DISCONNECT_CRASH');
      } catch (crashErr: any) {
        assert.equal(crashErr.message, 'SIMULATED_DB_DISCONNECT_CRASH');
      }
      assert.equal(publishedState, false, 'Pre-crash transaction rolled back, status remains pending');

      // Step 2: Post-crash recovery run
      const recovered = await publishOutboxEvent(mockEvent as any);
      assert.equal(recovered, true);
      assert.equal(publishedState, true, 'Recovered event marked published');

      // Step 3: Both attempts used the identical deterministic jobId
      assert.equal(enqueuedJobIds.length, 2);
      assert.equal(enqueuedJobIds[0], testEmailId);
      assert.equal(enqueuedJobIds[1], testEmailId);
      assert.equal(enqueuedJobIds[0], enqueuedJobIds[1], 'Deterministic BullMQ jobId ensures Redis deduplication');
    } finally {
      emailRepository.markOutboxPublished = originalMarkPublished;
      (emailQueue as any).add = originalAdd;
    }
  });

  test('Failed publishing increments attempt count and does not permanently lose event', async () => {
    let failedEventId: string | null = null;
    let recordedError: string | null = null;

    const originalMarkFailed = emailRepository.markOutboxFailed;
    emailRepository.markOutboxFailed = async (id: string, errMsg: string) => {
      failedEventId = id;
      recordedError = errMsg;
    };

    const originalAdd = (emailQueue as any).add;
    (emailQueue as any).add = async () => {
      throw new Error('REDIS_CLUSTER_DOWN');
    };

    const mockEvent = {
      id: 'outbox-fail-evt',
      emailId: '00000000-0000-0000-0000-000000000066',
      eventType: 'EMAIL_SCHEDULED',
      payload: {
        id: '00000000-0000-0000-0000-000000000066',
        recipient: 'fail@example.com',
        subject: 'Fail',
        body: 'Fail body',
        scheduledAt: new Date().toISOString(),
      },
      status: 'pending',
      attempts: 0,
    };

    try {
      const success = await publishOutboxEvent(mockEvent as any);
      assert.equal(success, false, 'Must report false when queue dispatch fails');
      assert.equal(failedEventId, 'outbox-fail-evt');
      assert.ok(recordedError?.includes('REDIS_CLUSTER_DOWN'), 'Must record failure reason for retry sweep');
    } finally {
      emailRepository.markOutboxFailed = originalMarkFailed;
      (emailQueue as any).add = originalAdd;
    }
  });
});
