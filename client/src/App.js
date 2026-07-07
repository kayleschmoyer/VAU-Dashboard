import React, { useState, useEffect, useCallback } from 'react';
import { login, checkAuth, logout, getMachines, getSummary, getMachineHistory } from './api';
import './App.css';

// ─── Login Screen ────────────────────────────────────────────
function LoginScreen({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const data = await login(username, password);
      onLogin(data.username);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <form className="login-form" onSubmit={handleSubmit}>
        <h1>VAU Dashboard</h1>
        <p className="login-subtitle">VAST Auto Updater Monitoring</p>
        {error && <div className="error-msg">{error}</div>}
        <input
          type="text" placeholder="Username" value={username}
          onChange={e => setUsername(e.target.value)} autoFocus required
        />
        <input
          type="password" placeholder="Password" value={password}
          onChange={e => setPassword(e.target.value)} required
        />
        <button type="submit" disabled={loading}>
          {loading ? 'Signing in...' : 'Sign In'}
        </button>
      </form>
    </div>
  );
}

// ─── Status Badge ────────────────────────────────────────────
function StatusBadge({ status }) {
  const labels = { online: 'Online', offline: 'Offline', error: 'Error', unknown: 'Unknown' };
  return <span className={`badge badge-${status}`}>{labels[status] || status}</span>;
}

// ─── Summary Cards ───────────────────────────────────────────
function SummaryCards({ summary }) {
  if (!summary) return null;
  return (
    <div className="summary-cards">
      <div className="card card-total"><div className="card-value">{summary.total}</div><div className="card-label">Total Machines</div></div>
      <div className="card card-online"><div className="card-value">{summary.online}</div><div className="card-label">Online</div></div>
      <div className="card card-offline"><div className="card-value">{summary.offline}</div><div className="card-label">Offline</div></div>
      <div className="card card-error"><div className="card-value">{summary.errors}</div><div className="card-label">Errors</div></div>
      <div className="card card-customers"><div className="card-value">{summary.customers}</div><div className="card-label">Customers</div></div>
      <div className="card card-sites"><div className="card-value">{summary.sites}</div><div className="card-label">Sites</div></div>
    </div>
  );
}

