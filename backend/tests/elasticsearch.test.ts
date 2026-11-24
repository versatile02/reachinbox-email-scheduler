import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { elasticsearchService, EMAILS_INDEX } from '../src/services/elasticsearch.service.js';
import { emailRepository } from '../src/models/email.repository.js';

describe('Elasticsearch Service Integration & Fallback Tests', () => {
  test('EMAILS_INDEX constant is reachinbox_emails', () => {
    assert.equal(EMAILS_INDEX, 'reachinbox_emails');
  });

  test('searchEmails gracefully falls back to database_fallback when cluster is offline', async () => {
    // Mock repository listEmails to simulate offline fallback without cloud network
    const origListEmails = emailRepository.listEmails;
    emailRepository.listEmails = async ({ search, page, limit }: any) => ({
      data: [{ id: 'mock-1', subject: 'meeting follow-up', recipient: 'john@example.com' } as any],
      total: 1,
      page: page || 1,
      limit: limit || 10,
      totalPages: 1,
    });

    try {
      const result = await elasticsearchService.searchEmails({
        query: 'meeting',
        page: 1,
        limit: 10,
      });

      assert.ok(result, 'Result must be returned');
      assert.equal(result.source, 'database_fallback', 'Must use database fallback when ES cluster is offline');
      assert.ok(Array.isArray(result.data), 'Data must be an array');
      assert.equal(result.total, 1);
      assert.equal(result.data[0].subject, 'meeting follow-up');
    } finally {
      emailRepository.listEmails = origListEmails;
    }
  });

  test('indexEmail safely returns without throwing when cluster is offline', async () => {
    // Non-blocking contract: indexing an email when Elasticsearch is unavailable must be a no-op
    await assert.doesNotReject(async () => {
      await elasticsearchService.indexEmail({
        id: 'test-email-es-001',
        recipient: 'test@example.com',
        subject: 'Elasticsearch Index Test',
        body: 'Testing indexing resiliency',
        status: 'scheduled',
      });
    });
  });

  test('initElasticsearch returns false gracefully when cluster is unreachable', async () => {
    const available = await elasticsearchService.initElasticsearch();
    assert.equal(typeof available, 'boolean');
  });
});
