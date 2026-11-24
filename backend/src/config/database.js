import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const isSslEnabled = process.env.DATABASE_SSL === 'true' ||
  (process.env.DATABASE_URL && process.env.DATABASE_URL.includes('sslmode=require'));

const poolConfig = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: isSslEnabled ? { rejectUnauthorized: false } : false,
      max: parseInt(process.env.DATABASE_POOL_MAX, 10) || 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    }
  : {
      host: process.env.PGHOST || 'localhost',
      port: parseInt(process.env.PGPORT, 10) || 5432,
      user: process.env.PGUSER || 'postgres',
      password: process.env.PGPASSWORD || undefined,
      database: process.env.PGDATABASE || 'reachinbox_scheduler',
      ssl: isSslEnabled ? { rejectUnauthorized: false } : false,
      max: parseInt(process.env.DATABASE_POOL_MAX, 10) || 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
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
export const handlePoolError = (err, client) => {
  // Extract and strictly validate non-sensitive alphanumeric error code (e.g. 'ECONNRESET', '57P01')
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
 * @param {Array} [params] - Bound parameters
 * @returns {Promise<pg.QueryResult>}
 */
export const query = (text, params) => pool.query(text, params);

/**
 * Check whether database configuration is provided in environment variables.
 * @returns {boolean}
 */
export const isDatabaseConfigured = () => {
  return Boolean(process.env.DATABASE_URL || process.env.PGDATABASE);
};

let poolClosePromise = null;

/**
 * Gracefully closes the database pool during shutdown.
 * @returns {Promise<void>}
 */
export const closeDatabasePool = async () => {
  if (poolClosePromise) {
    return poolClosePromise;
  }

  poolClosePromise = (async () => {
    try {
      await pool.end();
      console.log('[PostgreSQL] Connection pool closed gracefully.');
    } catch (err) {
      console.error('[PostgreSQL] Error closing connection pool:', err.message);
      throw err;
    }
  })();

  return poolClosePromise;
};
