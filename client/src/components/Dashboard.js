import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { getMachines } from '../api';
import TopBar from './TopBar';
import StatusBadge from './StatusBadge';
import MachineDetail from './MachineDetail';
import ChangePasswordModal from './ChangePasswordModal';
import { timeAgo, formatTime, parseTimestamp } from '../lib/time';

const REFRESH_INTERVAL_MS = 30_000;

const FILTERS = [
  { key: 'error', label: 'Errors' },
  { key: 'all', label: 'All' },
];

const STATS = [
  { key: 'error', label: 'Errors', filter: 'error' },
  { key: 'total', label: 'Total machines', filter: 'all' },
];

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
    const c = { total: machines.length, error: 0, online: 0, offline: 0, unknown: 0 };
    for (const m of machines) c[m.status] += 1;
    return c;
  }, [machines]);

  const visibleMachines = useMemo(() => {
    const query = search.trim().toLowerCase();
    return machines.filter((m) => {
      if (filter !== 'all' && m.status !== filter) return false;
      if (!query) return true;
      return (
        m.hostname.toLowerCase().includes(query) ||
        (m.ip_address || '').toLowerCase().includes(query) ||
        (m.current_version || '').toLowerCase().includes(query)
      );
    });
  }, [machines, filter, search]);

  const allClear = !initialLoad && filter === 'error' && counts.error === 0 && !search;

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
              placeholder="Search by machine, IP, or version…"
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
                    <th>IP address</th>
                    <th>Version</th>
                    <th>Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleMachines.map((m) => {
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
                        <td className="cell-mono">{m.ip_address || '—'}</td>
                        <td><span className="chip">{m.current_version || '—'}</span></td>
                        <td className="cell-detail">
                          {m.status === 'error' ? (
                            <span className="reason-text">{m.error_reason || 'Update failed'}</span>
                          ) : m.status === 'online' ? (
                            <span className="ok-text">Operating normally</span>
                          ) : (
                            <span className="ok-text" title={heartbeat ? formatTime(heartbeat) : undefined}>
                              Last seen {timeAgo(m.last_heartbeat)}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>

      {selectedMachine && (
        <MachineDetail machine={selectedMachine} onClose={() => setSelectedMachine(null)} />
      )}
      {showPasswordModal && <ChangePasswordModal onClose={() => setShowPasswordModal(false)} />}
    </div>
  );
}
