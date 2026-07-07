'use strict';

const express = require('express');
const { z } = require('zod');
const { getDb } = require('../db');
const { authenticateApiKey } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { nowIso } = require('../lib/time');

const router = express.Router();

const optionalString = (max) =>
  z.string().trim().max(max).optional().nullable().transform((v) => v || null);

const statusEventSchema = z.object({
  customer: z.string().trim().min(1).max(200),
  site: z.string().trim().min(1).max(200),
  hostname: z.string().trim().min(1).max(255),
  machineKey: z.string().trim().min(1).max(255),
  eventType: z.enum(['heartbeat', 'update_start', 'update_success', 'update_failure']),
  version: optionalString(100),
  targetVersion: optionalString(100),
  result: optionalString(200),
  message: optionalString(4000),
  osVersion: optionalString(200),
  // Known values: VastNotFound, VersionParseError, ConnectionFailed,
  // DownloadFailed, HashMismatch, InstallerFailed, Unknown. Kept as a free
  // string so newer clients can add codes without a dashboard deploy; older
  // clients omit it entirely.
  errorCode: optionalString(100),
});

// Single transaction: customer/site/machine upserts and the event log entry
// either all commit or none do.
function ingestEvent(db, event, ip) {
  const now = nowIso();

  const run = db.transaction(() => {
    db.prepare('INSERT OR IGNORE INTO customers (name, created_at) VALUES (?, ?)').run(event.customer, now);
    const customer = db.prepare('SELECT id FROM customers WHERE name = ?').get(event.customer);

    db.prepare('INSERT OR IGNORE INTO sites (customer_id, name, created_at) VALUES (?, ?, ?)').run(
      customer.id,
      event.site,
      now
    );
    const site = db
      .prepare('SELECT id FROM sites WHERE customer_id = ? AND name = ?')
      .get(customer.id, event.site);

    const existing = db.prepare('SELECT id FROM machines WHERE machine_key = ?').get(event.machineKey);

    const isUpdateResult =
      event.eventType === 'update_success' || event.eventType === 'update_failure';

    // A failure with no targetVersion happened before any update began
    // (e.g. "VAST.exe not found on any drive") — a deployment problem, not a
    // download/install problem.
    const failureKind =
      event.eventType === 'update_failure'
        ? event.targetVersion
          ? 'update'
          : 'deployment'
        : null;

    let machineId;
    if (!existing) {
      const inserted = db
        .prepare(`
          INSERT INTO machines (
            hostname, site_id, machine_key, current_version, target_version,
            last_heartbeat, ip_address, os_version, created_at,
            last_update_result, last_update_time, last_update_message,
            last_error_code, last_failure_kind
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          event.hostname,
          site.id,
          event.machineKey,
          event.version,
          event.targetVersion,
          now,
          ip,
          event.osVersion,
          now,
          isUpdateResult ? event.result || event.eventType : null,
          isUpdateResult ? now : null,
          isUpdateResult ? event.message : null,
          event.eventType === 'update_failure' ? event.errorCode : null,
          failureKind
        );
      machineId = inserted.lastInsertRowid;
    } else {
      machineId = existing.id;

      const updates = ['hostname = ?', 'site_id = ?', 'last_heartbeat = ?', 'ip_address = ?'];
      const params = [event.hostname, site.id, now, ip];

      if (event.version) {
        updates.push('current_version = ?');
        params.push(event.version);
      }
      if (event.targetVersion) {
        updates.push('target_version = ?');
        params.push(event.targetVersion);
      }
      if (event.osVersion) {
        updates.push('os_version = ?');
        params.push(event.osVersion);
      }
      if (isUpdateResult) {
        updates.push(
          'last_update_result = ?',
          'last_update_time = ?',
          'last_update_message = ?',
          'last_error_code = ?',
          'last_failure_kind = ?'
        );
        params.push(
          event.result || event.eventType,
          now,
          event.message,
          event.eventType === 'update_failure' ? event.errorCode : null,
          failureKind
        );
      }

      params.push(machineId);
      db.prepare(`UPDATE machines SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    }

    db.prepare(`
      INSERT INTO status_log (machine_id, event_type, version, result, message, error_code, ip_address, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(machineId, event.eventType, event.version, event.result, event.message, event.errorCode, ip, now);

    return machineId;
  });

  return run();
}

// POST /status — VAU machines post status updates here (x-api-key auth)
router.post('/', authenticateApiKey, validate({ body: statusEventSchema }), (req, res) => {
  const event = req.valid.body;
  const machineId = ingestEvent(getDb(), event, req.ip || null);

  req.log?.info(
    { machineId, eventType: event.eventType, customer: event.customer, site: event.site },
    'Status event ingested'
  );
  res.json({ success: true, machineId });
});

module.exports = router;
