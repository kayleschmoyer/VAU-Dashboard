'use strict';

const { ZodError } = require('zod');
const { ApiError } = require('../errors');

// Validates req.body / req.params / req.query against zod schemas and exposes
// the parsed (trimmed, coerced) values on req.valid without mutating Express
// request getters.
function validate(schemas) {
  return (req, res, next) => {
    try {
      req.valid = {};
      if (schemas.body) req.valid.body = schemas.body.parse(req.body);
      if (schemas.params) req.valid.params = schemas.params.parse(req.params);
      if (schemas.query) req.valid.query = schemas.query.parse(req.query);
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        const details = err.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        }));
        return next(ApiError.badRequest('Validation failed', details));
      }
      next(err);
    }
  };
}

module.exports = { validate };
