const API_BASE = '/api/v1';
const TOKEN_KEY = 'vau_token';

export class ApiError extends Error {
  constructor(message, status, code, requestId) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

async function apiFetch(path, options = {}) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  } catch {
    throw new ApiError('Cannot reach the server. Check your connection.', 0, 'NETWORK_ERROR');
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    // Non-JSON response (proxy error page, etc.) — fall through to status handling.
  }

  // Expired/invalid session on an authenticated call: reset to the login
  // screen. A 401 from the login endpoint itself is just bad credentials.
  if (res.status === 401 && token && path !== '/auth/login') {
    clearToken();
    window.location.reload();
    throw new ApiError('Session expired', 401, 'SESSION_EXPIRED');
  }

  if (!res.ok) {
    throw new ApiError(
      data?.error || `Request failed (${res.status})`,
      res.status,
      data?.code,
      data?.requestId
    );
  }

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

export function logout() {
  clearToken();
}

export async function changePassword(currentPassword, newPassword) {
  return apiFetch('/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}

export async function getMachines() {
  return apiFetch('/machines');
}

export async function getSummary() {
  return apiFetch('/machines/summary');
}

export async function getMachineHistory(id, { limit = 50, offset = 0 } = {}) {
  return apiFetch(`/machines/${id}/history?limit=${limit}&offset=${offset}`);
}

export async function deleteMachine(id) {
  return apiFetch(`/machines/${id}`, { method: 'DELETE' });
}
