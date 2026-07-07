'use strict';

const path = require('path');
const crypto = require('crypto');

require('dotenv').config();

const NODE_ENV = process.env.NODE_ENV || 'development';
const isProduction = NODE_ENV === 'production';
const isTest = NODE_ENV === 'test';

// Known placeholder values that must never be used as real secrets.
const PLACEHOLDER_SECRETS = new Set([
  'change-this-to-a-random-secret-string',
  'change-this-to-a-random-api-key',
  'dev-secret-change-me',
  'dev-api-key',
  'changeme',
  'secret',
]);

function readSecret(name, { minLength = 32, logGenerated = false } = {}) {
  const value = process.env[name];
  if (value && !PLACEHOLDER_SECRETS.has(value) && value.length >= minLength) {
    return value;
  }

  if (isProduction) {
    throw new Error(
      `Refusing to start: ${name} must be set to a random value of at least ` +
      `${minLength} characters in production (placeholder or missing value detected).`
    );
  }

  const generated = crypto.randomBytes(32).toString('hex');
  if (!isTest) {
    // eslint-disable-next-line no-console
    console.warn(
      `[config] ${name} is missing or insecure — using an ephemeral value for this ${NODE_ENV} run.` +
      (logGenerated ? ` Value: ${generated}` : '')
    );
  }
  return generated;
}

function intFromEnv(name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`Invalid value for ${name}: "${raw}" (expected integer between ${min} and ${max}).`);
  }
  return value;
}

function parseTrustProxy(raw) {
  if (raw === undefined || raw === '' || raw === 'false' || raw === '0') return false;
  if (raw === 'true') return 1; // trust exactly one hop (the fronting proxy), never blanket-trust
  const hops = Number.parseInt(raw, 10);
  if (Number.isInteger(hops) && hops > 0) return hops;
  return raw; // named preset ('loopback') or CIDR list
}

function resolveDbPath() {
  const raw = process.env.DB_PATH;
  if (!raw) return path.join(__dirname, '..', 'vau-dashboard.db');
  if (raw === ':memory:') return raw;
  return path.isAbsolute(raw) ? raw : path.join(__dirname, '..', raw);
}

const config = {
  env: NODE_ENV,
  isProduction,
  isTest,

  port: intFromEnv('PORT', 3001, { min: 1, max: 65535 }),
  dbPath: resolveDbPath(),

  jwtSecret: readSecret('JWT_SECRET'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '24h',
  jwtIssuer: 'vau-dashboard',
  jwtAudience: 'vau-dashboard',

  vauApiKey: readSecret('VAU_API_KEY', { minLength: 16, logGenerated: true }),

  defaultAdminUser: process.env.DEFAULT_ADMIN_USER || 'admin',
  defaultAdminPass: process.env.DEFAULT_ADMIN_PASS || 'changeme',

  offlineThresholdMinutes: intFromEnv('OFFLINE_THRESHOLD_MINUTES', 30, { min: 1 }),

  bcryptRounds: intFromEnv('BCRYPT_ROUNDS', 10, { min: 8, max: 15 }),

  logLevel: process.env.LOG_LEVEL || (isTest ? 'silent' : 'info'),

  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),

  // Comma-separated allowlist. Empty = same-origin only (no CORS headers sent).
  corsOrigins: (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),

  rateLimit: {
    windowMs: intFromEnv('RATE_LIMIT_WINDOW_MS', 60_000, { min: 1000 }),
    max: intFromEnv('RATE_LIMIT_MAX', 600, { min: 1 }),
    loginWindowMs: intFromEnv('LOGIN_RATE_LIMIT_WINDOW_MS', 15 * 60_000, { min: 1000 }),
    loginMax: intFromEnv('LOGIN_RATE_LIMIT_MAX', 10, { min: 1 }),
  },
};

if (isProduction && config.defaultAdminPass === 'changeme') {
  // Only used when seeding the very first user, but never allow it silently in prod.
  // eslint-disable-next-line no-console
  console.warn(
    '[config] DEFAULT_ADMIN_PASS is the well-known default. ' +
    'If this is a fresh install, set a strong value before first start.'
  );
}

module.exports = config;
