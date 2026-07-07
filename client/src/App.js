import React, { useState, useEffect } from 'react';
import { checkAuth, logout } from './api';
import LoginScreen from './components/LoginScreen';
import Dashboard from './components/Dashboard';
import './App.css';

export default function App() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    checkAuth()
      .then((data) => setUser(data.username))
      .catch(() => setUser(null))
      .finally(() => setChecking(false));
  }, []);

  if (checking) {
    return (
      <div className="loading">
        <div className="spinner" aria-hidden="true" />
        <span>Loading…</span>
      </div>
    );
  }

  if (!user) return <LoginScreen onLogin={setUser} />;

  return (
    <Dashboard
      username={user}
      onLogout={() => {
        logout();
        setUser(null);
      }}
    />
  );
}
