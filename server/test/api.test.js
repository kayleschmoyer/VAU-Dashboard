'use strict';

// Environment must be configured before any server module is required.
process.env.NODE_ENV = 'test';
process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test-jwt-secret-0123456789abcdef0123456789abcdef';
process.env.VAU_API_KEY = 'test-api-key-0123456789abcdef';
process.env.DEFAULT_ADMIN_USER = 'admin';
process.env.DEFAULT_ADMIN_PASS = 'test-password-123';
process.env.OFFLINE_THRESHOLD_MINUTES = '30';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const createApp = require('../app');

const API_KEY = process.env.VAU_API_KEY;
let app;
let token;

const machineEvent = {
  customer: 'Acme Restaurant Group',
  site: 'Downtown Location',
  hostname: 'POS-REGISTER-01',
  machineKey: 'test-machine-guid-001',
  eventType: 'heartbeat',
  version: '4.2.1',
  osVersion: 'Windows 10 Pro',
};

before(async () => {
  app = createApp();
  const res = await request(app)
    .post('/api/auth/login')
    .send({ username: 'admin', password: 'test-password-123' });
  assert.equal(res.status, 200);
  token = res.body.token;
});

test('health endpoints respond on both /api and /api/v1', async () => {
  const legacy = await request(app).get('/api/health');
  assert.equal(legacy.status, 200);
  assert.equal(legacy.body.status, 'ok');
  assert.ok(legacy.headers['x-request-id']);

  const v1 = await request(app).get('/api/v1/health');
  assert.equal(v1.status, 200);

  const ready = await request(app).get('/api/v1/health/ready');
  assert.equal(ready.status, 200);
  assert.equal(ready.body.status, 'ready');
});

test('openapi document is served', async () => {
  const res = await request(app).get('/api/v1/openapi.json');
  assert.equal(res.status, 200);
  assert.equal(res.body.openapi, '3.1.0');
  assert.ok(res.body.paths['/status']);
});

test('login rejects missing fields with validation details', async () => {
  const res = await request(app).post('/api/auth/login').send({ username: 'admin' });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'BAD_REQUEST');
  assert.ok(Array.isArray(res.body.details));
});

test('login rejects bad credentials', async () => {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ username: 'admin', password: 'wrong-password' });
  assert.equal(res.status, 401);
  assert.equal(res.body.code, 'INVALID_CREDENTIALS');
  assert.ok(res.body.error);
});

test('login succeeds and /auth/me validates the token', async () => {
  const me = await request(app)
    .get('/api/auth/me')
    .set('Authorization', `Bearer ${token}`);
  assert.equal(me.status, 200);
  assert.equal(me.body.username, 'admin');
});

test('protected routes reject missing and malformed tokens', async () => {
  const noToken = await request(app).get('/api/machines');
  assert.equal(noToken.status, 401);
  assert.ok(noToken.body.error);

  const badToken = await request(app)
    .get('/api/machines')
    .set('Authorization', 'Bearer not-a-real-token');
  assert.equal(badToken.status, 401);
  assert.equal(badToken.body.code, 'INVALID_TOKEN');
});

test('status ingestion requires a valid API key', async () => {
  const noKey = await request(app).post('/api/status').send(machineEvent);
  assert.equal(noKey.status, 401);

  const wrongKey = await request(app)
    .post('/api/status')
    .set('x-api-key', 'wrong-key')
    .send(machineEvent);
  assert.equal(wrongKey.status, 401);
  assert.equal(wrongKey.body.code, 'INVALID_API_KEY');
});

test('status ingestion validates the payload', async () => {
  const res = await request(app)
    .post('/api/status')
    .set('x-api-key', API_KEY)
    .send({ ...machineEvent, eventType: 'not-a-real-event' });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'BAD_REQUEST');
  assert.ok(res.body.details.some((d) => d.path === 'eventType'));
});

test('malformed JSON body returns 400, not 500', async () => {
  const res = await request(app)
    .post('/api/status')
    .set('x-api-key', API_KEY)
    .set('Content-Type', 'application/json')
    .send('{"customer": ');
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'INVALID_JSON');
});

test('status ingestion creates customer, site, and machine transactionally', async () => {
  const res = await request(app)
    .post('/api/status')
    .set('x-api-key', API_KEY)
    .send(machineEvent);
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.ok(Number.isInteger(res.body.machineId));

  // Repeat post updates the same machine rather than duplicating it.
  const repeat = await request(app)
    .post('/api/status')
    .set('x-api-key', API_KEY)
    .send({ ...machineEvent, eventType: 'update_success', version: '4.3.0' });
  assert.equal(repeat.body.machineId, res.body.machineId);
});

