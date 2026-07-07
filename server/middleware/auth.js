'use strict';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../config');
const { ApiError } = require('../errors');

// Constant-time comparison, independent of input length.
function safeEqual(a, b) {
  const hashA = crypto.createHash('sha256').update(String(a)).digest();
  const hashB = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

// Verify JWT bearer token for dashboard users.
function authenticateToken(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (!token || !/^Bearer$/i.test(scheme)) {
    return next(ApiError.unauthorized());
  }

  try {
    req.user = jwt.verify(token, config.jwtSecret, {
      issuer: config.jwtIssuer,
      audience: config.jwtAudience,
      algorithms: ['HS256'],
    });
    next();
  } catch (err) {
    next(ApiError.unauthorized('Invalid or expired token', 'INVALID_TOKEN'));
  }
}

// Verify API key for VAU machine status POSTs.
function authenticateApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'];

  if (!apiKey || !safeEqual(apiKey, config.vauApiKey)) {
    return next(ApiError.unauthorized('Invalid API key', 'INVALID_API_KEY'));
  }

  next();
}

function generateToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username },
    config.jwtSecret,
    {
      expiresIn: config.jwtExpiresIn,
      issuer: config.jwtIssuer,
      audience: config.jwtAudience,
      algorithm: 'HS256',
      jwtid: crypto.randomUUID(),
    }
  );
}

module.exports = { authenticateToken, authenticateApiKey, generateToken };
