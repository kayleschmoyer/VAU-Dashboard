// Timestamps from the API may be ISO 8601 UTC or legacy SQLite
// "YYYY-MM-DD HH:MM:SS" (also UTC). Normalize either into a Date.
export function parseTimestamp(value) {
  if (!value) return null;
  let s = String(value).trim();
  if (s.includes(' ') && !s.includes('T')) s = s.replace(' ', 'T');
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(s)) s += 'Z';
  const date = new Date(s);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatTime(value) {
  const date = value instanceof Date ? value : parseTimestamp(value);
  if (!date) return '—';
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function timeAgo(value) {
  const date = value instanceof Date ? value : parseTimestamp(value);
  if (!date) return 'never';
  const seconds = (Date.now() - date.getTime()) / 1000;
  if (seconds < 45) return 'just now';
  if (seconds < 3600) return `${Math.max(1, Math.floor(seconds / 60))}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
