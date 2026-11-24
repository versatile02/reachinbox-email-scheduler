import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  getProducerConnectionOptions,
  getWorkerConnectionOptions,
  getRedisConnectionOptions,
} from '../src/config/redis.js';
import { pool, handlePoolError, getDatabaseSslConfig } from '../src/config/database.js';

describe('Redis Configuration & Options', () => {
  test('Worker connection options require maxRetriesPerRequest: null', () => {
    const workerOpts = getWorkerConnectionOptions();
    assert.equal(workerOpts.maxRetriesPerRequest, null, 'Worker must have maxRetriesPerRequest set to null');
    assert.equal(workerOpts.connectTimeout, 5000, 'Worker should have 5000ms connectTimeout');
    assert.equal(typeof workerOpts.retryStrategy, 'function', 'Worker must have retryStrategy function');
    assert.equal(workerOpts.enableReadyCheck, false, 'enableReadyCheck should be false for BullMQ');
  });

  test('Producer connection options use bounded retries (maxRetriesPerRequest: 3)', () => {
    const producerOpts = getProducerConnectionOptions();
    assert.equal(producerOpts.maxRetriesPerRequest, 3, 'Producer must have maxRetriesPerRequest set to 3');
    assert.equal(producerOpts.connectTimeout, 3000, 'Producer should have 3000ms connectTimeout for fast fail');
    assert.equal(typeof producerOpts.retryStrategy, 'function', 'Producer must have retryStrategy function');
    assert.equal(producerOpts.enableReadyCheck, false, 'enableReadyCheck should be false for BullMQ');
  });

  test('getRedisConnectionOptions provides backward compatibility with worker options', () => {
    const legacyOpts = getRedisConnectionOptions();
    assert.equal(legacyOpts.maxRetriesPerRequest, null);
    assert.equal(legacyOpts.connectTimeout, 5000);
  });

  test('Retry strategies apply capped exponential backoff in non-test env', () => {
    const originalEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      const workerOpts = getWorkerConnectionOptions();
      assert.equal(workerOpts.retryStrategy(1), 500);
      assert.equal(workerOpts.retryStrategy(10), 5000);
      assert.equal(workerOpts.retryStrategy(20), 5000);

      const producerOpts = getProducerConnectionOptions();
      assert.equal(producerOpts.retryStrategy(1), 300);
      assert.equal(producerOpts.retryStrategy(6), 1800);
      assert.equal(producerOpts.retryStrategy(11), null, 'Producer stops retrying after 10 attempts');
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  test('Retry strategies stop reconnecting immediately when NODE_ENV is test', () => {
    const originalEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'test';
      const workerOpts = getWorkerConnectionOptions();
      assert.equal(workerOpts.retryStrategy(1), null);

      const producerOpts = getProducerConnectionOptions();
      assert.equal(producerOpts.retryStrategy(1), null);
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });
});

describe('PostgreSQL Pool Configuration & Error Handling', () => {
  test('Pool registers error handler for idle connection failures', () => {
    const errorListeners = pool.listeners('error');
    assert.ok(errorListeners.length >= 1, 'Pool must have at least one error listener attached');
    assert.ok(errorListeners.includes(handlePoolError), 'handlePoolError must be registered on pool');
  });

  test('handlePoolError logs fixed generic message and validates non-sensitive error code', () => {
    const originalConsoleError = console.error;
    let loggedMessage = '';
    console.error = (...args) => {
      loggedMessage = args.join(' ');
    };

    try {
      // 1. With valid system errno code
      handlePoolError({ message: 'Socket closed', code: 'ECONNRESET' });
      assert.equal(loggedMessage, '[PostgreSQL] Unexpected error on idle database client (code: ECONNRESET)');

      // 2. With valid Postgres SQLSTATE code
      handlePoolError({ message: 'Admin shutdown', code: '57P01' });
      assert.equal(loggedMessage, '[PostgreSQL] Unexpected error on idle database client (code: 57P01)');

      // 3. Without error code
      handlePoolError(new Error('Some error'));
      assert.equal(loggedMessage, '[PostgreSQL] Unexpected error on idle database client');

      // 4. With invalid/arbitrary code that fails validation regex (e.g. contains spaces or symbols)
      handlePoolError({ message: 'Err', code: 'INVALID CODE WITH SPACES' });
      assert.equal(loggedMessage, '[PostgreSQL] Unexpected error on idle database client');
    } finally {
      console.error = originalConsoleError;
    }
  });

  test('handlePoolError never logs credentials from URIs or arbitrary error message formats', () => {
    const originalConsoleError = console.error;
    let loggedMessage = '';
    console.error = (...args) => {
      loggedMessage = args.join(' ');
    };

    try {
      // URI format containing credentials
      const uriError = new Error('Connection failed to postgres://admin:supersecret@db.internal:5432/reachinbox');
      handlePoolError(uriError);
      assert.equal(loggedMessage, '[PostgreSQL] Unexpected error on idle database client');
      assert.equal(loggedMessage.includes('supersecret'), false);
      assert.equal(loggedMessage.includes('admin'), false);
      assert.equal(loggedMessage.includes('db.internal'), false);

      // Arbitrary key-value credential format
      const kvError = new Error('Auth failed for password=my_top_secret_token user=root host=10.0.0.1');
      handlePoolError(kvError);
      assert.equal(loggedMessage, '[PostgreSQL] Unexpected error on idle database client');
      assert.equal(loggedMessage.includes('my_top_secret_token'), false);
      assert.equal(loggedMessage.includes('password'), false);
      assert.equal(loggedMessage.includes('root'), false);
    } finally {
      console.error = originalConsoleError;
    }
  });

  test('handlePoolError safely handles unexpected error values without throwing', () => {
    const originalConsoleError = console.error;
    console.error = () => {};

    try {
      assert.doesNotThrow(() => handlePoolError(null));
      assert.doesNotThrow(() => handlePoolError(undefined));
      assert.doesNotThrow(() => handlePoolError('raw string containing secret'));
      assert.doesNotThrow(() => handlePoolError(12345));
      assert.doesNotThrow(() => handlePoolError({}));
      assert.doesNotThrow(() => handlePoolError({ message: 'secret', stack: 'secret stack' }));
    } finally {
      console.error = originalConsoleError;
    }
  });

  test('Emitting error event on pool does not trigger unhandled exception', () => {
    assert.doesNotThrow(() => {
      pool.emit('error', new Error('Simulated idle client dropped connection'));
    });
  });

  test('PostgreSQL SSL configuration enforces strict certificate verification by default', () => {
    // When SSL is disabled, returns false
    assert.equal(getDatabaseSslConfig(false, false), false);
    assert.equal(getDatabaseSslConfig(false, true), false);

    // When SSL is enabled, default behavior enforces rejectUnauthorized: true
    const strictSsl = getDatabaseSslConfig(true, false);
    assert.deepEqual(strictSsl, { rejectUnauthorized: true }, 'SSL must enforce rejectUnauthorized: true by default');

    // When allowInsecure is true, explicitly opts out to rejectUnauthorized: false
    const insecureSsl = getDatabaseSslConfig(true, true);
    assert.deepEqual(insecureSsl, { rejectUnauthorized: false }, 'DATABASE_SSL_ALLOW_INSECURE=true must opt-out to rejectUnauthorized: false');
  });
});
