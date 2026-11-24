import app from './app.js';
import { config } from './config/index.js';
import { closeEmailQueue } from './queues/email.queue.js';

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
export const handleShutdown = async (signal) => {
  if (isShuttingDown) {
    console.log(`\nShutdown already in progress. Ignoring repeated signal: ${signal}`);
    return;
  }
  isShuttingDown = true;
  console.log(`\nReceived ${signal}. Starting graceful shutdown...`);

  let exitCode = 0;

  // Active referenced watchdog: guarantees maximum shutdown duration if teardown hangs
  const watchdog = setTimeout(() => {
    console.error(`Shutdown watchdog timed out after ${SHUTDOWN_TIMEOUT_MS}ms. Forcing process exit.`);
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);

  try {
    // 1. Stop accepting new incoming HTTP connections
    await new Promise((resolve) => {
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
        if (typeof server.closeIdleConnections === 'function') {
          server.closeIdleConnections();
        }
        if (typeof server.closeAllConnections === 'function') {
          server.closeAllConnections();
        }
      }, CONNECTION_DRAIN_MS).unref();
    });

    // 3. Gracefully close BullMQ queue connections
    await closeEmailQueue();
    console.log('All queue connections closed.');
  } catch (err) {
    console.error('Error during graceful shutdown:', err.message);
    exitCode = 1;
  } finally {
    process.exitCode = exitCode;
    if (exitCode === 0) {
      clearTimeout(watchdog);
      // Allow Node.js to exit naturally when the event loop is empty
    } else {
      // On failure, unreference watchdog so it does not unnecessarily hold open
      // an otherwise empty loop, while ensuring it will still terminate the process
      // if lingering asynchronous handles keep the event loop alive.
      watchdog.unref();
    }
  }
};

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));
