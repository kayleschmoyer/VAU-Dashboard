import React, { useState, useEffect, useCallback } from 'react';
import Modal from './Modal';
import StatusBadge from './StatusBadge';
import { getMachineHistory } from '../api';
import { formatTime, timeAgo } from '../lib/time';

const PAGE_SIZE = 50;

function EventBadge({ type }) {
  const variant = type.includes('failure')
    ? 'error'
    : type.includes('success')
      ? 'online'
      : 'neutral';
  return <span className={`event-badge event-${variant}`}>{type.replace(/_/g, ' ')}</span>;
}

export default function MachineDetail({ machine, onClose, onDelete }) {
  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');

  const loadPage = useCallback(
    async (offset) => {
      const data = await getMachineHistory(machine.id, { limit: PAGE_SIZE, offset });
      setTotal(data.pagination.total);
      setLogs((prev) => (offset === 0 ? data.logs : [...prev, ...data.logs]));
    },
    [machine.id]
  );

  useEffect(() => {
    setLoading(true);
    setError('');
    loadPage(0)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [loadPage]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      await loadPage(logs.length);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <Modal title={machine.hostname} onClose={onClose} wide>
      <div className="detail-status-row">
        <StatusBadge status={machine.status} />
        <span className="muted" title={formatTime(machine.last_heartbeat)}>
          Last seen {timeAgo(machine.last_heartbeat)}
        </span>
      </div>

      {machine.status === 'error' && (
        <div className="error-callout" role="alert">
          <strong>
            {machine.error_kind === 'deployment' ? 'Deployment problem:' : 'Why it errored:'}
          </strong>{' '}
          {machine.error_reason || 'Update failed'}
          {machine.error_kind === 'deployment' && (
            <div className="error-callout-hint">
              This machine failed before any update began — likely no working VAST installation.
            </div>
          )}
          {machine.error_code && <span className="chip error-code-chip">{machine.error_code}</span>}
        </div>
      )}

      {machine.needs_config && (
        <div className="config-callout">
          <strong>Needs configuration:</strong> this machine hasn't been assigned to a customer
          yet. Enter the Customer Name and Site Number in the updater's Settings on the machine.
        </div>
      )}

      <dl className="detail-grid">
        <div className="detail-item">
          <dt>Customer</dt>
          <dd>{machine.needs_config ? '— (unconfigured)' : machine.customer || '—'}</dd>
        </div>
        <div className="detail-item">
          <dt>Site</dt>
          <dd>{machine.site || '—'}</dd>
        </div>
        <div className="detail-item">
          <dt>IP address</dt>
          <dd className="cell-mono">{machine.ip_address || '—'}</dd>
        </div>
        <div className="detail-item">
          <dt>Current version</dt>
          <dd>{machine.current_version || '—'}</dd>
        </div>
      </dl>

      <div className="activity-header">
        <h3>Activity</h3>
        {total > 0 && (
          <span className="activity-count">
            {logs.length} of {total} events
          </span>
        )}
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {loading ? (
        <p className="muted">Loading…</p>
      ) : logs.length === 0 ? (
        <p className="muted">No activity recorded.</p>
      ) : (
        <>
          <div className="table-wrap">
            <table className="log-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Event</th>
                  <th>Version</th>
                  <th>Message</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id}>
                    <td className="nowrap">{formatTime(log.created_at)}</td>
                    <td><EventBadge type={log.event_type} /></td>
                    <td>{log.version || '—'}</td>
                    <td className="log-message">
                      {log.message || log.result || '—'}
                      {log.error_code && <span className="chip error-code-chip">{log.error_code}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {logs.length < total && (
            <button className="btn btn-ghost btn-block" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? 'Loading…' : `Load more (${total - logs.length} remaining)`}
            </button>
          )}
        </>
      )}

      {onDelete && (
        <div className="detail-footer">
          <button className="btn btn-ghost btn-ghost-danger" onClick={onDelete}>
            Delete this machine…
          </button>
        </div>
      )}
    </Modal>
  );
}
