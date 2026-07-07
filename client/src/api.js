const API_BASE = '/api';

function getToken() {
  return localStorage.getItem('vau_token');
}

function setToken(token) {
  localStorage.setItem('vau_token', token);
}

function clearToken() {
  localStorage.removeItem('vau_token');
}

async function apiFetch(path, options = {}) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  if (res.status === 401 || res.status === 403) {
    clearToken();
    window.location.reload();
    throw new Error('Session expired');
  }

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

export async function login(username, password) {
  const data = await apiFetch('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  setToken(data.token);
  return data;
}

export async function checkAuth() {
  return apiFetch('/auth/me');
}

export async function logout() {
  clearToken();
}

export async function getMachines() {
  return apiFetch('/machines');
}

export async function getSummary() {
  return apiFetch('/machines/summary');
}

export async function getMachineHistory(id) {
  return apiFetch(`/machines/${id}/history`);
}
