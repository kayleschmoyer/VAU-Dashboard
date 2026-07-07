// Seed script: populates the database with sample data for testing
require('dotenv').config();
const { getDb } = require('./db');

const db = getDb();

const customers = [
  { name: 'Acme Restaurant Group', sites: ['Downtown Location', 'Airport Terminal', 'Mall Food Court'] },
  { name: 'Big City Diner', sites: ['Main St', 'Westside'] },
  { name: 'Pizza Palace', sites: ['Store #101', 'Store #102', 'Store #103', 'Store #104'] },
];

function seed() {
  console.log('Seeding database...');

  for (const cust of customers) {
    db.prepare('INSERT OR IGNORE INTO customers (name) VALUES (?)').run(cust.name);
    const c = db.prepare('SELECT id FROM customers WHERE name = ?').get(cust.name);

    for (const siteName of cust.sites) {
      db.prepare('INSERT OR IGNORE INTO sites (customer_id, name) VALUES (?, ?)').run(c.id, siteName);
      const s = db.prepare('SELECT id FROM sites WHERE customer_id = ? AND name = ?').get(c.id, siteName);

      // Add 1-3 machines per site
      const machineCount = Math.floor(Math.random() * 3) + 1;
      for (let i = 1; i <= machineCount; i++) {
        const hostname = `${cust.name.replace(/\s+/g, '').substring(0, 8)}-${siteName.replace(/[^a-zA-Z0-9]/g, '').substring(0, 6)}-POS${i}`;
        const machineKey = `${hostname}-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
        const versions = ['4.2.1', '4.2.0', '4.1.9', '4.3.0-beta'];
        const version = versions[Math.floor(Math.random() * versions.length)];
        const results = ['update_success', 'update_success', 'update_success', 'update_failure', null];
        const updateResult = results[Math.floor(Math.random() * results.length)];

        // Randomize last heartbeat: some recent, some stale
        const minutesAgo = Math.floor(Math.random() * 120);
        const lastHeartbeat = new Date(Date.now() - minutesAgo * 60000).toISOString().replace('T', ' ').replace('Z', '');

        db.prepare(`
          INSERT OR IGNORE INTO machines (hostname, site_id, machine_key, current_version, target_version, last_heartbeat, last_update_result, last_update_time, ip_address, os_version)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          hostname, s.id, machineKey, version, '4.3.0',
          lastHeartbeat, updateResult,
          updateResult ? lastHeartbeat : null,
          `192.168.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`,
          'Windows 10 Pro 22H2'
        );
      }
    }
  }

  console.log('Seed complete.');
}

seed();
