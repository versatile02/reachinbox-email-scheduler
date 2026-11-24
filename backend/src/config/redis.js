import Redis from 'ioredis';
import { config } from './index.js';

/**
 * Returns standard connection options for BullMQ queues and workers.
 * BullMQ requires `maxRetriesPerRequest: null`.
 */
export const getRedisConnectionOptions = () => {
  const options = {
    host: config.redis.host,
    port: config.redis.port,
    maxRetriesPerRequest: null, // Required by BullMQ for blocking operations
    enableReadyCheck: false,    // Recommended by BullMQ for ioredis
    connectTimeout: 5000,
    retryStrategy(times) {
      // Exponential backoff with a maximum delay of 5000ms
      const delay = Math.min(times * 500, 5000);
      return delay;
    },
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
 * Factory function to create an ioredis client with standard event logging.
 * Useful for standalone health probes, diagnostics, and testing connectivity.
 * @param {string} customName - Name identifier for logging
 * @returns {Redis}
 */
export const createRedisClient = (customName = 'default') => {
  const options = getRedisConnectionOptions();
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
