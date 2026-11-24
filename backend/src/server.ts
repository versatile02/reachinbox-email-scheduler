import app from './app.js';
import { config } from './config/index.js';
import { closeEmailQueue } from './queues/email.queue.js';
import { closeDatabasePool } from './config/database.js';
import { closeRateLimiter } from './services/ratelimit.service.js';
import { closeSlackService } from './services/slack.service.js';

const server = app.listen(config.port, () => {
  console.log(`===============================================`);
  console.log(` ReachInbox Scheduler Backend Started Successfully `);
  console.log(` Environment : ${config.env}`);
  console.log(` Port        : ${config.port}`);
  console.log(` Health Check: http://localhost:${config.port}/api/health`);
  console.log(`===============================================`);
});

let isShuttingDown = false;
const SHUTDOWN_TIMEOUT_MS = 10000;
const CONNECTION_DRAIN_MS = 3000;

// Graceful shutdown handling
export const handleShutdown = async (signal: string) => {
  if (isShuttingDown) {
    console.log(`\nShutdown already in progress. Ignoring repeated signal: ${signal}`);
    return;
  }
  isShuttingDown = true;
  console.log(`\nReceived ${signal}. Starting graceful shutdown...`);

  let exitCode = 0;

  const watchdog = setTimeout(() => {
    console.error(`Shutdown watchdog timed out after ${SHUTDOWN_TIMEOUT_MS}ms. Forcing process exit.`);
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);

  try {
    // 1. Stop accepting new incoming HTTP connections
    await new Promise<void>((resolve) => {
      server.close((err) => {
        if (err) {
          console.error('Error closing HTTP server:', err.message);
          exitCode = 1;
        } else {
          console.log('HTTP server stopped accepting new requests.');
        }
        resolve();
      });

      // 2. Allow existing connections a brief grace period to finish, then force-close lingering keep-alives
      setTimeout(() => {
        if (typeof (server as any).closeIdleConnections === 'function') {
          (server as any).closeIdleConnections();
        }
        if (typeof (server as any).closeAllConnections === 'function') {
          (server as any).closeAllConnections();
        }
      }, CONNECTION_DRAIN_MS).unref();
    });

    // 3. Gracefully close BullMQ queue connections
    await closeEmailQueue();
    console.log('All queue connections closed.');

    // 4. Gracefully close Rate Limiter and Slack Redis connections
    await closeRateLimiter();
    await closeSlackService();
    console.log('Redis connections closed.');

    // 5. Gracefully close database connection pool
    await closeDatabasePool();
    console.log('Database connection pool closed.');
  } catch (err: any) {
    console.error('Error during graceful shutdown:', err.message);
    exitCode = 1;
  } finally {
    process.exitCode = exitCode;
    if (exitCode === 0) {
      clearTimeout(watchdog);
    } else {
      watchdog.unref();
    }
  }
};

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));

export { server };