// ─── Machine Detail Modal ────────────────────────────────────
function MachineDetail({ machine, onClose }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getMachineHistory(machine.id).then(data => {
      setLogs(data.logs);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [machine.id]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{machine.hostname}</h2>
          <button className="close-btn" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body">
          <div className="detail-grid">
            <div><strong>Status:</strong> <StatusBadge status={machine.status} /></div>
            <div><strong>Customer:</strong> {machine.customer_name}</div>
            <div><strong>Site:</strong> {machine.site_name}</div>
            <div><strong>Version:</strong> {machine.current_version || '—'}</div>
            <div><strong>Target Version:</strong> {machine.target_version || '—'}</div>
            <div><strong>Last Heartbeat:</strong> {formatTime(machine.last_heartbeat)}</div>
            <div><strong>Last Update:</strong> {machine.last_update_result || '—'}</div>
            <div><strong>Last Update Time:</strong> {formatTime(machine.last_update_time)}</div>
            <div><strong>IP Address:</strong> {machine.ip_address || '—'}</div>
            <div><strong>OS:</strong> {machine.os_version || '—'}</div>
          </div>
          {machine.last_update_message && (
            <div className="update-message"><strong>Message:</strong> {machine.last_update_message}</div>
          )}
          <h3>Recent Activity</h3>
          {loading ? <p>Loading...</p> : logs.length === 0 ? <p>No activity recorded.</p> : (
            <table className="log-table">
              <thead><tr><th>Time</th><th>Event</th><th>Version</th><th>Result</th><th>Message</th></tr></thead>
              <tbody>
                {logs.map(log => (
                  <tr key={log.id}>
                    <td>{formatTime(log.created_at)}</td>
                    <td>{log.event_type}</td>
                    <td>{log.version || '—'}</td>
                    <td>{log.result || '—'}</td>
                    <td>{log.message || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Time formatting ─────────────────────────────────────────
function formatTime(isoStr) {
  if (!isoStr) return '—';
  const d = new Date(isoStr.endsWith('Z') ? isoStr : isoStr + 'Z');
  return d.toLocaleString();
}

function timeAgo(isoStr) {
  if (!isoStr) return 'never';
  const d = new Date(isoStr.endsWith('Z') ? isoStr : isoStr + 'Z');
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// ─── Main Dashboard ──────────────────────────────────────────
function Dashboard({ onLogout, username }) {
  const [summary, setSummary] = useState(null);
  const [grouped, setGrouped] = useState({});
  const [selectedMachine, setSelectedMachine] = useState(null);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [allMachines, setAllMachines] = useState([]);
  const [lastRefresh, setLastRefresh] = useState(null);

  const loadData = useCallback(async () => {
    try {
      const [summaryData, machineData] = await Promise.all([getSummary(), getMachines()]);
      setSummary(summaryData);
      setGrouped(machineData.grouped);
      setAllMachines(machineData.machines);
      setLastRefresh(new Date());
    } catch (err) {
      console.error('Failed to load data:', err);
    }
  }, []);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 30000); // refresh every 30s
    return () => clearInterval(interval);
  }, [loadData]);

  const filteredGrouped = {};
  for (const [custName, custData] of Object.entries(grouped)) {
    const filteredSites = {};
    for (const [siteName, siteData] of Object.entries(custData.sites)) {
      const machines = siteData.machines.filter(m => {
        if (filter !== 'all' && m.status !== filter) return false;
        if (search && !m.hostname.toLowerCase().includes(search.toLowerCase()) &&
            !custName.toLowerCase().includes(search.toLowerCase()) &&
            !siteName.toLowerCase().includes(search.toLowerCase())) return false;
        return true;
      });
      if (machines.length > 0) filteredSites[siteName] = { ...siteData, machines };
    }
    if (Object.keys(filteredSites).length > 0) filteredGrouped[custName] = { ...custData, sites: filteredSites };
  }

  return (
    <div className="dashboard">
      <header className="topbar">
        <div className="topbar-left">
          <h1>VAU Dashboard</h1>
          {lastRefresh && <span className="refresh-time">Updated {timeAgo(lastRefresh.toISOString())}</span>}
        </div>
        <div className="topbar-right">
          <span className="username">{username}</span>
          <button className="btn-refresh" onClick={loadData}>Refresh</button>
          <button className="btn-logout" onClick={onLogout}>Logout</button>
        </div>
      </header>

      <SummaryCards summary={summary} />

      <div className="controls">
        <input
          type="text" placeholder="Search machines, customers, sites..."
          value={search} onChange={e => setSearch(e.target.value)} className="search-input"
        />
        <div className="filter-buttons">
          {['all', 'online', 'offline', 'error'].map(f => (
            <button key={f} className={`filter-btn ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
              {f !== 'all' && summary && <span className="filter-count">
                {f === 'online' ? summary.online : f === 'offline' ? summary.offline : summary.errors}
              </span>}
            </button>
          ))}
        </div>
      </div>

      <div className="machine-grid">
        {Object.keys(filteredGrouped).length === 0 ? (
          <div className="empty-state">
            {allMachines.length === 0
              ? 'No machines registered yet. Configure your VAU installations to POST status updates.'
              : 'No machines match the current filter.'}
          </div>
        ) : (
          Object.entries(filteredGrouped).map(([custName, custData]) => (
            <div key={custName} className="customer-group">
              <h2 className="customer-name">{custName}</h2>
              {Object.entries(custData.sites).map(([siteName, siteData]) => (
                <div key={siteName} className="site-group">
                  <h3 className="site-name">{siteName}</h3>
                  <div className="machine-cards">
                    {siteData.machines.map(m => (
                      <div key={m.id} className={`machine-card status-${m.status}`} onClick={() => setSelectedMachine(m)}>
                        <div className="machine-header">
                          <span className="machine-hostname">{m.hostname}</span>
                          <StatusBadge status={m.status} />
                        </div>
                        <div className="machine-info">
                          <div><span className="label">Version:</span> {m.current_version || '—'}</div>
                          <div><span className="label">Last seen:</span> {timeAgo(m.last_heartbeat)}</div>
                          <div><span className="label">Last update:</span> {m.last_update_result || '—'}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ))
        )}
      </div>

      {selectedMachine && <MachineDetail machine={selectedMachine} onClose={() => setSelectedMachine(null)} />}
    </div>
  );
}

// ─── App Root ────────────────────────────────────────────────
export default function App() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    checkAuth()
      .then(data => setUser(data.username))
      .catch(() => setUser(null))
      .finally(() => setChecking(false));
  }, []);

  if (checking) return <div className="loading">Loading...</div>;

  if (!user) return <LoginScreen onLogin={setUser} />;

  return (
    <Dashboard
      username={user}
      onLogout={() => { logout(); setUser(null); }}
    />
  );
}
