const express = require('express');
const { getDb } = require('../db');
const { authenticateApiKey } = require('../middleware/auth');

const router = express.Router();

// POST /api/status — VAU machines post status updates here
// Headers: x-api-key
// Body: { customer, site, hostname, machineKey, eventType, version, targetVersion, result, message, osVersion }
router.post('/', authenticateApiKey, (req, res) => {
  const {
    customer,
    site,
    hostname,
    machineKey,
    eventType,    // "heartbeat" | "update_start" | "update_success" | "update_failure"
    version,
    targetVersion,
    result,
    message,
    osVersion
  } = req.body;

  if (!customer || !site || !hostname || !machineKey || !eventType) {
    return res.status(400).json({
      error: 'Required fields: customer, site, hostname, machineKey, eventType'
    });
  }

  const db = getDb();
  const ip = req.ip || req.connection.remoteAddress;

  // Upsert customer
  db.prepare('INSERT OR IGNORE INTO customers (name) VALUES (?)').run(customer);
  const customerRow = db.prepare('SELECT id FROM customers WHERE name = ?').get(customer);

  // Upsert site
  db.prepare('INSERT OR IGNORE INTO sites (customer_id, name) VALUES (?, ?)').run(customerRow.id, site);
  const siteRow = db.prepare('SELECT id FROM sites WHERE customer_id = ? AND name = ?').get(customerRow.id, site);

  // Upsert machine
  const existingMachine = db.prepare('SELECT id FROM machines WHERE machine_key = ?').get(machineKey);

  if (!existingMachine) {
    db.prepare(`
      INSERT INTO machines (hostname, site_id, machine_key, current_version, target_version, last_heartbeat, ip_address, os_version)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?)
    `).run(hostname, siteRow.id, machineKey, version || null, targetVersion || null, ip, osVersion || null);
  } else {
    const updates = [
      'hostname = ?', 'site_id = ?', 'last_heartbeat = CURRENT_TIMESTAMP', 'ip_address = ?'
    ];
    const params = [hostname, siteRow.id, ip];

    if (version) { updates.push('current_version = ?'); params.push(version); }
    if (targetVersion) { updates.push('target_version = ?'); params.push(targetVersion); }
    if (osVersion) { updates.push('os_version = ?'); params.push(osVersion); }

    if (eventType === 'update_success' || eventType === 'update_failure') {
      updates.push('last_update_result = ?');
      params.push(result || eventType);
      updates.push('last_update_time = CURRENT_TIMESTAMP');
      updates.push('last_update_message = ?');
      params.push(message || null);
    }

    params.push(machineKey);
    db.prepare(`UPDATE machines SET ${updates.join(', ')} WHERE machine_key = ?`).run(...params);
  }

  // Log the event
  const machine = db.prepare('SELECT id FROM machines WHERE machine_key = ?').get(machineKey);
  db.prepare(`
    INSERT INTO status_log (machine_id, event_type, version, result, message, ip_address)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(machine.id, eventType, version || null, result || null, message || null, ip);

  res.json({ success: true });
});

module.exports = router;
