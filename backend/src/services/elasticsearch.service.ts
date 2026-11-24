import { Client } from '@elastic/elasticsearch';
import { config } from '../config/index.js';
import { emailRepository } from '../models/email.repository.js';
import type { EmailRecord } from '../types/index.js';

export const EMAILS_INDEX = 'reachinbox_emails';

let esClient: Client | null = null;
let isEsAvailable = false;

export const getElasticsearchClient = (): Client | null => {
  if (!config.elasticsearch.node) {
    return null;
  }

  if (!esClient) {
    try {
      const clientOptions: any = {
        node: config.elasticsearch.node,
      };

      if (config.elasticsearch.apiKey) {
        clientOptions.auth = { apiKey: config.elasticsearch.apiKey };
      } else if (config.elasticsearch.username && config.elasticsearch.password) {
        clientOptions.auth = {
          username: config.elasticsearch.username,
          password: config.elasticsearch.password,
        };
      }

      esClient = new Client(clientOptions);
    } catch (err: any) {
      console.warn('[Elasticsearch] Failed to initialize client:', err.message);
      esClient = null;
    }
  }

  return esClient;
};

/**
 * Initializes index and schema mappings if Elasticsearch is reachable.
 */
export const initElasticsearch = async (): Promise<boolean> => {
  const client = getElasticsearchClient();
  if (!client) {
    isEsAvailable = false;
    return false;
  }

  try {
    const ping = await client.ping();
    if (!ping) {
      isEsAvailable = false;
      return false;
    }

    const indexExists = await client.indices.exists({ index: EMAILS_INDEX });
    if (!indexExists) {
      await client.indices.create({
        index: EMAILS_INDEX,
        mappings: {
          properties: {
            id: { type: 'keyword' },
            userId: { type: 'keyword' },
            senderEmail: { type: 'keyword' },
            recipient: { type: 'text', fields: { keyword: { type: 'keyword' } } },
            subject: { type: 'text' },
            body: { type: 'text' },
            status: { type: 'keyword' },
            scheduledAt: { type: 'date' },
            sentAt: { type: 'date' },
            createdAt: { type: 'date' },
          },
        },
      } as any);
      console.log(`[Elasticsearch] Created index '${EMAILS_INDEX}' with schema mapping.`);
    }

    isEsAvailable = true;
    console.log('[Elasticsearch] Connected and ready.');
    return true;
  } catch (err: any) {
    console.warn('[Elasticsearch] Service unavailable, falling back to database search:', err.message);
    isEsAvailable = false;
    return false;
  }
};

/**
 * Indexes or updates an email record in Elasticsearch.
 * Non-blocking: never throws error if Elasticsearch is offline.
 */
export const indexEmail = async (email: Partial<EmailRecord>): Promise<void> => {
  const client = getElasticsearchClient();
  if (!client || !isEsAvailable || !email.id) {
    return;
  }

  try {
    await client.index({
      index: EMAILS_INDEX,
      id: email.id,
      document: {
        id: email.id,
        userId: email.userId,
        senderEmail: email.senderEmail,
        recipient: email.recipient,
        subject: email.subject,
        body: email.body,
        status: email.status,
        scheduledAt: email.scheduledAt,
        sentAt: email.sentAt,
        createdAt: email.createdAt,
      },
    });
  } catch (err: any) {
    console.warn(`[Elasticsearch] Failed to index email ${email.id}:`, err.message);
  }
};

export interface SearchEmailsParams {
  query?: string;
  userId?: string;
  status?: string;
  senderEmail?: string;
  page?: number;
  limit?: number;
}

export interface SearchEmailsResult {
  data: EmailRecord[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  source: 'elasticsearch' | 'database_fallback';
}

/**
 * Searches emails with full-text query.
 * Gracefully falls back to PostgreSQL ILIKE search when Elasticsearch is offline.
 */
export const searchEmails = async (params: SearchEmailsParams): Promise<SearchEmailsResult> => {
  const { query = '', userId, status, senderEmail, page = 1, limit = 20 } = params;
  const client = getElasticsearchClient();

  if (client && isEsAvailable && query.trim()) {
    try {
      const from = (page - 1) * limit;
      const mustClauses: any[] = [];

      mustClauses.push({
        multi_match: {
          query: query.trim(),
          fields: ['subject^3', 'body', 'recipient^2', 'senderEmail'],
          fuzziness: 'AUTO',
        },
      });

      const filterClauses: any[] = [];
      if (userId) {
        filterClauses.push({ term: { userId } });
      }
      if (status) {
        filterClauses.push({ term: { status: status.toLowerCase() } });
      }
      if (senderEmail) {
        filterClauses.push({ term: { senderEmail: senderEmail.toLowerCase() } });
      }

      const esResponse = await client.search({
        index: EMAILS_INDEX,
        from,
        size: limit,
        query: {
          bool: {
            must: mustClauses,
            filter: filterClauses,
          },
        },
        sort: [{ scheduledAt: { order: 'desc' } }],
      });

      const totalValue =
        typeof esResponse.hits.total === 'number'
          ? esResponse.hits.total
          : esResponse.hits.total?.value || 0;

      const emails: EmailRecord[] = esResponse.hits.hits.map((hit: any) => hit._source);

      return {
        data: emails,
        total: totalValue,
        page,
        limit,
        totalPages: Math.ceil(totalValue / limit) || 1,
        source: 'elasticsearch',
      };
    } catch (esErr: any) {
      console.warn('[Elasticsearch] Search query failed, falling back to PostgreSQL:', esErr.message);
    }
  }

  // Graceful fallback to PostgreSQL
  const dbResult = await emailRepository.listEmails({
    userId,
    status,
    senderEmail,
    search: query.trim() || undefined,
    page,
    limit,
  });

  return {
    data: (dbResult as any).data || (dbResult as any).emails || [],
    total: dbResult.total,
    page: dbResult.page,
    limit: dbResult.limit,
    totalPages: dbResult.totalPages,
    source: 'database_fallback',
  };
};

/**
 * Bulk re-indexes all emails from PostgreSQL to Elasticsearch.
 */
export const reindexAllFromDatabase = async (): Promise<{ indexed: number; total: number }> => {
  const client = getElasticsearchClient();
  if (!client) {
    throw new Error('Elasticsearch client is not configured');
  }

  const emailsResult = await emailRepository.listEmails({ limit: 10000, page: 1 });
  const emails = (emailsResult as any).data || (emailsResult as any).emails || [];

  if (emails.length === 0) {
    return { indexed: 0, total: 0 };
  }

  const operations = emails.flatMap((doc: EmailRecord) => [
    { index: { _index: EMAILS_INDEX, _id: doc.id } },
    {
      id: doc.id,
      userId: doc.userId,
      senderEmail: doc.senderEmail,
      recipient: doc.recipient,
      subject: doc.subject,
      body: doc.body,
      status: doc.status,
      scheduledAt: doc.scheduledAt,
      sentAt: doc.sentAt,
      createdAt: doc.createdAt,
    },
  ]);

  const bulkResponse = await client.bulk({ refresh: true, operations });
  const indexed = bulkResponse.items.filter((item: any) => !item.index?.error).length;

  return { indexed, total: emails.length };
};

export const elasticsearchService = {
  getElasticsearchClient,
  initElasticsearch,
  indexEmail,
  searchEmails,
  reindexAllFromDatabase,
  isAvailable: () => isEsAvailable,
};

export default elasticsearchService;
