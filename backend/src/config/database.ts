import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const isSslEnabled = process.env.DATABASE_SSL === 'true' ||
  Boolean(process.env.DATABASE_URL && (
    process.env.DATABASE_URL.includes('sslmode=require') ||
    process.env.DATABASE_URL.includes('sslmode=verify-full') ||
    process.env.DATABASE_URL.includes('sslmode=verify-ca') ||
    process.env.DATABASE_URL.includes('neon.tech') ||
    process.env.DATABASE_URL.includes('supabase.co') ||
    process.env.DATABASE_URL.includes('pooler.supabase.com')
  ));

const allowInsecureSsl = process.env.DATABASE_SSL_ALLOW_INSECURE === 'true';

/**
 * Returns PostgreSQL SSL configuration object based on environment settings.
 * Strict certificate verification (rejectUnauthorized: true) is enforced by default whenever SSL is enabled.
 * Only if DATABASE_SSL_ALLOW_INSECURE === 'true' is rejectUnauthorized set to false.
 *
 * @param {boolean} sslEnabled - Whether SSL is active
 * @param {boolean} allowInsecure - Whether insecure/self-signed certificates are explicitly permitted
 * @returns {boolean | { rejectUnauthorized: boolean }}
 */
export const getDatabaseSslConfig = (
  sslEnabled: boolean,
  allowInsecure: boolean
): boolean | { rejectUnauthorized: boolean } => {
  if (!sslEnabled) {
    return false;
  }
  return {
    rejectUnauthorized: !allowInsecure,
  };
};

export const sslConfig = getDatabaseSslConfig(isSslEnabled, allowInsecureSsl);

export const poolConfig: pg.PoolConfig = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: sslConfig,
      max: parseInt(process.env.DATABASE_POOL_MAX || '10', 10),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,
    }
  : {
      host: process.env.PGHOST || 'localhost',
      port: parseInt(process.env.PGPORT || '5432', 10),
      user: process.env.PGUSER || 'postgres',
      password: process.env.PGPASSWORD || undefined,
      database: process.env.PGDATABASE || 'reachinbox_scheduler',
      ssl: sslConfig,
      max: parseInt(process.env.DATABASE_POOL_MAX || '10', 10),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,
    };

export const pool = new Pool(poolConfig);

/**
 * Error listener for unexpected errors emitted by idle clients in the pool.
 * Prevents uncaught exceptions from terminating the Node.js process when an
 * idle connection is dropped or closed by the PostgreSQL server.
 * Note: Does not attempt automatic reconnection or recovery.
 * Strictly uses a fixed generic message and logs only a validated non-sensitive
 * error code to guarantee that credentials or connection strings never leak.
 *
 * @param {Error|any} err - Error emitted by an idle connection
 * @param {pg.PoolClient} [client] - The client that emitted the error
 */
export const handlePoolError = (err: any, _client?: pg.PoolClient): void => {
  const rawCode = err && typeof err === 'object' && typeof err.code === 'string' ? err.code.trim() : null;
  const validCode = rawCode && /^[A-Z0-9_]{3,10}$/i.test(rawCode) ? rawCode.toUpperCase() : null;

  if (validCode) {
    console.error(`[PostgreSQL] Unexpected error on idle database client (code: ${validCode})`);
  } else {
    console.error('[PostgreSQL] Unexpected error on idle database client');
  }
};

pool.on('error', handlePoolError);

/**
 * Execute a parameterized query.
 * @param {string} text - SQL statement with $1, $2 placeholders
 * @param {any[]} [params] - Bound parameters
 * @returns {Promise<pg.QueryResult>}
 */
export const query = (text: string, params?: any[]): Promise<pg.QueryResult> => pool.query(text, params);

/**
 * Check whether database configuration is provided in environment variables.
 * @returns {boolean}
 */
export const isDatabaseConfigured = (): boolean => {
  return Boolean(process.env.DATABASE_URL || process.env.PGDATABASE);
};

let poolClosePromise: Promise<void> | null = null;

/**
 * Gracefully closes the database pool during shutdown.
 * @returns {Promise<void>}
 */
export const closeDatabasePool = async (): Promise<void> => {
  if (poolClosePromise) {
    return poolClosePromise;
  }

  poolClosePromise = (async () => {
    try {
      await pool.end();
      console.log('[PostgreSQL] Connection pool closed gracefully.');
    } catch (err: any) {
      console.error('[PostgreSQL] Error closing connection pool:', err.message);
      throw err;
    }
  })();

  return poolClosePromise;
};
