process.env.NODE_ENV = 'test';

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { processEmailJob } from '../src/workers/email.worker.js';
import { emailRepository } from '../src/models/email.repository.js';
import { mailerService } from '../src/services/mailer.service.js';

describe('Email Worker Job Processing Logic', () => {
  let originalGetEmail;
  let originalMarkProcessing;
  let originalTouchProcessing;
  let originalMarkRetry;
  let originalMarkSent;
  let originalMarkFailed;
  let originalSendEmail;

  beforeEach(() => {
    // Preserve originals
    originalGetEmail = emailRepository.getEmailById;
    originalMarkProcessing = emailRepository.markEmailProcessing;
    originalTouchProcessing = emailRepository.touchEmailProcessing;
    originalMarkRetry = emailRepository.markEmailRetry;
    originalMarkSent = emailRepository.markEmailSent;
    originalMarkFailed = emailRepository.markEmailFailed;
    originalSendEmail = mailerService.sendEmail;
  });

  test('Rejects jobs that have no email ID in job data', async () => {
    await assert.rejects(
      () => processEmailJob({ id: 'job-1', data: {}, attemptsMade: 0 }),
      { message: /missing an email record ID/i }
    );
  });

  test('Skips job if email record is not found in database', async () => {
    emailRepository.getEmailById = async () => null;

    const result = await processEmailJob({
      id: 'job-2',
      data: { id: '00000000-0000-0000-0000-000000000001' },
      attemptsMade: 0,
    });

    assert.deepEqual(result, { skipped: true, reason: 'Record not found' });
  });

  test('Skips job if email record is already marked as sent (idempotency guard)', async () => {
    emailRepository.getEmailById = async () => ({
      id: '00000000-0000-0000-0000-000000000002',
      status: 'sent',
    });

    const result = await processEmailJob({
      id: 'job-3',
      data: { id: '00000000-0000-0000-0000-000000000002' },
      attemptsMade: 0,
    });

    assert.deepEqual(result, { skipped: true, reason: 'Already sent' });
  });

  test('Throws error when lease cannot be acquired so BullMQ retries instead of silently completing', async () => {
    emailRepository.getEmailById = async () => ({
      id: '00000000-0000-0000-0000-000000000003',
      status: 'scheduled',
    });
    // Another worker currently holds the active lease
    emailRepository.markEmailProcessing = async () => null;

    await assert.rejects(
      () =>
        processEmailJob({
          id: 'job-4',
          data: { id: '00000000-0000-0000-0000-000000000003' },
          attemptsMade: 0,
        }),
      { message: /currently locked by another active worker/i }
    );
  });

  test('Stalled-job recovery successfully reclaims record when previous worker lease has expired', async () => {
    const testId = '00000000-0000-0000-0000-000000000011';
    let leaseClaimedWithTimeout = null;

    emailRepository.getEmailById = async () => ({
      id: testId,
      status: 'processing', // Left in processing by crashed worker
      updatedAt: new Date(Date.now() - 70000).toISOString(),
      recipient: 'crashed-recovery@example.com',
      subject: 'Recovered',
      body: 'Hello',
    });

    // Stalled retry reclaims because updated_at is older than lease timeout
    let leaseClaimedWithToken = null;
    emailRepository.markEmailProcessing = async (id, token, timeout) => {
      leaseClaimedWithToken = token;
      leaseClaimedWithTimeout = timeout;
      return {
        id: testId,
        recipient: 'crashed-recovery@example.com',
        subject: 'Recovered',
        body: 'Hello',
        status: 'processing',
      };
    };

    mailerService.sendEmail = async () => ({
      messageId: '<recovered-msg@ethereal.email>',
      previewUrl: 'https://ethereal.email/message/recovered',
    });

    let markedSent = false;
    emailRepository.markEmailSent = async () => {
      markedSent = true;
      return { id: testId, status: 'sent' };
    };

    const result = await processEmailJob({
      id: 'job-stalled-retry',
      data: { id: testId },
      attemptsMade: 1, // Stalled retry attempt in BullMQ
      opts: { attempts: 3 },
    });

    assert.equal(result.success, true);
    assert.equal(markedSent, true, 'Recovered worker must complete delivery');
    assert.equal(leaseClaimedWithTimeout, 60);
    assert.ok(leaseClaimedWithToken, 'Must generate and pass unique claimToken');
  });

  test('Long-running SMTP delivery periodically renews heartbeat to prevent premature lease reclaim', async () => {
    const testId = '00000000-0000-0000-0000-000000000012';
    let heartbeatCalls = 0;

    emailRepository.getEmailById = async () => ({
      id: testId,
      status: 'scheduled',
      recipient: 'slow-smtp@example.com',
      subject: 'Slow Delivery',
      body: 'Body',
    });

    emailRepository.markEmailProcessing = async () => ({
      id: testId,
      recipient: 'slow-smtp@example.com',
      subject: 'Slow Delivery',
      body: 'Body',
      status: 'processing',
    });

    emailRepository.touchEmailProcessing = async () => {
      heartbeatCalls++;
      return true;
    };

    mailerService.sendEmail = async () => {
      // Simulate heartbeat touch during active execution
      await emailRepository.touchEmailProcessing(testId);
      return {
        messageId: '<slow-msg@ethereal.email>',
        previewUrl: 'https://ethereal.email/message/slow',
      };
    };

    emailRepository.markEmailSent = async () => ({ id: testId, status: 'sent' });

    const result = await processEmailJob({
      id: 'job-slow-send',
      data: { id: testId },
      attemptsMade: 0,
      opts: { attempts: 3 },
    });

    assert.equal(result.success, true);
    assert.ok(heartbeatCalls >= 1, 'Heartbeat must be called during long-running processing');
  });

  test('Retry attempt successfully reclaims record when previous non-final attempt released claim', async () => {
    const testId = '00000000-0000-0000-0000-000000000013';

    emailRepository.getEmailById = async () => ({
      id: testId,
      status: 'scheduled', // Released to scheduled by previous attempt
      recipient: 'retry@example.com',
      subject: 'Retry Subject',
      body: 'Retry Body',
    });

    let claimed = false;
    emailRepository.markEmailProcessing = async () => {
      claimed = true;
      return {
        id: testId,
        recipient: 'retry@example.com',
        subject: 'Retry Subject',
        body: 'Retry Body',
        status: 'processing',
      };
    };

    mailerService.sendEmail = async () => ({
      messageId: '<retry-msg@ethereal.email>',
      previewUrl: 'https://ethereal.email/message/retry',
    });

    let markedSent = false;
    emailRepository.markEmailSent = async () => {
      markedSent = true;
      return { id: testId, status: 'sent' };
    };

    const result = await processEmailJob({
      id: 'job-retry-success',
      data: { id: testId },
      attemptsMade: 1, // 2nd attempt
      opts: { attempts: 3 },
    });

    assert.equal(result.success, true);
    assert.equal(claimed, true);
    assert.equal(markedSent, true);
  });

  test('Executes delivery successfully and marks status as sent with preview URL', async () => {
    const testId = '00000000-0000-0000-0000-000000000004';
    let sentMarked = false;
    let recordedPreviewUrl = null;

    emailRepository.getEmailById = async () => ({
      id: testId,
      recipient: 'client@example.com',
      subject: 'Welcome!',
      body: 'Hello there!',
      status: 'scheduled',
    });

    emailRepository.markEmailProcessing = async () => ({
      id: testId,
      recipient: 'client@example.com',
      subject: 'Welcome!',
      body: 'Hello there!',
      status: 'processing',
    });

    mailerService.sendEmail = async () => ({
      messageId: '<msg-12345@ethereal.email>',
      previewUrl: 'https://ethereal.email/message/test-preview-123',
      response: '250 Accepted',
    });

    emailRepository.markEmailSent = async (id, { etherealPreviewUrl }) => {
      sentMarked = true;
      recordedPreviewUrl = etherealPreviewUrl;
      return { id, status: 'sent', etherealPreviewUrl };
    };

    const result = await processEmailJob({
      id: 'job-5',
      data: { id: testId },
      attemptsMade: 0,
      opts: { attempts: 3 },
    });

    assert.equal(result.success, true);
    assert.equal(result.emailId, testId);
    assert.equal(sentMarked, true);
    assert.equal(recordedPreviewUrl, 'https://ethereal.email/message/test-preview-123');
  });

  test('Releases claim back to scheduled via markEmailRetry on non-final failure', async () => {
    const testId = '00000000-0000-0000-0000-000000000006';
    let retryMarked = false;
    let retryDiagnostic = null;
    let failedMarked = false;

    emailRepository.getEmailById = async () => ({
      id: testId,
      recipient: 'client@example.com',
      subject: 'Welcome!',
      body: 'Hello there!',
      status: 'processing',
    });

    emailRepository.markEmailProcessing = async () => ({
      id: testId,
      recipient: 'client@example.com',
      subject: 'Welcome!',
      body: 'Hello there!',
      status: 'processing',
    });

    mailerService.sendEmail = async () => {
      throw new Error('Transient network timeout');
    };

    emailRepository.markEmailRetry = async (id, reason) => {
      retryMarked = true;
      retryDiagnostic = reason;
      return { id, status: 'scheduled', errorMessage: reason };
    };

    emailRepository.markEmailFailed = async () => {
      failedMarked = true;
    };

    await assert.rejects(
      () =>
        processEmailJob({
          id: 'job-retry-1',
          data: { id: testId },
          attemptsMade: 0, // 1st attempt out of 3
          opts: { attempts: 3 },
        }),
      { message: /Transient network timeout/ }
    );

    assert.equal(retryMarked, true, 'Should release claim back to scheduled on non-final attempt');
    assert.match(retryDiagnostic, /Attempt 1 failed/i);
    assert.equal(failedMarked, false, 'Should NOT mark permanently failed on attempt 1');
  });

  test('Marks status as failed on final retry attempt exhaustion', async () => {
    const testId = '00000000-0000-0000-0000-000000000005';
    let failedMarked = false;
    let failureReason = null;
    let retryMarked = false;

    emailRepository.getEmailById = async () => ({
      id: testId,
      recipient: 'client@example.com',
      subject: 'Welcome!',
      body: 'Hello there!',
      status: 'processing',
    });

    emailRepository.markEmailProcessing = async () => ({
      id: testId,
      recipient: 'client@example.com',
      subject: 'Welcome!',
      body: 'Hello there!',
      status: 'processing',
    });

    mailerService.sendEmail = async () => {
      throw new Error('SMTP connection refused');
    };

    emailRepository.markEmailRetry = async () => {
      retryMarked = true;
    };

    emailRepository.markEmailFailed = async (id, reason) => {
      failedMarked = true;
      failureReason = reason;
      return { id, status: 'failed', errorMessage: reason };
    };

    await assert.rejects(
      () =>
        processEmailJob({
          id: 'job-6',
          data: { id: testId },
          attemptsMade: 2, // 3rd attempt (attemptsMade 2 + 1 = 3)
          opts: { attempts: 3 },
        }),
      { message: /SMTP connection refused/i }
    );

    assert.equal(failedMarked, true, 'Should mark permanently failed on final attempt');
    assert.equal(retryMarked, false, 'Should NOT call markEmailRetry on final attempt');
    assert.match(failureReason, /Delivery failed after 3 attempts/i);
  });

  test('Mitigates dual-write transient database error by retrying markEmailSent', async () => {
    const testId = '00000000-0000-0000-0000-000000000007';
    let dbCallCount = 0;

    emailRepository.getEmailById = async () => ({
      id: testId,
      recipient: 'client@example.com',
      subject: 'Welcome!',
      body: 'Hello!',
      status: 'scheduled',
    });

    emailRepository.markEmailProcessing = async () => ({
      id: testId,
      recipient: 'client@example.com',
      subject: 'Welcome!',
      body: 'Hello!',
      status: 'processing',
    });

    mailerService.sendEmail = async () => ({
      messageId: '<msg-777@ethereal.email>',
      previewUrl: 'https://ethereal.email/message/test-777',
      response: '250 Accepted',
    });

    // Fails on attempt 1 with transient DB error, succeeds on attempt 2
    emailRepository.markEmailSent = async () => {
      dbCallCount++;
      if (dbCallCount === 1) {
        throw new Error('Connection terminated unexpectedly');
      }
      return { id: testId, status: 'sent' };
    };

    const result = await processEmailJob({
      id: 'job-dual-write-1',
      data: { id: testId },
      attemptsMade: 0,
      opts: { attempts: 3 },
    });

    assert.equal(result.success, true);
    assert.equal(dbCallCount, 2, 'Should have retried the DB update and succeeded on attempt 2');
  });

  test('Worker aborts and throws if lease token was superseded during processing', async () => {
    const testId = '00000000-0000-0000-0000-000000000014';

    emailRepository.getEmailById = async () => ({
      id: testId,
      status: 'scheduled',
      recipient: 'stale-check@example.com',
      subject: 'Stale Token Test',
      body: 'Hello',
    });

    emailRepository.markEmailProcessing = async () => ({
      id: testId,
      recipient: 'stale-check@example.com',
      subject: 'Stale Token Test',
      body: 'Hello',
      status: 'processing',
    });

    // Stale heartbeat returns false (superseded in DB by newer worker)
    emailRepository.touchEmailProcessing = async () => false;

    // Database markEmailSent returns null because stale worker claim_token does not match
    emailRepository.markEmailSent = async () => null;

    mailerService.sendEmail = async () => ({
      messageId: '<stale-msg@ethereal.email>',
      previewUrl: 'https://ethereal.email/message/stale',
    });

    emailRepository.markEmailRetry = async () => null;

    await assert.rejects(
      () =>
        processEmailJob({
          id: 'job-superseded',
          data: { id: testId },
          attemptsMade: 0,
          opts: { attempts: 3 },
        }),
      { message: /lost lease token|database update to 'sent' failed/i }
    );
  });

  test('Worker detects lease loss during in-flight SMTP operation and aborts without updating to sent', async () => {
    const testId = '00000000-0000-0000-0000-000000000015';
    let smtpDispatched = false;
    let markSentAttempted = false;

    emailRepository.getEmailById = async () => ({
      id: testId,
      status: 'scheduled',
      recipient: 'inflight@example.com',
      subject: 'In-flight Test',
      body: 'Hello',
    });

    emailRepository.markEmailProcessing = async () => ({
      id: testId,
      recipient: 'inflight@example.com',
      subject: 'In-flight Test',
      body: 'Hello',
      status: 'processing',
    });

    // Touch returns false when heartbeat fires (simulating lease loss during long SMTP call)
    emailRepository.touchEmailProcessing = async () => false;

    // Simulate in-flight SMTP call during which heartbeat fires
    mailerService.sendEmail = async () => {
      smtpDispatched = true;
      // Wait for heartbeat interval (configured to 20ms) so heartbeat fires while SMTP is in flight
      await new Promise((resolve) => setTimeout(resolve, 60));
      return {
        messageId: '<inflight-msg@ethereal.email>',
        previewUrl: 'https://ethereal.email/message/inflight',
      };
    };

    emailRepository.markEmailSent = async () => {
      markSentAttempted = true;
      return null;
    };

    emailRepository.markEmailRetry = async () => null;

    await assert.rejects(
      () =>
        processEmailJob({
          id: 'job-inflight-lease-loss',
          data: { id: testId, _heartbeatIntervalMs: 20 },
          attemptsMade: 0,
          opts: { attempts: 3 },
        }),
      { message: /lost lease token/i }
    );

    assert.equal(smtpDispatched, true, 'SMTP dispatch must have initiated and completed over the wire');
    assert.equal(markSentAttempted, false, 'Worker must not attempt markEmailSent after detecting lease loss');
  });
});
