import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { getMachines, deleteMachine } from '../api';
import TopBar from './TopBar';
import StatusBadge from './StatusBadge';
import MachineDetail from './MachineDetail';
import ChangePasswordModal from './ChangePasswordModal';
import Modal from './Modal';
import { timeAgo, formatTime, parseTimestamp } from '../lib/time';

const REFRESH_INTERVAL_MS = 30_000;

const FILTERS = [
  { key: 'error', label: 'Errors' },
  { key: 'needs_config', label: 'Needs setup' },
  { key: 'all', label: 'All' },
];

const STATS = [
  { key: 'error', label: 'Errors', filter: 'error' },
  { key: 'needs_config', label: 'Needs setup', filter: 'needs_config' },
  { key: 'total', label: 'Total machines', filter: 'all' },
];

const STATUS_ORDER = { error: 0, offline: 1, unknown: 2, online: 3 };

// Machines reporting customer "Unknown" are fresh installs whose updater
// Settings haven't been filled in — they get their own group, not a customer.
const NEEDS_CONFIG_KEY = '__needs_config__';

function groupByCustomer(machines) {
  const map = new Map();
  for (const m of machines) {
    const key = m.needs_config ? NEEDS_CONFIG_KEY : (m.customer || '').trim().toLowerCase();
    if (!map.has(key)) {
      map.set(key, { key, customer: m.customer, needsConfig: !!m.needs_config, machines: [] });
    }
    map.get(key).machines.push(m);
  }
  const groups = [...map.values()];
  for (const g of groups) {
    g.errorCount = g.machines.filter((m) => m.status === 'error').length;
    g.machines.sort(
      (a, b) =>
        STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
        (a.site || '').localeCompare(b.site || '', undefined, { numeric: true }) ||
        a.hostname.localeCompare(b.hostname)
    );
  }
  // Real customers alphabetically; unconfigured machines fold in last.
  return groups.sort((a, b) => {
    if (a.needsConfig !== b.needsConfig) return a.needsConfig ? 1 : -1;
    return (a.customer || '').localeCompare(b.customer || '');
  });
}

