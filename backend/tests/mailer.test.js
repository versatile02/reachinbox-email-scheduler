import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import nodemailer from 'nodemailer';
import { sendEmail, getTransporter, setTransporter, resetTransporter } from '../src/services/mailer.service.js';

describe('Mailer Service Unit Tests', () => {
  beforeEach(() => {
    resetTransporter();
  });

  afterEach(() => {
    resetTransporter();
  });

  test('sendEmail rejects missing recipient with TypeError', async () => {
    await assert.rejects(
      () => sendEmail({ subject: 'Sub', body: 'Body' }),
      { name: 'TypeError', message: /recipient/i }
    );
  });

  test('sendEmail rejects missing subject with TypeError', async () => {
    await assert.rejects(
      () => sendEmail({ recipient: 'test@example.com', body: 'Body' }),
      { name: 'TypeError', message: /subject/i }
    );
  });

  test('sendEmail dispatches through transporter and extracts preview URL on success', async () => {
    const mockInfo = {
      messageId: '<test-msg-123@ethereal.email>',
      response: '250 Accepted message',
    };

    let sentMailOptions = null;
    const mockTransporter = {
      sendMail: async (mailOptions) => {
        sentMailOptions = mailOptions;
        return mockInfo;
      },
    };

    // Mock nodemailer.getTestMessageUrl
    const originalGetUrl = nodemailer.getTestMessageUrl;
    nodemailer.getTestMessageUrl = (info) => {
      if (info.messageId === mockInfo.messageId) {
        return 'https://ethereal.email/message/test-preview-123';
      }
      return null;
    };

    try {
      setTransporter(mockTransporter);

      const result = await sendEmail({
        recipient: 'recipient@example.com',
        subject: 'Scheduled Outreach',
        body: 'Hello there, this is a scheduled email test.',
      });

      assert.equal(result.messageId, mockInfo.messageId);
      assert.equal(result.previewUrl, 'https://ethereal.email/message/test-preview-123');
      assert.equal(sentMailOptions.to, 'recipient@example.com');
      assert.equal(sentMailOptions.subject, 'Scheduled Outreach');
      assert.equal(sentMailOptions.text, 'Hello there, this is a scheduled email test.');
    } finally {
      nodemailer.getTestMessageUrl = originalGetUrl;
    }
  });

  test('sendEmail returns null previewUrl when SMTP provider is not Ethereal', async () => {
    const mockInfo = {
      messageId: '<prod-msg-456@smtp.domain.com>',
      response: '250 Queued mail for delivery',
    };

    const mockTransporter = {
      sendMail: async () => mockInfo,
    };

    const originalGetUrl = nodemailer.getTestMessageUrl;
    nodemailer.getTestMessageUrl = () => false; // Standard SMTP returns false for test URL

    try {
      setTransporter(mockTransporter);

      const result = await sendEmail({
        recipient: 'recipient@domain.com',
        subject: 'Production Subject',
        body: 'Content',
      });

      assert.equal(result.messageId, mockInfo.messageId);
      assert.equal(result.previewUrl, null);
    } finally {
      nodemailer.getTestMessageUrl = originalGetUrl;
    }
  });

  test('sendEmail propagates SMTP failure and does not mask errors', async () => {
    const mockTransporter = {
      sendMail: async () => {
        throw new Error('550 5.1.1 Recipient mailbox unknown');
      },
    };

    setTransporter(mockTransporter);

    await assert.rejects(
      () =>
        sendEmail({
          recipient: 'nonexistent@example.com',
          subject: 'Outreach',
          body: 'Hello',
        }),
      { message: /550 5.1.1 Recipient mailbox unknown/ }
    );
  });

  test('getTransporter creates and caches Ethereal test account when credentials are not configured', async () => {
    const originalCreateTestAccount = nodemailer.createTestAccount;
    const originalCreateTransport = nodemailer.createTransport;

    let testAccountCreated = false;
    let transportCreatedWithUser = null;

    nodemailer.createTestAccount = async () => {
      testAccountCreated = true;
      return {
        user: 'mock_ethereal_user@ethereal.email',
        pass: 'mock_ethereal_pass_secret',
      };
    };

    nodemailer.createTransport = (opts) => {
      transportCreatedWithUser = opts?.auth?.user;
      return {
        sendMail: async () => ({ messageId: '<test@ethereal.email>' }),
      };
    };

    try {
      const transporter1 = await getTransporter();
      assert.equal(testAccountCreated, true);
      assert.equal(transportCreatedWithUser, 'mock_ethereal_user@ethereal.email');

      // Verify caching: second call returns the same cached instance without creating a second test account
      testAccountCreated = false;
      const transporter2 = await getTransporter();
      assert.equal(testAccountCreated, false, 'Should reuse cached transporter instance');
      assert.equal(transporter1, transporter2);
    } finally {
      nodemailer.createTestAccount = originalCreateTestAccount;
      nodemailer.createTransport = originalCreateTransport;
    }
  });

  test('resetTransporter clears cached transporter state', () => {
    setTransporter({ dummy: true });
    resetTransporter();
    // After reset, calling reset again should not throw
    assert.doesNotThrow(() => resetTransporter());
  });

  test('getTransporter passes explicit network and socket timeouts to nodemailer.createTransport', async () => {
    const originalCreateTestAccount = nodemailer.createTestAccount;
    const originalCreateTransport = nodemailer.createTransport;

    let capturedOptions = null;

    nodemailer.createTestAccount = async () => ({
      user: 'timeout_test@ethereal.email',
      pass: 'secret',
    });

    nodemailer.createTransport = (opts) => {
      capturedOptions = opts;
      return {
        sendMail: async () => ({ messageId: '<timeout-test@ethereal.email>' }),
      };
    };

    try {
      await getTransporter();
      assert.ok(capturedOptions, 'createTransport must be called with options');
      assert.equal(capturedOptions.connectionTimeout, 10000, 'connectionTimeout must be 10000ms');
      assert.equal(capturedOptions.greetingTimeout, 10000, 'greetingTimeout must be 10000ms');
      assert.equal(capturedOptions.socketTimeout, 30000, 'socketTimeout must be 30000ms');
      assert.equal(capturedOptions.auth?.user, 'timeout_test@ethereal.email');
    } finally {
      nodemailer.createTestAccount = originalCreateTestAccount;
      nodemailer.createTransport = originalCreateTransport;
    }
  });
});
