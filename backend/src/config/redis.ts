import { Redis, type RedisOptions } from 'ioredis';
import net from 'net';
import { config } from './index.js';

/**
 * Creates connection options with configurable retry strategies.
 * @param isWorker - Whether connection is for a blocking BullMQ worker
 * @returns {RedisOptions}
 */
const buildConnectionOptions = (isWorker: boolean): RedisOptions => {
  const retryStrategy = (times: number): number | null => {
    // Stop reconnecting immediately in test environment to avoid lingering background loops
    if (process.env.NODE_ENV === 'test') {
      return null;
    }

    // Workers need to reconnect indefinitely with backoff to recover from Redis restarts
    if (isWorker) {
      const delay = Math.min(times * 500, 5000);
      return delay;
    }

    // Producers fail fast after 10 attempts
    if (times > 10) {
      return null;
    }
    return Math.min(times * 300, 3000);
  };

  const options: RedisOptions = {
    host: config.redis.host,
    port: config.redis.port,
    username: config.redis.username,
    password: config.redis.password,
    connectTimeout: isWorker ? 5000 : 3000,
    maxRetriesPerRequest: isWorker ? null : 3,
    retryStrategy,
    enableReadyCheck: false,
    lazyConnect: true,
    keepAlive: 10000,
  };

  if (config.redis.tls) {
    options.tls = net.isIP(config.redis.host) ? {} : { servername: config.redis.host };
  }

  return options;
};

/**
 * Returns connection options configured strictly for BullMQ Worker instances.
 * BullMQ Worker strictly requires maxRetriesPerRequest: null.
 * @returns {RedisOptions}
 */
export const getWorkerConnectionOptions = (): RedisOptions => buildConnectionOptions(true);

/**
 * Returns connection options configured strictly for BullMQ Queue producers and general Redis clients.
 * Uses bounded retries (maxRetriesPerRequest: 3) so HTTP requests fail fast on Redis connection drop.
 * @returns {RedisOptions}
 */
export const getProducerConnectionOptions = (): RedisOptions => buildConnectionOptions(false);

/**
 * Backward-compatible helper returning worker options by default.
 * @returns {RedisOptions}
 */
export const getRedisConnectionOptions = (): RedisOptions => getWorkerConnectionOptions();

/**
 * Creates and returns an isolated ioredis connection instance.
 * @param {boolean} [isWorker=false]
 * @returns {Redis}
 */
export const createRedisConnection = (isWorker = false): Redis => {
  const options = buildConnectionOptions(isWorker);
  return new Redis(options);
};
