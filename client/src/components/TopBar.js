import React, { useState, useRef, useEffect } from 'react';
import Logo from './Logo';
import { timeAgo } from '../lib/time';

export default function TopBar({
  username,
  lastRefresh,
  refreshing,
  onRefresh,
  onChangePassword,
  onLogout,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  return (
    <header className="topbar">
      <div className="topbar-left">
        <Logo />
        <div className="topbar-title">
          <h1>Vast Auto Installer Dashboard</h1>
        </div>
      </div>

      <div className="topbar-right">
        {lastRefresh && (
          <span className="refresh-time" title={lastRefresh.toLocaleString()}>
            {refreshing ? 'Refreshing…' : `Updated ${timeAgo(lastRefresh)}`}
          </span>
        )}
        <button
          className="btn btn-ghost btn-icon"
          onClick={onRefresh}
          disabled={refreshing}
          title="Refresh now"
          aria-label="Refresh now"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 12a9 9 0 1 1-2.64-6.36" />
            <path d="M21 3v6h-6" />
          </svg>
        </button>

        <div className="user-menu" ref={menuRef}>
          <button
            className="btn btn-ghost user-menu-trigger"
            onClick={() => setMenuOpen((open) => !open)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            <span className="user-avatar" aria-hidden="true">
              {username?.slice(0, 1).toUpperCase()}
            </span>
            <span className="user-name">{username}</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
          {menuOpen && (
            <div className="user-menu-dropdown" role="menu">
              <button role="menuitem" onClick={() => { setMenuOpen(false); onChangePassword(); }}>
                Change password
              </button>
              <button role="menuitem" className="menu-danger" onClick={onLogout}>
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
