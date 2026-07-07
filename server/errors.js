'use strict';

const logger = require('./logger');
const config = require('./config');

class ApiError extends Error {
  constructor(status, message, { code = 'ERROR', details } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.expose = true;
  }

  static badRequest(message, details) {
    return new ApiError(400, message, { code: 'BAD_REQUEST', details });
  }

  static unauthorized(message = 'Authentication required', code = 'UNAUTHORIZED') {
    return new ApiError(401, message, { code });
  }

  static forbidden(message = 'Forbidden') {
    return new ApiError(403, message, { code: 'FORBIDDEN' });
  }

  static notFound(message = 'Resource not found') {
    return new ApiError(404, message, { code: 'NOT_FOUND' });
  }
}

// Express 4 does not forward rejected promises to the error handler.
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function notFoundHandler(req, res, next) {
  next(ApiError.notFound());
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  let status = err.status || err.statusCode || 500;
  let code = err.code || 'INTERNAL_ERROR';
  let message = err.message || 'Internal server error';
  let details = err.details;

  // body-parser errors: malformed JSON and oversized payloads are client faults.
  if (err.type === 'entity.parse.failed') {
    status = 400;
    code = 'INVALID_JSON';
    message = 'Request body is not valid JSON';
    details = undefined;
  } else if (err.type === 'entity.too.large') {
    status = 413;
    code = 'PAYLOAD_TOO_LARGE';
    message = 'Request body exceeds the size limit';
    details = undefined;
  }

  if (status >= 500) {
    (req.log || logger).error({ err }, 'Unhandled error while processing request');
    if (!err.expose && config.isProduction) {
      message = 'Internal server error';
      code = 'INTERNAL_ERROR';
      details = undefined;
    }
  }

  if (res.headersSent) return;

  res.status(status).json({
    error: message,
    code,
    requestId: req.id,
    ...(details !== undefined && { details }),
  });
}

module.exports = { ApiError, asyncHandler, notFoundHandler, errorHandler };
