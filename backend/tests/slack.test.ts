process.env.NODE_ENV = 'test';

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { encrypt, decrypt, sendRateLimitAlert, setSlackRedis } from '../src/services/slack.service.js';
import { emailRepository } from '../src/models/email.repository.js';

describe('Slack Integration & Alert Service Unit Tests', () => {
  let redisStorage: Map<string, any>;
  let mockRedis: any;

  beforeEach(() => {
    redisStorage = new Map();

    mockRedis = {
      set: async (key: string, val: string, ...args: any[]) => {
        const hasNx = args.includes('NX');
        if (hasNx && redisStorage.has(key)) {
          return null; // Key already exists
        }
        redisStorage.set(key, val);
        return 'OK';
      },
      get: async (key: string) => redisStorage.get(key) || null,
      del: async (key: string) => {
        const existed = redisStorage.delete(key);
        return existed ? 1 : 0;
      },
      quit: async () => {},
    };

    setSlackRedis(mockRedis);
  });

  describe('AES-256-GCM Encryption / Decryption', () => {
    test('Encrypts and decrypts secret webhooks correctly', () => {
      const secret = 'https://hooks.slack.com/services/T00/B00/SECRET123';
      const encrypted = encrypt(secret);

      assert.notEqual(encrypted, secret);
      assert.equal(encrypted.split(':').length, 3, 'Must contain iv:authTag:cipher format');

      const decrypted = decrypt(encrypted);
      assert.equal(decrypted, secret);
    });

    test('Throws error when decrypting invalid ciphertext format', () => {
      assert.throws(() => decrypt('invalid-format'), { message: /invalid encrypted ciphertext format/i });
    });
  });

  describe('Two-Phase Slack Alert State Machine', () => {
    test('Skips alert cleanly when no webhook is configured and sets SENT lock', async () => {
      emailRepository.getSlackIntegration = async () => null;

      const result = await sendRateLimitAlert({
        senderEmail: 'test@example.com',
        hourlyLimit: 5,
        currentCount: 5,
        nextWindowDate: new Date(Date.now() + 3600000),
        workerId: 'worker-unit-1',
      });

      assert.equal(result.alerted, false);
      assert.equal(result.reason, 'No webhook configured');

      const epochHour = Math.floor(Date.now() / 3600000);
      const lockKey = `slack:alert:test@example.com:${epochHour}`;
      assert.equal(redisStorage.get(lockKey), 'SENT', 'Should transition state to SENT to avoid repeated checks');
    });

    test('Suppresses duplicate alerts for the same sender within the same hour window', async () => {
      const epochHour = Math.floor(Date.now() / 3600000);
      const lockKey = `slack:alert:dupe@example.com:${epochHour}`;

      // Simulate alert already sent
      redisStorage.set(lockKey, 'SENT');

      const result = await sendRateLimitAlert({
        senderEmail: 'dupe@example.com',
        hourlyLimit: 10,
        currentCount: 10,
        nextWindowDate: new Date(Date.now() + 3600000),
        workerId: 'worker-unit-2',
      });

      assert.equal(result.alerted, false);
      assert.match(result.reason || '', /already pending or sent/i);
    });
  });
});
