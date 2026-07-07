const express = require('express');
const { getDb } = require('../db');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

const OFFLINE_THRESHOLD = parseInt(process.env.OFFLINE_THRESHOLD_MINUTES || '30', 10);

// GET /api/machines — list all machines grouped by customer/site
router.get('/', authenticateToken, (req, res) => {
  const db = getDb();

  const machines = db.prepare(`
    SELECT
      m.id,
      m.hostname,
      m.machine_key,
      m.current_version,
      m.target_version,
      m.last_heartbeat,
      m.last_update_result,
      m.last_update_time,
      m.last_update_message,
      m.ip_address,
      m.os_version,
      s.name as site_name,
      s.id as site_id,
      c.name as customer_name,
      c.id as customer_id
    FROM machines m
    JOIN sites s ON m.site_id = s.id
    JOIN customers c ON s.customer_id = c.id
    ORDER BY c.name, s.name, m.hostname
  `).all();

  // Compute status for each machine
  const now = new Date();
  const enriched = machines.map(m => {
    let status = 'online';
    if (!m.last_heartbeat) {
      status = 'unknown';
    } else {
      const lastSeen = new Date(m.last_heartbeat + 'Z');
      const diffMinutes = (now - lastSeen) / 60000;
      if (diffMinutes > OFFLINE_THRESHOLD) {
        status = 'offline';
      }
    }

    if (m.last_update_result && m.last_update_result.includes('failure')) {
      status = 'error';
    }

    return { ...m, status };
  });

  // Group by customer > site
  const grouped = {};
  for (const m of enriched) {
    if (!grouped[m.customer_name]) {
      grouped[m.customer_name] = { id: m.customer_id, sites: {} };
    }
    if (!grouped[m.customer_name].sites[m.site_name]) {
      grouped[m.customer_name].sites[m.site_name] = { id: m.site_id, machines: [] };
    }
    grouped[m.customer_name].sites[m.site_name].machines.push(m);
  }

  res.json({ machines: enriched, grouped });
});

// GET /api/machines/:id/history — status log for a single machine
router.get('/:id/history', authenticateToken, (req, res) => {
  const db = getDb();
  const logs = db.prepare(`
    SELECT * FROM status_log
    WHERE machine_id = ?
    ORDER BY created_at DESC
    LIMIT 100
  `).all(parseInt(req.params.id, 10));

  res.json({ logs });
});

// GET /api/machines/summary — quick counts
router.get('/summary', authenticateToken, (req, res) => {
  const db = getDb();
  const now = new Date().toISOString();

  const total = db.prepare('SELECT COUNT(*) as count FROM machines').get().count;
  const customers = db.prepare('SELECT COUNT(*) as count FROM customers').get().count;
  const sites = db.prepare('SELECT COUNT(*) as count FROM sites').get().count;

  // Online = heartbeat within threshold
  const thresholdDate = new Date(Date.now() - OFFLINE_THRESHOLD * 60000).toISOString();
  const online = db.prepare('SELECT COUNT(*) as count FROM machines WHERE last_heartbeat > ?').get(thresholdDate).count;
  const errors = db.prepare("SELECT COUNT(*) as count FROM machines WHERE last_update_result LIKE '%failure%'").get().count;
  const offline = total - online;

  res.json({ total, online, offline, errors, customers, sites });
});

module.exports = router;
