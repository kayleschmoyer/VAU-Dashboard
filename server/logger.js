'use strict';

const pino = require('pino');
const config = require('./config');

const logger = pino({
  level: config.logLevel,
  base: { service: 'vau-dashboard-api', env: config.env },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers["x-api-key"]',
      'req.headers.cookie',
    ],
    censor: '[REDACTED]',
  },
});

module.exports = logger;
