'use strict';

const config = require('./config');
const logger = require('./logger');
const { getDb, closeDb } = require('./db');
const createApp = require('./app');

// Open the database (runs migrations, seeds the first admin) before accepting
// traffic — fail fast if the database is unusable.
getDb();

const app = createApp();

const server = app.listen(config.port, () => {
  logger.info(
    { port: config.port, env: config.env, docs: `/api/v1/docs` },
    'VAU Dashboard API listening'
  );
});

// Sensible timeouts for reverse-proxy deployments (Azure/IIS/nginx).
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down gracefully');

  server.close((err) => {
    if (err) {
      logger.error({ err }, 'Error closing HTTP server');
    }
    try {
      closeDb();
    } catch (dbErr) {
      logger.error({ err: dbErr }, 'Error closing database');
    }
    process.exit(err ? 1 : 0);
  });

  // Force-exit if connections refuse to drain.
  setTimeout(() => {
    logger.warn('Forced shutdown after timeout');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'Unhandled promise rejection — exiting');
  shutdown('unhandledRejection');
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception — exiting');
  process.exit(1);
});
