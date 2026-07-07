'use strict';

const express = require('express');
const { z } = require('zod');
const config = require('../config');
const { getDb } = require('../db');
const { authenticateToken } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { ApiError } = require('../errors');
const { parseDbTimestamp } = require('../lib/time');

const router = express.Router();

// Status semantics (single source of truth for list + summary):
// error > offline/online > unknown. A machine whose last update failed is
// surfaced as "error" regardless of heartbeat recency.
function computeStatus(machine, now) {
  if (machine.last_update_result && machine.last_update_result.includes('failure')) {
    return 'error';
  }
  const lastSeen = parseDbTimestamp(machine.last_heartbeat);
  if (!lastSeen) return 'unknown';
  const minutesSince = (now.getTime() - lastSeen.getTime()) / 60_000;
  return minutesSince > config.offlineThresholdMinutes ? 'offline' : 'online';
}

const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const historyQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

// Error machines surface first, then the rest by how much attention they need.
const STATUS_ORDER = { error: 0, offline: 1, unknown: 2, online: 3 };

// Unconfigured machines self-report under this customer name (with site set
// to their Windows machine name) until someone fills in the updater Settings.
const UNCONFIGURED_CUSTOMER = 'Unknown';

// GET /machines — the fleet, reduced to what operators act on:
// name, customer/site, IP, current version, and whether (and why) the
// machine errored. Error machines are always listed first.
router.get('/', authenticateToken, (req, res) => {
  const db = getDb();

  const rows = db.prepare(`
    SELECT
      m.id,
      m.hostname,
      m.ip_address,
      m.current_version,
      m.target_version,
      m.last_heartbeat,
      m.last_update_result,
      m.last_update_message,
      m.last_error_code,
      m.last_failure_kind,
      s.name AS site,
      c.name AS customer
    FROM machines m
    JOIN sites s ON s.id = m.site_id
    JOIN customers c ON c.id = s.customer_id
  `).all();

  const now = new Date();
  const machines = rows
    .map((m) => {
      const status = computeStatus(m, now);
      return {
        id: m.id,
        hostname: m.hostname,
        customer: m.customer,
        site: m.site,
        needs_config: m.customer === UNCONFIGURED_CUSTOMER,
        ip_address: m.ip_address,
        current_version: m.current_version,
        status,
        error_reason:
          status === 'error' ? m.last_update_message || m.last_update_result : null,
        // 'deployment' = failed before any update began (no VAST install,
        // etc.); 'update' = a download/install failure with a targetVersion.
        // Rows ingested before failure kinds were recorded fall back to
        // whether a target version was ever seen.
        error_kind:
          status === 'error'
            ? m.last_failure_kind || (m.target_version ? 'update' : 'deployment')
            : null,
        error_code: status === 'error' ? m.last_error_code : null,
        last_heartbeat: m.last_heartbeat,
      };
    })
    .sort(
      (a, b) =>
        STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
        a.hostname.localeCompare(b.hostname)
    );

  res.json({ machines });
});

// GET /machines/summary — fleet-wide counts
// (Registered before /:id/history so "summary" is never captured as a param.)
router.get('/summary', authenticateToken, (req, res) => {
  const db = getDb();

  const machines = db
    .prepare('SELECT last_heartbeat, last_update_result FROM machines')
    .all();
  const customers = db.prepare('SELECT COUNT(*) AS count FROM customers').get().count;
  const sites = db.prepare('SELECT COUNT(*) AS count FROM sites').get().count;

  // Statuses partition the fleet: online + offline + errors + unknown = total.
  const now = new Date();
  const counts = { online: 0, offline: 0, error: 0, unknown: 0 };
  for (const m of machines) {
    counts[computeStatus(m, now)] += 1;
  }

  res.json({
    total: machines.length,
    online: counts.online,
    offline: counts.offline,
    errors: counts.error,
    unknown: counts.unknown,
    customers,
    sites,
  });
});

// GET /machines/:id/history — paginated status log for one machine
router.get(
  '/:id/history',
  authenticateToken,
  validate({ params: idParamSchema, query: historyQuerySchema }),
  (req, res) => {
    const { id } = req.valid.params;
    const { limit, offset } = req.valid.query;
    const db = getDb();

    const machine = db.prepare('SELECT id FROM machines WHERE id = ?').get(id);
    if (!machine) {
      throw ApiError.notFound('Machine not found');
    }

    const total = db
      .prepare('SELECT COUNT(*) AS count FROM status_log WHERE machine_id = ?')
      .get(id).count;

    const logs = db.prepare(`
      SELECT id, machine_id, event_type, version, result, message, error_code, ip_address, created_at
      FROM status_log
      WHERE machine_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT ? OFFSET ?
    `).all(id, limit, offset);

    res.json({ logs, pagination: { limit, offset, total } });
  }
);

// DELETE /machines/:id — permanently remove a machine and its history.
// Orphaned sites/customers are pruned so summary counts stay honest. If the
// machine is still running the updater it will re-register on its next POST.
router.delete(
  '/:id',
  authenticateToken,
  validate({ params: idParamSchema }),
  (req, res) => {
    const { id } = req.valid.params;
    const db = getDb();

    const machine = db
      .prepare('SELECT id, hostname, site_id FROM machines WHERE id = ?')
      .get(id);
    if (!machine) {
      throw ApiError.notFound('Machine not found');
    }

    db.transaction(() => {
      db.prepare('DELETE FROM status_log WHERE machine_id = ?').run(id);
      db.prepare('DELETE FROM machines WHERE id = ?').run(id);

      const machinesLeft = db
        .prepare('SELECT COUNT(*) AS count FROM machines WHERE site_id = ?')
        .get(machine.site_id).count;
      if (machinesLeft === 0) {
        const site = db
          .prepare('SELECT customer_id FROM sites WHERE id = ?')
          .get(machine.site_id);
        db.prepare('DELETE FROM sites WHERE id = ?').run(machine.site_id);

        const sitesLeft = db
          .prepare('SELECT COUNT(*) AS count FROM sites WHERE customer_id = ?')
          .get(site.customer_id).count;
        if (sitesLeft === 0) {
          db.prepare('DELETE FROM customers WHERE id = ?').run(site.customer_id);
        }
      }
    })();

    req.log?.info(
      { machineId: id, hostname: machine.hostname, user: req.user?.username },
      'Machine deleted'
    );
    res.json({ success: true });
  }
);

module.exports = router;