test('machines list returns slim actionable fields, errors first', async () => {
  // Ingest a second machine whose update failed mid-install (targetVersion set).
  await request(app)
    .post('/api/status')
    .set('x-api-key', API_KEY)
    .send({
      ...machineEvent,
      hostname: 'POS-REGISTER-02',
      machineKey: 'test-machine-guid-002',
      eventType: 'update_failure',
      targetVersion: '4.3.0',
      message: 'Installer exited with code 1603',
      errorCode: 'InstallerFailed',
    });

  const res = await request(app)
    .get('/api/v1/machines')
    .set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 200);

  const machine = res.body.machines.find((m) => m.hostname === machineEvent.hostname);
  assert.ok(machine, 'ingested machine should appear in the list');
  assert.equal(machine.status, 'online');
  assert.equal(machine.current_version, '4.3.0');
  assert.equal(machine.error_reason, null);
  assert.equal(machine.customer, machineEvent.customer);
  assert.equal(machine.site, machineEvent.site);
  assert.equal(machine.needs_config, false);
  assert.deepEqual(
    Object.keys(machine).sort(),
    [
      'current_version',
      'customer',
      'error_code',
      'error_kind',
      'error_reason',
      'hostname',
      'id',
      'ip_address',
      'last_heartbeat',
      'needs_config',
      'site',
      'status',
    ],
    'list payload stays reduced to actionable fields'
  );

  const failed = res.body.machines.find((m) => m.hostname === 'POS-REGISTER-02');
  assert.equal(failed.status, 'error');
  assert.equal(failed.error_reason, 'Installer exited with code 1603');
  assert.equal(failed.error_kind, 'update', 'failure with a targetVersion is an update problem');
  assert.equal(failed.error_code, 'InstallerFailed');
  assert.equal(res.body.machines[0].status, 'error', 'error machines are listed first');
});

test('unconfigured machines (customer "Unknown") are flagged needs_config', async () => {
  const res = await request(app)
    .post('/api/status')
    .set('x-api-key', API_KEY)
    .send({
      customer: 'Unknown',
      site: 'FRESH-INSTALL-PC',
      hostname: 'FRESH-INSTALL-PC',
      machineKey: 'test-machine-guid-unconfigured',
      eventType: 'heartbeat',
    });
  assert.equal(res.status, 200);

  const list = await request(app)
    .get('/api/machines')
    .set('Authorization', `Bearer ${token}`);
  const machine = list.body.machines.find((m) => m.hostname === 'FRESH-INSTALL-PC');
  assert.ok(machine);
  assert.equal(machine.needs_config, true);
  assert.equal(machine.customer, 'Unknown');
  assert.equal(machine.site, 'FRESH-INSTALL-PC');
});

test('pre-update failures (no targetVersion) surface as deployment problems', async () => {
  await request(app)
    .post('/api/status')
    .set('x-api-key', API_KEY)
    .send({
      customer: 'Unknown',
      site: 'BROKEN-DEPLOY-PC',
      hostname: 'BROKEN-DEPLOY-PC',
      machineKey: 'test-machine-guid-no-vast',
      eventType: 'update_failure',
      message: 'VAST.exe not found on any drive',
      errorCode: 'VastNotFound',
    });

  const list = await request(app)
    .get('/api/machines')
    .set('Authorization', `Bearer ${token}`);
  const machine = list.body.machines.find((m) => m.hostname === 'BROKEN-DEPLOY-PC');
  assert.equal(machine.status, 'error');
  assert.equal(machine.error_kind, 'deployment');
  assert.equal(machine.error_code, 'VastNotFound');
  assert.equal(machine.error_reason, 'VAST.exe not found on any drive');

  // errorCode is persisted on the log entry as well.
  const history = await request(app)
    .get(`/api/machines/${machine.id}/history`)
    .set('Authorization', `Bearer ${token}`);
  assert.equal(history.body.logs[0].error_code, 'VastNotFound');

  // A later success clears the failure classification.
  await request(app)
    .post('/api/status')
    .set('x-api-key', API_KEY)
    .send({
      customer: 'Unknown',
      site: 'BROKEN-DEPLOY-PC',
      hostname: 'BROKEN-DEPLOY-PC',
      machineKey: 'test-machine-guid-no-vast',
      eventType: 'update_success',
      version: '4.3.0',
      targetVersion: '4.3.0',
    });
  const after = await request(app)
    .get('/api/machines')
    .set('Authorization', `Bearer ${token}`);
  const recovered = after.body.machines.find((m) => m.hostname === 'BROKEN-DEPLOY-PC');
  assert.equal(recovered.status, 'online');
  assert.equal(recovered.error_kind, null);
  assert.equal(recovered.error_code, null);
});

