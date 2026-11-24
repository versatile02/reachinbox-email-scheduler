import Redis from 'ioredis';
import { config } from './index.js';

/**
 * Common Redis base connection options.
 */
const getBaseRedisOptions = () => {
  const options = {
    host: config.redis.host,
    port: config.redis.port,
    enableReadyCheck: false, // Recommended by BullMQ for ioredis
  };

  if (config.redis.username) {
    options.username = config.redis.username;
  }

  if (config.redis.password) {
    options.password = config.redis.password;
  }

  if (config.redis.tls) {
    options.tls = {};
  }

  return options;
};

/**
 * Returns connection options for BullMQ Workers.
 * Workers require `maxRetriesPerRequest: null` for blocking commands (e.g. BRPOPLPUSH/BLMOVE).
 * @returns {Object}
 */
export const getWorkerConnectionOptions = () => {
  return {
    ...getBaseRedisOptions(),
    maxRetriesPerRequest: null,
    connectTimeout: 5000,
    retryStrategy(times) {
      if (process.env.NODE_ENV === 'test') {
        return null; // Stop reconnect loop in test environment
      }
      // Exponential backoff capped at 5000ms
      return Math.min(times * 500, 5000);
    },
  };
};

/**
 * Returns connection options for BullMQ Producers (API endpoints adding jobs).
 * Producers use bounded retries (`maxRetriesPerRequest: 3`) and a shorter timeout
 * so HTTP requests fail fast instead of hanging when Redis is unavailable.
 * @returns {Object}
 */
export const getProducerConnectionOptions = () => {
  return {
    ...getBaseRedisOptions(),
    maxRetriesPerRequest: 3,
    connectTimeout: 3000,
    retryStrategy(times) {
      if (process.env.NODE_ENV === 'test') {
        return null; // Stop reconnect loop in test environment
      }
      if (times > 10) {
        return null; // Bounded reconnect attempts for producers
      }
      // Faster backoff for producers (up to 2000ms)
      return Math.min(times * 300, 2000);
    },
  };
};

/**
 * Backward-compatible alias returning worker options by default.
 * @returns {Object}
 */
export const getRedisConnectionOptions = () => getWorkerConnectionOptions();

/**
 * Factory function to create an ioredis client with standard event logging.
 * Useful for standalone health probes, diagnostics, and testing connectivity.
 * @param {string} customName - Name identifier for logging
 * @returns {Redis}
 */
export const createRedisClient = (customName = 'default') => {
  const options = getWorkerConnectionOptions();
  const client = new Redis(options);

  client.on('connect', () => {
    console.log(`[Redis:${customName}] Successfully connected to Redis at ${config.redis.host}:${config.redis.port}`);
  });

  client.on('ready', () => {
    console.log(`[Redis:${customName}] Connection is ready to receive commands`);
  });

  client.on('error', (err) => {
    console.error(`[Redis:${customName}] Connection error: ${err.message}`);
  });

  client.on('close', () => {
    console.log(`[Redis:${customName}] Connection closed`);
  });

  client.on('reconnecting', (time) => {
    console.log(`[Redis:${customName}] Reconnecting in ${time}ms...`);
  });

  return client;
};
