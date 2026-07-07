'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const pinoHttp = require('pino-http');
const swaggerUi = require('swagger-ui-express');

const config = require('./config');
const logger = require('./logger');
const { getDb } = require('./db');
const { notFoundHandler, errorHandler } = require('./errors');
const openApiDocument = require('./openapi');
const { version } = require('../package.json');

const authRoutes = require('./routes/auth');
const statusRoutes = require('./routes/status');
const machineRoutes = require('./routes/machines');

function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    })
  );

  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const incoming = req.headers['x-request-id'];
        const id =
          typeof incoming === 'string' && /^[\w.-]{1,128}$/.test(incoming)
            ? incoming
            : crypto.randomUUID();
        res.setHeader('x-request-id', id);
        return id;
      },
      customLogLevel: (req, res, err) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
      autoLogging: {
        ignore: (req) => req.url === '/api/health' || req.url === '/api/v1/health',
      },
    })
  );

  app.use(compression());

  if (config.corsOrigins.length > 0) {
    app.use(
      cors({
        origin: config.corsOrigins,
        methods: ['GET', 'POST', 'DELETE'],
        allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'x-request-id'],
        maxAge: 600,
      })
    );
  }

  app.use(express.json({ limit: '256kb' }));

  // ---------------------------------------------------------------- API ----
  const api = express.Router();

  api.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  api.use(
    rateLimit({
      windowMs: config.rateLimit.windowMs,
      max: config.rateLimit.max,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      skip: () => config.isTest,
      handler: (req, res) => {
        res.status(429).json({
          error: 'Too many requests',
          code: 'RATE_LIMITED',
          requestId: req.id,
        });
      },
    })
  );

  api.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version,
    });
  });

  api.get('/health/ready', (req, res) => {
    try {
      getDb().prepare('SELECT 1').get();
      res.json({ status: 'ready', timestamp: new Date().toISOString() });
    } catch (err) {
      req.log?.error({ err }, 'Readiness check failed');
      res.status(503).json({
        error: 'Database unavailable',
        code: 'NOT_READY',
        requestId: req.id,
      });
    }
  });

  api.get('/openapi.json', (req, res) => res.json(openApiDocument));
  api.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiDocument, {
    customSiteTitle: 'VAU Dashboard API Docs',
  }));

  api.use('/auth', authRoutes);
  api.use('/status', statusRoutes);
  api.use('/machines', machineRoutes);

  // Canonical versioned mount plus the legacy alias existing clients use.
  app.use('/api/v1', api);
  app.use('/api', api);

  // ------------------------------------------------------ SPA frontend ----
  const clientBuild = path.join(__dirname, '..', 'client', 'build');
  if (fs.existsSync(path.join(clientBuild, 'index.html'))) {
    app.use(express.static(clientBuild, { index: false, maxAge: '1d' }));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) return next();
      res.set('Cache-Control', 'no-cache');
      res.sendFile(path.join(clientBuild, 'index.html'));
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = createApp;