test('errorCode remains optional for older clients', async () => {
  const res = await request(app)
    .post('/api/status')
    .set('x-api-key', API_KEY)
    .send({ ...machineEvent, machineKey: 'test-machine-guid-legacy', hostname: 'LEGACY-CLIENT' });
  assert.equal(res.status, 200);
});

test('machines can be deleted, taking their history and orphaned groupings along', async () => {
  await request(app)
    .post('/api/status')
    .set('x-api-key', API_KEY)
    .send({
      customer: 'Delete Me Corp',
      site: 'Solo Site',
      hostname: 'DOOMED-PC',
      machineKey: 'test-machine-guid-doomed',
      eventType: 'heartbeat',
    });

  const list = await request(app)
    .get('/api/machines')
    .set('Authorization', `Bearer ${token}`);
  const doomed = list.body.machines.find((m) => m.hostname === 'DOOMED-PC');
  assert.ok(doomed);

  // Delete requires a dashboard JWT, not an API key.
  const noAuth = await request(app).delete(`/api/machines/${doomed.id}`);
  assert.equal(noAuth.status, 401);

  const res = await request(app)
    .delete(`/api/machines/${doomed.id}`)
    .set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);

  const after = await request(app)
    .get('/api/machines')
    .set('Authorization', `Bearer ${token}`);
  assert.ok(!after.body.machines.some((m) => m.id === doomed.id), 'machine is gone from the list');
  assert.ok(
    !after.body.machines.some((m) => m.customer === 'Delete Me Corp'),
    'orphaned customer is pruned'
  );

  const history = await request(app)
    .get(`/api/machines/${doomed.id}/history`)
    .set('Authorization', `Bearer ${token}`);
  assert.equal(history.status, 404);

  const missing = await request(app)
    .delete('/api/machines/999999')
    .set('Authorization', `Bearer ${token}`);
  assert.equal(missing.status, 404);
});

test('summary counts are consistent with the machine list', async () => {
  const res = await request(app)
    .get('/api/machines/summary')
    .set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 200);
  assert.ok(res.body.total >= 1);
  assert.ok(res.body.online >= 1, 'freshly ingested machine must count as online');
  assert.equal(
    res.body.total,
    res.body.online + res.body.offline + res.body.errors + res.body.unknown,
    'statuses must partition the fleet'
  );
});

test('machine history is paginated and ordered newest-first', async () => {
  const list = await request(app)
    .get('/api/machines')
    .set('Authorization', `Bearer ${token}`);
  const machine = list.body.machines.find((m) => m.hostname === machineEvent.hostname);

  const res = await request(app)
    .get(`/api/machines/${machine.id}/history?limit=1`)
    .set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.logs.length, 1);
  assert.equal(res.body.pagination.total, 2); // heartbeat + update_success
  assert.equal(res.body.logs[0].event_type, 'update_success');
});

test('machine history rejects invalid ids and unknown machines', async () => {
  const invalid = await request(app)
    .get('/api/machines/not-a-number/history')
    .set('Authorization', `Bearer ${token}`);
  assert.equal(invalid.status, 400);

  const missing = await request(app)
    .get('/api/machines/999999/history')
    .set('Authorization', `Bearer ${token}`);
  assert.equal(missing.status, 404);
  assert.equal(missing.body.code, 'NOT_FOUND');
});

test('unknown API routes return JSON 404 with a request id', async () => {
  const res = await request(app)
    .get('/api/does-not-exist')
    .set('x-request-id', 'test-correlation-id');
  assert.equal(res.status, 404);
  assert.equal(res.body.code, 'NOT_FOUND');
  assert.equal(res.body.requestId, 'test-correlation-id');
  assert.equal(res.headers['x-request-id'], 'test-correlation-id');
});

test('password change enforces minimum length and current password', async () => {
  const weak = await request(app)
    .post('/api/auth/change-password')
    .set('Authorization', `Bearer ${token}`)
    .send({ currentPassword: 'test-password-123', newPassword: 'short' });
  assert.equal(weak.status, 400);

  const wrongCurrent = await request(app)
    .post('/api/auth/change-password')
    .set('Authorization', `Bearer ${token}`)
    .send({ currentPassword: 'nope', newPassword: 'a-new-strong-password' });
  assert.equal(wrongCurrent.status, 401);
});