export default function Dashboard({ username, onLogout }) {
  const [machines, setMachines] = useState([]);
  const [selectedMachine, setSelectedMachine] = useState(null);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  // Error machines are the reason this dashboard exists — start there.
  const [filter, setFilter] = useState('error');
  const [search, setSearch] = useState('');
  const [lastRefresh, setLastRefresh] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [initialLoad, setInitialLoad] = useState(true);
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const loadData = useCallback(async () => {
    setRefreshing(true);
    try {
      const data = await getMachines();
      setMachines(data.machines);
      setLastRefresh(new Date());
      setLoadError('');
    } catch (err) {
      setLoadError(err.message);
    } finally {
      setRefreshing(false);
      setInitialLoad(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    const interval = setInterval(() => {
      if (!document.hidden) loadData();
    }, REFRESH_INTERVAL_MS);
    const onVisible = () => {
      if (!document.hidden) loadData();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [loadData]);

  const counts = useMemo(() => {
    const c = { total: machines.length, error: 0, online: 0, offline: 0, unknown: 0, needs_config: 0 };
    for (const m of machines) {
      c[m.status] += 1;
      if (m.needs_config) c.needs_config += 1;
    }
    return c;
  }, [machines]);

  const visibleMachines = useMemo(() => {
    const query = search.trim().toLowerCase();
    return machines.filter((m) => {
      if (filter === 'needs_config') {
        if (!m.needs_config) return false;
      } else if (filter !== 'all' && m.status !== filter) {
        return false;
      }
      if (!query) return true;
      return (
        m.hostname.toLowerCase().includes(query) ||
        (m.customer || '').toLowerCase().includes(query) ||
        (m.site || '').toLowerCase().includes(query) ||
        (m.ip_address || '').toLowerCase().includes(query) ||
        (m.current_version || '').toLowerCase().includes(query)
      );
    });
  }, [machines, filter, search]);

  const groups = useMemo(() => groupByCustomer(visibleMachines), [visibleMachines]);

  const toggleGroup = (key) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const requestDelete = (machine) => {
    setDeleteError('');
    setDeleteTarget(machine);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await deleteMachine(deleteTarget.id);
      setDeleteTarget(null);
      if (selectedMachine?.id === deleteTarget.id) setSelectedMachine(null);
      await loadData();
    } catch (err) {
      setDeleteError(err.message);
    } finally {
      setDeleting(false);
    }
  };

  const allClear = !initialLoad && filter === 'error' && counts.error === 0 && !search;

  const renderDetailCell = (m, heartbeat) => {
    if (m.status === 'error') {
      return (
        <span className="reason-text">
          {m.error_kind === 'deployment' && <span className="kind-tag">Deployment problem</span>}
          {m.error_reason || 'Update failed'}
        </span>
      );
    }
    if (m.needs_config) {
      return <span className="ok-text">Awaiting setup — enter Customer/Site in the updater Settings</span>;
    }
    if (m.status === 'online') {
      return <span className="ok-text">Operating normally</span>;
    }
    return (
      <span className="ok-text" title={heartbeat ? formatTime(heartbeat) : undefined}>
        Last seen {timeAgo(m.last_heartbeat)}
      </span>
    );
  };

  return (
    <div className="dashboard">
      <TopBar
        username={username}
        lastRefresh={lastRefresh}
        refreshing={refreshing}
        onRefresh={loadData}
        onChangePassword={() => setShowPasswordModal(true)}
        onLogout={onLogout}
      />

      {loadError && (
        <div className="alert alert-warning banner" role="alert">
          Could not refresh data ({loadError}). Showing last known state — retrying automatically.
        </div>
      )}

      <main className="dashboard-main">
        <div className="stats" role="group" aria-label="Fleet summary">
          {STATS.map(({ key, label, filter: target }) => (
            <button
              key={key}
              className={`stat stat-${key}${target && filter === target ? ' stat-active' : ''}${target ? '' : ' stat-static'}`}
              onClick={target ? () => setFilter(target) : undefined}
              disabled={!target}
            >
              <span className="stat-value">{initialLoad ? '–' : counts[key]}</span>
              <span className="stat-label">{label}</span>
            </button>
          ))}
        </div>

        <div className="controls">
          <div className="search-wrap">
            <svg className="search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
            <input
              type="search"
              placeholder="Search by customer, site, machine, IP, or version…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="search-input"
              aria-label="Search machines"
            />
          </div>
          <div className="filter-buttons" role="group" aria-label="Filter by status">
            {FILTERS.map(({ key, label }) => (
              <button
                key={key}
                className={`filter-btn ${filter === key ? 'active' : ''}`}
                onClick={() => setFilter(key)}
              >
                {label}
                <span className="filter-count">{key === 'all' ? counts.total : counts[key]}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="machine-panel">
          {initialLoad ? (
            <div className="empty-state">Loading fleet data…</div>
          ) : allClear ? (
            <div className="empty-state all-clear">
              <span className="all-clear-mark" aria-hidden="true">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              </span>
              <p className="all-clear-title">All clear</p>
              <p>No machines are reporting errors.</p>
              <button className="btn btn-ghost" onClick={() => setFilter('all')}>
                View all machines
              </button>
            </div>
          ) : visibleMachines.length === 0 ? (
            <div className="empty-state">
              {machines.length === 0
                ? 'No machines registered yet. Configure your VAU installations to POST status updates to /api/v1/status.'
                : 'No machines match the current filter.'}
            </div>
          ) : (
            <div className="table-wrap">
              <table className="machine-table">
                <thead>
                  <tr>
                    <th>Status</th>
                    <th>Machine</th>
                    <th>Site</th>
                    <th>IP address</th>
                    <th>Version</th>
                    <th>Detail</th>
                    <th className="cell-actions" aria-label="Actions" />
                  </tr>
                </thead>
                {groups.map((group) => {
                  const isCollapsed = collapsed.has(group.key);
                  return (
                    <tbody key={group.key} className={isCollapsed ? 'group-collapsed' : ''}>
                      <tr
                        className="group-row"
                        onClick={() => toggleGroup(group.key)}
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            toggleGroup(group.key);
                          }
                        }}
                        aria-expanded={!isCollapsed}
                      >
                        <td colSpan={7}>
                          <span className="group-title">
                            <svg className="group-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <path d="M6 9l6 6 6-6" />
                            </svg>
                            {group.needsConfig ? (
                              <>
                                Needs configuration
                                <span className="badge badge-config">Needs setup</span>
                              </>
                            ) : (
                              group.customer
                            )}
                            <span className="group-count">
                              {group.machines.length} machine{group.machines.length === 1 ? '' : 's'}
                            </span>
                            {group.errorCount > 0 && (
                              <span className="group-errors">
                                {group.errorCount} error{group.errorCount === 1 ? '' : 's'}
                              </span>
                            )}
                          </span>
                        </td>
                      </tr>
                      {!isCollapsed &&
                        group.machines.map((m) => {
                          const heartbeat = parseTimestamp(m.last_heartbeat);
                          return (
                            <tr
                              key={m.id}
                              className={`machine-row row-${m.status}`}
                              tabIndex={0}
                              onClick={() => setSelectedMachine(m)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  setSelectedMachine(m);
                                }
                              }}
                            >
                              <td><StatusBadge status={m.status} /></td>
                              <td className="cell-hostname">{m.hostname}</td>
                              <td>{m.site || '—'}</td>
                              <td className="cell-mono">{m.ip_address || '—'}</td>
                              <td><span className="chip">{m.current_version || '—'}</span></td>
                              <td className="cell-detail">{renderDetailCell(m, heartbeat)}</td>
                              <td className="cell-actions">
                                <button
                                  className="icon-btn delete-btn"
                                  title={`Delete ${m.hostname}`}
                                  aria-label={`Delete ${m.hostname}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    requestDelete(m);
                                  }}
                                >
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                    <path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6M10 11v6M14 11v6" />
                                  </svg>
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  );
                })}
              </table>
            </div>
          )}
        </div>
      </main>

      {selectedMachine && (
        <MachineDetail
          machine={selectedMachine}
          onClose={() => setSelectedMachine(null)}
          onDelete={() => requestDelete(selectedMachine)}
        />
      )}
      {showPasswordModal && <ChangePasswordModal onClose={() => setShowPasswordModal(false)} />}

      {deleteTarget && (
        <Modal title="Delete machine?" onClose={() => !deleting && setDeleteTarget(null)}>
          <p className="delete-warning">
            This permanently removes <strong>{deleteTarget.hostname}</strong>
            {deleteTarget.customer ? (
              <> ({deleteTarget.needs_config ? 'unconfigured' : deleteTarget.customer}
              {deleteTarget.site ? ` / ${deleteTarget.site}` : ''})</>
            ) : null}{' '}
            and its entire event history from the dashboard.
          </p>
          <p className="muted delete-note">
            If the machine is still running the updater, it will re-register the next time it
            reports in.
          </p>
          {deleteError && <div className="alert alert-error">{deleteError}</div>}
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              Cancel
            </button>
            <button className="btn btn-danger" onClick={confirmDelete} disabled={deleting}>
              {deleting ? 'Deleting…' : 'Delete machine'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
