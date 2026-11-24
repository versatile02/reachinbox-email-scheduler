import dotenv from 'dotenv';

dotenv.config();

// Support both individual REDIS_* variables and unified REDIS_URL (e.g., Upstash rediss://)
let redisHost = process.env.REDIS_HOST || 'localhost';
let redisPort = parseInt(process.env.REDIS_PORT || '6379', 10);
let redisUsername = process.env.REDIS_USERNAME ? process.env.REDIS_USERNAME.trim() || undefined : undefined;
let redisPassword = process.env.REDIS_PASSWORD || undefined;
let redisTls = process.env.REDIS_TLS === 'true';

const cleanRedisUrl = process.env.REDIS_URL ? process.env.REDIS_URL.trim().replace(/^["']|["']$/g, '') : undefined;
const cleanDbUrl = process.env.DATABASE_URL ? process.env.DATABASE_URL.trim().replace(/^["']|["']$/g, '') : undefined;

if (cleanRedisUrl) {
  try {
    const parsedRedisUrl = new URL(cleanRedisUrl);
    redisHost = parsedRedisUrl.hostname || redisHost;
    redisPort = parsedRedisUrl.port ? parseInt(parsedRedisUrl.port, 10) : (parsedRedisUrl.protocol === 'rediss:' ? 6379 : 6379);
    if (parsedRedisUrl.username) {
      redisUsername = decodeURIComponent(parsedRedisUrl.username);
    }
    if (parsedRedisUrl.password) {
      redisPassword = decodeURIComponent(parsedRedisUrl.password);
    }
    if (parsedRedisUrl.protocol === 'rediss:' || process.env.REDIS_TLS === 'true') {
      redisTls = true;
    }
  } catch (_err) {
    // If not a valid URL string, ignore and fallback to discrete variables
  }
}

const dbUrl = cleanDbUrl;
const isDbSsl = process.env.DATABASE_SSL === 'true' ||
  Boolean(dbUrl && (
    dbUrl.includes('sslmode=require') ||
    dbUrl.includes('sslmode=verify-full') ||
    dbUrl.includes('sslmode=verify-ca') ||
    dbUrl.includes('neon.tech') ||
    dbUrl.includes('supabase.co') ||
    dbUrl.includes('pooler.supabase.com')
  ));

const allowInsecureSsl = process.env.DATABASE_SSL_ALLOW_INSECURE === 'true';

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '5000', 10),
  clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',
  redis: {
    url: process.env.REDIS_URL || undefined,
    host: redisHost,
    port: redisPort,
    username: redisUsername,
    password: redisPassword,
    tls: redisTls,
  },
  database: {
    url: dbUrl,
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT || '5432', 10),
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || undefined,
    database: process.env.PGDATABASE || 'reachinbox_scheduler',
    ssl: isDbSsl ? { rejectUnauthorized: !allowInsecureSsl } : false,
    sslRejectUnauthorized: !allowInsecureSsl,
    max: parseInt(process.env.DATABASE_POOL_MAX || '10', 10),
  },
  smtp: {
    host: process.env.SMTP_HOST || 'smtp.ethereal.email',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || undefined,
    pass: process.env.SMTP_PASS || undefined,
    from: process.env.EMAIL_FROM || 'ReachInbox Scheduler <scheduler@reachinbox.ai>',
  },
  rateLimit: {
    defaultHourlyLimit: parseInt(process.env.MAX_EMAILS_PER_HOUR || '200', 10),
    defaultMinDelaySeconds: parseInt(process.env.MIN_DELAY_BETWEEN_EMAILS_SECONDS || '2', 10),
    workerConcurrency: parseInt(process.env.WORKER_CONCURRENCY || '5', 10),
  },
  slack: {
    clientId: process.env.SLACK_CLIENT_ID || '',
    clientSecret: process.env.SLACK_CLIENT_SECRET || '',
    redirectUri: process.env.SLACK_REDIRECT_URI || 'http://localhost:5000/api/slack/callback',
    webhookUrl: process.env.SLACK_WEBHOOK_URL || '',
  },
  security: {
    encryptionKey: process.env.ENCRYPTION_KEY || 'reachinbox_default_secret_key_32_bytes!',
  },
};

export default config;
