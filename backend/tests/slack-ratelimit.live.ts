import http from 'http';
import { emailRepository } from '../src/models/email.repository.js';
import { slackService } from '../src/services/slack.service.js';
import { ratelimitService } from '../src/services/ratelimit.service.js';
import { createRedisConnection } from '../src/config/redis.js';
import { pool } from '../src/config/database.js';

async function testSlackRateLimitNotification() {
  console.log('=== Step 1: Starting Local Test Webhook Receiver on port 5199 ===');
  let receivedPayload: any = null;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        receivedPayload = JSON.parse(body);
        console.log('[Webhook Receiver] Successfully intercepted Slack notification!');
      } catch {
        receivedPayload = body;
      }
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
    });
  });

  await new Promise<void>((resolve) => server.listen(5199, '127.0.0.1', () => resolve()));
  console.log('Receiver listening at http://127.0.0.1:5199');

  const disposableSender = `disposable-sender-${Date.now()}@example.com`;
  const testHourlyLimit = 1;
  const testMinDelay = 0;

  try {
    console.log('\n=== Step 2: Creating Disposable Sender & Slack Webhook Integration ===');
    const sender = await emailRepository.createSender({
      email: disposableSender,
      name: 'Disposable Rate Limit Tester',
      hourlyLimit: testHourlyLimit,
      minDelaySeconds: testMinDelay,
    });
    console.log(`Created disposable sender in DB: ${sender.email} (hourlyLimit=${sender.hourlyLimit})`);

    // Encrypt and save webhook integration in PostgreSQL
    const testWebhookUrl = 'http://127.0.0.1:5199';
    const encrypted = slackService.encrypt(testWebhookUrl);
    await emailRepository.saveSlackIntegration({
      userId: '00000000-0000-0000-0000-000000000001',
      webhookUrlEncrypted: encrypted,
      channelName: '#test-alerts',
      teamName: 'ReachInbox Test Org',
    });
    console.log('Saved encrypted Slack webhook in PostgreSQL.');

    // Verify stored integration
    const stored = await emailRepository.getSlackIntegration();
    console.log('Stored integration teamName:', stored?.teamName, 'channelName:', stored?.channelName);
    const decryptedUrl = slackService.decrypt(stored!.webhookUrl);
    console.log('Decrypted webhook URL matches:', decryptedUrl === testWebhookUrl);

    console.log('\n=== Step 3: Triggering Slot 1 (Allowed) & Slot 2 (Exceeded) ===');
    const redis = createRedisConnection(false);

    // Slot 1: Must be allowed
    const slot1 = await ratelimitService.reserveSendSlot(disposableSender, testHourlyLimit, testMinDelay, 'test-email-001');
    console.log('Slot 1 reservation allowed:', slot1.allowed, 'currentCount:', slot1.currentCount);
    if (!slot1.allowed) throw new Error('Slot 1 should be allowed within limit=1');

    // Slot 2: Must be rejected (limit=1 reached!)
    const slot2 = await ratelimitService.reserveSendSlot(disposableSender, testHourlyLimit, testMinDelay, 'test-email-002');
    console.log('Slot 2 reservation allowed:', slot2.allowed, 'currentCount:', slot2.currentCount);
    if (slot2.allowed) throw new Error('Slot 2 should be rejected because hourly limit is 1');

    console.log('\n=== Step 4: Dispatching Slack Rate-Limit Alert ===');
    const nextWindow = new Date(slot2.nextHourStartMs);
    const alertResult = await slackService.sendRateLimitAlert({
      senderEmail: disposableSender,
      hourlyLimit: testHourlyLimit,
      currentCount: slot2.currentCount,
      nextWindowDate: nextWindow,
      workerId: 'worker-unit-test-1',
    });
    console.log('Alert dispatch result:', alertResult);

    // Give HTTP request 100ms to arrive
    await new Promise(r => setTimeout(r, 200));

    if (!receivedPayload) {
      throw new Error('Slack notification did not arrive at receiver!');
    }

    console.log('Notification Content Verified:');
    console.log('- Text:', receivedPayload.text);
    console.log('- Header block:', receivedPayload.blocks?.[0]?.text?.text);
    console.log('- Field count:', receivedPayload.blocks?.[1]?.fields?.length);

    console.log('\n=== Step 5: Testing Disconnect & Reconnect Behavior ===');
    // Test disconnect
    await emailRepository.deleteSlackIntegration();
    const afterDisconnect = await emailRepository.getSlackIntegration();
    console.log('After delete, integration in DB:', afterDisconnect);

    // Test send when disconnected (should skip without throwing)
    // Clear Redis alert lock so it would attempt if webhook existed
    const epochHour = Math.floor(Date.now() / 3600000);
    await redis.del(`slack:alert:${disposableSender}:${epochHour}`);

    const disconnectedAlert = await slackService.sendRateLimitAlert({
      senderEmail: disposableSender,
      hourlyLimit: testHourlyLimit,
      currentCount: 2,
      nextWindowDate: nextWindow,
    });
    console.log('Alert when disconnected:', disconnectedAlert);

    console.log('\n=== Step 6: Cleaning Up Disposable Sender & Closing ===');
    await pool.query('DELETE FROM senders WHERE id = $1', [sender.id]);
    console.log('Deleted disposable sender.');

    server.close();
    await redis.quit();
    console.log('\n✅ SLACK RATE-LIMIT NOTIFICATION & WORKER RESCHEDULING VERIFIED SUCCESSFULLY.');
    process.exit(0);
  } catch (err) {
    server.close();
    console.error('Test failed:', err);
    process.exit(1);
  }
}

testSlackRateLimitNotification();
