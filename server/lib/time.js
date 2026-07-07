'use strict';

function nowIso() {
  return new Date().toISOString();
}

// Timestamps in the database may be ISO 8601 UTC (written by this code) or
// SQLite CURRENT_TIMESTAMP format "YYYY-MM-DD HH:MM:SS" (written by older
// versions). Both are UTC; normalize either into a Date.
function parseDbTimestamp(value) {
  if (!value) return null;
  let s = String(value).trim();
  if (s.includes(' ') && !s.includes('T')) s = s.replace(' ', 'T');
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(s)) s += 'Z';
  const date = new Date(s);
  return Number.isNaN(date.getTime()) ? null : date;
}

module.exports = { nowIso, parseDbTimestamp };
