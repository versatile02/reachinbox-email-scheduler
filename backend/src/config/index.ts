import dotenv from 'dotenv';
dotenv.config();

let redisHost = process.env.REDIS_HOST || 'localhost';
let redisPort = parseInt(process.env.REDIS_PORT || '6379', 10);
let redisUsername = process.env.REDIS_USERNAME || undefined;
let redisPassword = process.env.REDIS_PASSWORD || undefined;
let redisTls = process.env.REDIS_TLS === 'true';

// Normalize DATABASE_URL by trimming any enclosing quotes
const rawDbUrl = process.env.DATABASE_URL?.trim();
const cleanDbUrl = rawDbUrl ? rawDbUrl.replace(/^["']|["']$/g, '') : undefined;

// If REDIS_URL is provided, parse it
if (process.env.REDIS_URL) {
  try {
    const rawUrl = process.env.REDIS_URL.trim().replace(/^["']|["']$/g, '');
    const parsedRedisUrl = new URL(rawUrl);
    redisHost = parsedRedisUrl.hostname;
    redisPort = parseInt(parsedRedisUrl.port || '6379', 10);
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

const rawSmtpProvider = (process.env.SMTP_PROVIDER || '').trim().toLowerCase();
const resolvedSmtpProvider: 'gmail' | 'ethereal' | 'custom' =
  rawSmtpProvider === 'gmail'
    ? 'gmail'
    : rawSmtpProvider === 'ethereal'
    ? 'ethereal'
    : rawSmtpProvider === 'custom'
    ? 'custom'
    : process.env.SMTP_HOST && process.env.SMTP_HOST !== 'smtp.ethereal.email'
    ? 'custom'
    : 'ethereal';

const resolvedSmtpHost =
  resolvedSmtpProvider === 'gmail'
    ? 'smtp.gmail.com'
    : process.env.SMTP_HOST || 'smtp.ethereal.email';

const resolvedSmtpPort =
  resolvedSmtpProvider === 'gmail'
    ? 587
    : parseInt(process.env.SMTP_PORT || '587', 10);

const resolvedSmtpSecure =
  resolvedSmtpProvider === 'gmail'
    ? false
    : process.env.SMTP_SECURE === 'true';

const resolvedSmtpUser =
  process.env.SMTP_USER || (resolvedSmtpProvider === 'gmail' ? process.env.GMAIL_USER : undefined);

const resolvedSmtpPass =
  process.env.SMTP_PASS || (resolvedSmtpProvider === 'gmail' ? process.env.GMAIL_APP_PASSWORD : undefined);

const DEFAULT_DEV_ENCRYPTION_KEY = 'reachinbox_default_secret_key_32_bytes!';
const DEFAULT_DEV_SESSION_SECRET = 'reachinbox_secure_session_secret_key_64_bytes!';

/**
 * Validates and resolves security encryption and session secrets.
 * In production (NODE_ENV === 'production'):
 * - ENCRYPTION_KEY is strictly required and must be at least 32 bytes (or 64 hex chars).
 * - SESSION_SECRET is strictly required and must be at least 32 characters.
 * - In non-production environments, allows documented default fallbacks with a visible warning.
 */
export const validateSecurityConfig = (
  env: string = process.env.NODE_ENV || 'development',
  encryptionKey?: string,
  sessionSecret?: string
): { encryptionKey: string; sessionSecret: string } => {
  const encKey = encryptionKey ?? process.env.ENCRYPTION_KEY;
  const sessSec = sessionSecret ?? process.env.SESSION_SECRET;

  if (env === 'production') {
    if (!encKey || encKey === DEFAULT_DEV_ENCRYPTION_KEY) {
      throw new Error(
        'FATAL: ENCRYPTION_KEY is required in production and cannot use the development default. ' +
        'It must be a secure 32-byte key (or 64 hex characters). ' +
        'Run: [Convert]::ToHexString((1..32 | ForEach-Object { Get-Random -Maximum 256 })) to generate one.'
      );
    }
    const byteLength = Buffer.from(encKey, /^[0-9a-fA-F]{64}$/.test(encKey) ? 'hex' : 'utf8').length;
    if (byteLength < 32) {
      throw new Error(
        `FATAL: ENCRYPTION_KEY in production must be at least 32 bytes. Current byte length: ${byteLength}.`
      );
    }

    if (!sessSec || sessSec === DEFAULT_DEV_SESSION_SECRET) {
      throw new Error(
        'FATAL: SESSION_SECRET is required in production and cannot use the development default. ' +
        'It must be at least 32 characters long.'
      );
    }
    if (sessSec.length < 32) {
      throw new Error(
        `FATAL: SESSION_SECRET in production must be at least 32 characters. Current length: ${sessSec.length}.`
      );
    }

    return { encryptionKey: encKey, sessionSecret: sessSec };
  }

  // Non-production fallback with warning
  if (!encKey) {
    console.warn(
      '[Security Notice] ENCRYPTION_KEY not set. Using built-in development key. Configure a 32-byte key before deploying to production.'
    );
  }
  if (!sessSec) {
    console.warn(
      '[Security Notice] SESSION_SECRET not set. Using built-in development secret. Configure a strong secret before deploying to production.'
    );
  }

  return {
    encryptionKey: encKey || DEFAULT_DEV_ENCRYPTION_KEY,
    sessionSecret: sessSec || DEFAULT_DEV_SESSION_SECRET,
  };
};

const resolvedSecrets = validateSecurityConfig();

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
    provider: resolvedSmtpProvider,
    host: resolvedSmtpHost,
    port: resolvedSmtpPort,
    secure: resolvedSmtpSecure,
    user: resolvedSmtpUser,
    pass: resolvedSmtpPass,
    from: process.env.EMAIL_FROM || (resolvedSmtpProvider === 'gmail' && resolvedSmtpUser ? resolvedSmtpUser : 'ReachInbox Scheduler <scheduler@reachinbox.ai>'),
  },
  rateLimit: {
    defaultHourlyLimit: parseInt(process.env.MAX_EMAILS_PER_HOUR || '200', 10),
    defaultMinDelaySeconds: parseInt(process.env.MIN_DELAY_BETWEEN_EMAILS_SECONDS || '2', 10),
    workerConcurrency: parseInt(process.env.WORKER_CONCURRENCY || '5', 10),
  },
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    redirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:5000/api/auth/google/callback',
  },
  slack: {
    clientId: process.env.SLACK_CLIENT_ID || '',
    clientSecret: process.env.SLACK_CLIENT_SECRET || '',
    redirectUri: process.env.SLACK_REDIRECT_URI || 'http://localhost:5000/api/slack/callback',
    webhookUrl: process.env.SLACK_WEBHOOK_URL || '',
  },
  elasticsearch: {
    node: process.env.ELASTICSEARCH_NODE || 'http://localhost:9200',
    index: process.env.ELASTICSEARCH_INDEX || 'reachinbox_emails',
    apiKey: process.env.ELASTICSEARCH_API_KEY || undefined,
    username: process.env.ELASTICSEARCH_USERNAME || undefined,
    password: process.env.ELASTICSEARCH_PASSWORD || undefined,
    enabled: process.env.ELASTICSEARCH_ENABLED !== 'false',
  },
  session: {
    secret: resolvedSecrets.sessionSecret,
    cookieName: 'reachinbox_session',
    maxAgeMs: 7 * 24 * 60 * 60 * 1000, // 7 days
  },
  security: {
    encryptionKey: resolvedSecrets.encryptionKey,
  },
  admin: {
    emails: (
      process.env.ADMIN_EMAILS ||
      'oliver.brown@domain.io,admin@reachinbox.ai,arhamuddin328@gmail.com,arhamuddin442@gmail.com'
    )
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
    user: process.env.ADMIN_USER || 'admin',
    password: process.env.ADMIN_PASSWORD || undefined,
    apiKey: process.env.ADMIN_API_KEY || undefined,
  },
};

export const validateSmtpConfig = (): void => {
  if (config.smtp.provider === 'gmail') {
    if (!config.smtp.user || !config.smtp.pass) {
      throw new Error(
        'SMTP_PROVIDER is set to "gmail", but SMTP_USER (your Gmail address) or SMTP_PASS (Google 16-character App Password) is missing. Silent fallback to Ethereal is disabled when Gmail is selected.'
      );
    }
  }
};

export default config;
