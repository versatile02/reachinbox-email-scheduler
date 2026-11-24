import crypto from 'crypto';
import http from 'http';
import https from 'https';
import { URL } from 'url';
import { config } from '../config/index.js';
import { createRedisConnection } from '../config/redis.js';
import { emailRepository } from '../models/email.repository.js';
import type { SlackIntegrationRecord } from '../types/index.js';

let slackRedisClient: ReturnType<typeof createRedisConnection> | null = null;

const getSlackRedis = () => {
  if (!slackRedisClient) {
    slackRedisClient = createRedisConnection(false);
  }
  return slackRedisClient;
};

export const setSlackRedis = (client: any) => {
  slackRedisClient = client;
};

/**
 * Derives a 32-byte key from config.security.encryptionKey using SHA-256
 */
const getEncryptionKey = (): Buffer => {
  return crypto.createHash('sha256').update(config.security.encryptionKey).digest();
};

/**
 * Encrypts sensitive text using AES-256-GCM.
 * Output format: ivHex:authTagHex:encryptedHex
 */
export const encrypt = (plainText: string): string => {
  const iv = crypto.randomBytes(12);
  const key = getEncryptionKey();
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  let encrypted = cipher.update(plainText, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
};

/**
 * Decrypts text encrypted via encrypt().
 */
export const decrypt = (cipherData: string): string => {
  const parts = cipherData.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted ciphertext format');
  }

  const [ivHex, authTagHex, encryptedHex] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const key = getEncryptionKey();

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
};

/**
 * Sends an HTTP POST JSON payload with timeout.
 */
const postJson = async (urlStr: string, payload: object, timeoutMs = 5000): Promise<{ statusCode: number; body: string }> => {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const postData = JSON.stringify(payload);
    const isHttps = url.protocol === 'https:';
    const client = isHttps ? https : http;

    const req = client.request(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
        },
        timeout: timeoutMs,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          resolve({ statusCode: res.statusCode || 200, body });
        });
      }
    );

    req.on('error', (err) => reject(err));
    req.on('timeout', () => {
      req.destroy(new Error(`Slack webhook request timed out after ${timeoutMs}ms`));
    });

    req.write(postData);
    req.end();
  });
};

export interface RateLimitAlertParams {
  senderEmail: string;
  hourlyLimit: number;
  currentCount: number;
  nextWindowDate: Date;
  workerId?: string;
}

/**
 * Dispatches a Slack alert when rate limit is exceeded.
 *
 * Implements a Two-Phase State Machine in Redis:
 * Phase 1: SET slack:alert:{sender}:{epochHour} PENDING:{workerId} NX EX 30
 * Phase 2: On successful HTTP dispatch, SET slack:alert:{sender}:{epochHour} SENT EX 7200
 * On HTTP failure: DEL slack:alert:{sender}:{epochHour}
 *
 * Guarantees:
 * - Exactly one alert per sender per hour.
 * - No alert storms across concurrent workers.
 * - If worker crashes during HTTP call, PENDING lock expires in 30s allowing retry.
 * - Non-blocking: will never throw or interrupt email worker flow.
 */
export const sendRateLimitAlert = async (params: RateLimitAlertParams): Promise<{ alerted: boolean; reason?: string }> => {
  const { senderEmail, hourlyLimit, currentCount, nextWindowDate, workerId = crypto.randomUUID() } = params;
  const normalizedSender = senderEmail.trim().toLowerCase();
  const epochHour = Math.floor(Date.now() / 3600000);
  const alertLockKey = `slack:alert:${normalizedSender}:${epochHour}`;

  const client = getSlackRedis();

  try {
    // Phase 1: Attempt to acquire pending lock
    const acquired = await client.set(alertLockKey, `PENDING:${workerId}`, 'EX', 30, 'NX');
    if (!acquired) {
      // Already locked as PENDING or SENT by another worker this hour
      return { alerted: false, reason: 'Alert already pending or sent for this window' };
    }

    // Determine webhook URL: check database integration first, then environment fallback
    let targetWebhookUrl: string | null = null;
    try {
      const integration = await emailRepository.getSlackIntegration();
      if (integration?.webhookUrl) {
        targetWebhookUrl = integration.webhookUrl.startsWith('iv:') || integration.webhookUrl.includes(':') && integration.webhookUrl.split(':').length === 3
          ? decrypt(integration.webhookUrl)
          : integration.webhookUrl;
      }
    } catch {
      // Fallback
    }

    if (!targetWebhookUrl && config.slack.webhookUrl) {
      targetWebhookUrl = config.slack.webhookUrl;
    }

    if (!targetWebhookUrl) {
      console.log(`[SlackService] Rate limit alert skipped: no Slack webhook configured for ${senderEmail}`);
      // Mark as SENT so we don't repeat this log every job in this hour
      await client.set(alertLockKey, 'SENT', 'EX', 7200);
      return { alerted: false, reason: 'No webhook configured' };
    }

    // Construct Slack message payload
    const payload = {
      text: `⚠️ *ReachInbox Rate Limit Alert*: Sender \`${senderEmail}\` reached hourly limit (${hourlyLimit}/hr).`,
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: '⚠️ ReachInbox Rate Limit Exceeded',
            emoji: true,
          },
        },
        {
          type: 'section',
          fields: [
            {
              type: 'mrkdwn',
              text: `*Sender:*\n\`${senderEmail}\``,
            },
            {
              type: 'mrkdwn',
              text: `*Hourly Limit:*\n*${hourlyLimit}* emails/hr`,
            },
            {
              type: 'mrkdwn',
              text: `*Attempts in Window:*\n*${currentCount}*`,
            },
            {
              type: 'mrkdwn',
              text: `*Next Window Resets:*\n<!date^${Math.floor(nextWindowDate.getTime() / 1000)}^{date_num} {time_secs}|${nextWindowDate.toISOString()}>`,
            },
          ],
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: '🛡️ *ReachInbox Reliable Scheduler*: Subsequent emails for this sender are held and safely rescheduled to the next window boundary without loss.',
            },
          ],
        },
      ],
    };

    // Perform HTTP dispatch
    try {
      const resp = await postJson(targetWebhookUrl, payload);
      if (resp.statusCode >= 200 && resp.statusCode < 300) {
        // Phase 2: Commit SENT state for 7200 seconds (current + buffer)
        await client.set(alertLockKey, 'SENT', 'EX', 7200);
        console.log(`[SlackService] Successfully dispatched rate limit alert to Slack for ${senderEmail}`);
        return { alerted: true };
      } else {
        console.error(`[SlackService] Slack returned status ${resp.statusCode}: ${resp.body}`);
        await client.del(alertLockKey);
        return { alerted: false, reason: `HTTP ${resp.statusCode}` };
      }
    } catch (httpErr: any) {
      console.error(`[SlackService] Failed to dispatch Slack webhook: ${httpErr.message}`);
      await client.del(alertLockKey);
      return { alerted: false, reason: httpErr.message };
    }
  } catch (err: any) {
    console.error(`[SlackService] Error in rate limit alert handler: ${err.message}`);
    return { alerted: false, reason: err.message };
  }
};

/**
 * Closes the Slack Redis connection.
 */
export const closeSlackService = async (): Promise<void> => {
  if (slackRedisClient) {
    await slackRedisClient.quit().catch(() => {});
    slackRedisClient = null;
  }
};

export const slackService = {
  encrypt,
  decrypt,
  sendRateLimitAlert,
  setSlackRedis,
  closeSlackService,
};

export default slackService;
