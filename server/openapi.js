'use strict';

const { version } = require('../package.json');

const errorResponse = (description) => ({
  description,
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/Error' },
    },
  },
});

const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'VAU Dashboard API',
    version,
    description:
      'Monitoring API for the VAST Auto Updater (VAU). Machines report status events with an API key; ' +
      'dashboard users read fleet state with a JWT. The canonical base path is `/api/v1`; ' +
      '`/api` is maintained as a compatibility alias.',
  },
  servers: [{ url: '/api/v1' }, { url: '/api', description: 'Legacy alias' }],
  tags: [
    { name: 'Auth', description: 'Dashboard user authentication' },
    { name: 'Machines', description: 'Fleet state (JWT required)' },
    { name: 'Status', description: 'Machine status ingestion (API key required)' },
    { name: 'System', description: 'Health and metadata' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      apiKeyAuth: { type: 'apiKey', in: 'header', name: 'x-api-key' },
    },
    schemas: {
      Error: {
        type: 'object',
        required: ['error', 'code'],
        properties: {
          error: { type: 'string', description: 'Human-readable message' },
          code: { type: 'string', description: 'Stable machine-readable error code' },
          requestId: { type: 'string', description: 'Correlation id for this request' },
          details: {
            description: 'Field-level validation issues, when applicable',
            type: 'array',
            items: {
              type: 'object',
              properties: {
                path: { type: 'string' },
                message: { type: 'string' },
              },
            },
          },
        },
      },
      Machine: {
        type: 'object',
        description: 'A machine reduced to actionable fields. Lists are ordered errors-first.',
        properties: {
          id: { type: 'integer' },
          hostname: { type: 'string' },
          customer: { type: 'string' },
          site: { type: 'string' },
          needs_config: {
            type: 'boolean',
            description:
              'True when the machine reports customer "Unknown" — a fresh install whose updater Settings have not been filled in yet.',
          },
          ip_address: { type: ['string', 'null'] },
          current_version: { type: ['string', 'null'] },
          status: { type: 'string', enum: ['online', 'offline', 'error', 'unknown'] },
          error_reason: {
            type: ['string', 'null'],
            description: 'Why the last update failed. Only set when status is "error".',
          },
          error_kind: {
            type: ['string', 'null'],
            enum: ['deployment', 'update', null],
            description:
              '"deployment" = failed before any update began (e.g. no VAST install); ' +
              '"update" = download/install failure. Only set when status is "error".',
          },
          error_code: {
            type: ['string', 'null'],
            description: 'Machine-readable code from the client, when it sent one.',
          },
          last_heartbeat: { type: ['string', 'null'] },
        },
      },
      StatusEvent: {
        type: 'object',
        required: ['customer', 'site', 'hostname', 'machineKey', 'eventType'],
        properties: {
          customer: { type: 'string', maxLength: 200 },
          site: { type: 'string', maxLength: 200 },
          hostname: { type: 'string', maxLength: 255 },
          machineKey: {
            type: 'string',
            maxLength: 255,
            description: 'Stable unique identifier per machine (e.g., machine GUID)',
          },
          eventType: {
            type: 'string',
            enum: ['heartbeat', 'update_start', 'update_success', 'update_failure'],
          },
          version: { type: 'string', maxLength: 100 },
          targetVersion: { type: 'string', maxLength: 100 },
          result: { type: 'string', maxLength: 200 },
          message: { type: 'string', maxLength: 4000 },
          osVersion: { type: 'string', maxLength: 200 },
          errorCode: {
            type: 'string',
            maxLength: 100,
            description:
              'Optional machine-readable failure code. Known values: VastNotFound, ' +
              'VersionParseError, ConnectionFailed, DownloadFailed, HashMismatch, ' +
              'InstallerFailed, Unknown. Older clients omit this field.',
          },
        },
      },
      LogEntry: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          machine_id: { type: 'integer' },
          event_type: { type: 'string' },
          version: { type: ['string', 'null'] },
          result: { type: ['string', 'null'] },
          message: { type: ['string', 'null'] },
          error_code: { type: ['string', 'null'] },
          ip_address: { type: ['string', 'null'] },
          created_at: { type: 'string' },
        },
      },
      Summary: {
        type: 'object',
        description: 'online + offline + errors + unknown = total',
        properties: {
          total: { type: 'integer' },
          online: { type: 'integer' },
          offline: { type: 'integer' },
          errors: { type: 'integer' },
          unknown: { type: 'integer' },
          customers: { type: 'integer' },
          sites: { type: 'integer' },
        },
      },
    },
  },
  paths: {
    '/health': {
      get: {
        tags: ['System'],
        summary: 'Liveness probe',
        responses: {
          200: {
            description: 'Service is running',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string' },
                    timestamp: { type: 'string' },
                    uptime: { type: 'number' },
                    version: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/health/ready': {
      get: {
        tags: ['System'],
        summary: 'Readiness probe (verifies database connectivity)',
        responses: {
          200: { description: 'Ready to serve traffic' },
          503: errorResponse('Database unavailable'),
        },
      },
    },
    '/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Log in and obtain a JWT',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['username', 'password'],
                properties: {
                  username: { type: 'string' },
                  password: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Authenticated',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    token: { type: 'string' },
                    username: { type: 'string' },
                    expiresIn: { type: 'string' },
                  },
                },
              },
            },
          },
          400: errorResponse('Validation failed'),
          401: errorResponse('Invalid credentials'),
          429: errorResponse('Too many login attempts'),
        },
      },
    },
    '/auth/me': {
      get: {
        tags: ['Auth'],
        summary: 'Validate token and return the current user',
        security: [{ bearerAuth: [] }],
        responses: {
          200: {
            description: 'Current user',
            content: {
              'application/json': {
                schema: { type: 'object', properties: { username: { type: 'string' } } },
              },
            },
          },
          401: errorResponse('Missing or invalid token'),
        },
      },
    },
    '/auth/change-password': {
      post: {
        tags: ['Auth'],
        summary: 'Change the current user password',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['currentPassword', 'newPassword'],
                properties: {
                  currentPassword: { type: 'string' },
                  newPassword: { type: 'string', minLength: 8 },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Password updated' },
          400: errorResponse('Validation failed'),
          401: errorResponse('Current password incorrect or token invalid'),
        },
      },
    },
    '/machines': {
      get: {
        tags: ['Machines'],
        summary: 'List machines (name, IP, version, error state) — error machines first',
        security: [{ bearerAuth: [] }],
        responses: {
          200: {
            description: 'Machine list, ordered error > offline > unknown > online',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    machines: { type: 'array', items: { $ref: '#/components/schemas/Machine' } },
                  },
                },
              },
            },
          },
          401: errorResponse('Missing or invalid token'),
        },
      },
    },
    '/machines/summary': {
      get: {
        tags: ['Machines'],
        summary: 'Fleet-wide counts',
        security: [{ bearerAuth: [] }],
        responses: {
          200: {
            description: 'Summary counts',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Summary' } },
            },
          },
          401: errorResponse('Missing or invalid token'),
        },
      },
    },
    '/machines/{id}': {
      delete: {
        tags: ['Machines'],
        summary: 'Permanently delete a machine and its status history',
        description:
          'Removes the machine and all of its status log entries; orphaned sites and customers are ' +
          'pruned. If the machine is still running the updater it will re-register on its next report.',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } },
        ],
        responses: {
          200: {
            description: 'Machine deleted',
            content: {
              'application/json': {
                schema: { type: 'object', properties: { success: { type: 'boolean' } } },
              },
            },
          },
          400: errorResponse('Invalid id'),
          401: errorResponse('Missing or invalid token'),
          404: errorResponse('Machine not found'),
        },
      },
    },
    '/machines/{id}/history': {
      get: {
        tags: ['Machines'],
        summary: 'Paginated status log for one machine',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 500, default: 100 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0, default: 0 } },
        ],
        responses: {
          200: {
            description: 'Status log entries, newest first',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    logs: { type: 'array', items: { $ref: '#/components/schemas/LogEntry' } },
                    pagination: {
                      type: 'object',
                      properties: {
                        limit: { type: 'integer' },
                        offset: { type: 'integer' },
                        total: { type: 'integer' },
                      },
                    },
                  },
                },
              },
            },
          },
          400: errorResponse('Invalid parameters'),
          401: errorResponse('Missing or invalid token'),
          404: errorResponse('Machine not found'),
        },
      },
    },
    '/status': {
      post: {
        tags: ['Status'],
        summary: 'Ingest a machine status event',
        description:
          'Idempotently upserts customer, site, and machine records, then appends the event to the status log. ' +
          'All writes happen in a single transaction.',
        security: [{ apiKeyAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/StatusEvent' } },
          },
        },
        responses: {
          200: {
            description: 'Event recorded',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    machineId: { type: 'integer' },
                  },
                },
              },
            },
          },
          400: errorResponse('Validation failed'),
          401: errorResponse('Invalid API key'),
        },
      },
    },
  },
};

module.exports = openApiDocument;
