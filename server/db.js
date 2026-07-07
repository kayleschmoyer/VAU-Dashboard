'use strict';

const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const config = require('./config');
const logger = require('./logger');
const { nowIso } = require('./lib/time');

let db;

// Ordered, versioned migrations tracked via PRAGMA user_version. Each entry
// runs at most once, inside a transaction. Never edit an applied migration —
// append a new one.
const MIGRATIONS = [
  {
    version: 1,
    name: 'initial-schema',
    up(database) {
      database.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS customers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT UNIQUE NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS sites (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          customer_id INTEGER NOT NULL,
          name TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (customer_id) REFERENCES customers(id),
          UNIQUE(customer_id, name)
        );

        CREATE TABLE IF NOT EXISTS machines (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          hostname TEXT NOT NULL,
          site_id INTEGER NOT NULL,
          machine_key TEXT UNIQUE NOT NULL,
          current_version TEXT,
          target_version TEXT,
          last_heartbeat DATETIME,
          last_update_result TEXT,
          last_update_time DATETIME,
          last_update_message TEXT,
          ip_address TEXT,
          os_version TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (site_id) REFERENCES sites(id)
        );

        CREATE TABLE IF NOT EXISTS status_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          machine_id INTEGER NOT NULL,
          event_type TEXT NOT NULL,
          version TEXT,
          result TEXT,
          message TEXT,
          ip_address TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (machine_id) REFERENCES machines(id)
        );

        CREATE INDEX IF NOT EXISTS idx_machines_site ON machines(site_id);
        CREATE INDEX IF NOT EXISTS idx_machines_key ON machines(machine_key);
        CREATE INDEX IF NOT EXISTS idx_status_log_machine ON status_log(machine_id);
        CREATE INDEX IF NOT EXISTS idx_status_log_created ON status_log(created_at);
      `);
    },
  },
  {
    version: 2,
    name: 'status-log-composite-index',
    up(database) {
      database.exec(`
        CREATE INDEX IF NOT EXISTS idx_status_log_machine_created
        ON status_log(machine_id, created_at DESC);
      `);
    },
  },
];

function migrate(database) {
  const current = database.pragma('user_version', { simple: true });
  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    database.transaction(() => {
      migration.up(database);
      database.pragma(`user_version = ${migration.version}`);
    })();
    logger.info({ migration: migration.name, version: migration.version }, 'Applied database migration');
  }
}

function ensureAdminUser(database) {
  const { count } = database.prepare('SELECT COUNT(*) AS count FROM users').get();
  if (count > 0) return;

  const hash = bcrypt.hashSync(config.defaultAdminPass, config.bcryptRounds);
  database
    .prepare('INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)')
    .run(config.defaultAdminUser, hash, nowIso());
  logger.info({ username: config.defaultAdminUser }, 'Seeded initial admin user');
}

function getDb() {
  if (!db) {
    db = new Database(config.dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    migrate(db);
    ensureAdminUser(db);
  }
  return db;
}

function closeDb() {
  if (db) {
    db.close();
    db = undefined;
  }
}

module.exports = { getDb, closeDb };
