// API Client supporting both direct local loopback and Vercel cross-origin pairing.

const DEFAULT_LOCAL_AGENT = 'http://127.0.0.1:4173';

export function isRemoteOrigin() {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname;
  return host !== '127.0.0.1' && host !== 'localhost' && host !== '';
}

export function getAgentUrl() {
  if (typeof window === 'undefined') return '';
  if (!isRemoteOrigin()) return ''; // Use relative paths on local dashboard
  return localStorage.getItem('nf-agent-url') || DEFAULT_LOCAL_AGENT;
}

export function setAgentUrl(url) {
  if (typeof window === 'undefined') return;
  const clean = (url || DEFAULT_LOCAL_AGENT).replace(/\/+$/, '');
  localStorage.setItem('nf-agent-url', clean);
}

export function getAgentToken() {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('nf-agent-token') || null;
}

export function setAgentToken(token) {
  if (typeof window === 'undefined') return;
  if (token) localStorage.setItem('nf-agent-token', token);
  else localStorage.removeItem('nf-agent-token');
}

export async function pairWithAgent(pin) {
  const base = getAgentUrl();
  const url = `${base}/api/pairing/pair`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-NoFollow': '1'
    },
    body: JSON.stringify({ pin: String(pin).trim() })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Failed to pair with local agent.');
  if (data.token) {
    setAgentToken(data.token);
  }
  return data;
}

export async function disconnectAgent() {
  try {
    await post('/api/pairing/revoke');
  } catch {
    // Ignore error if already offline
  }
  setAgentToken(null);
}

export async function api(path, opts = {}) {
  const base = getAgentUrl();
  const targetUrl = path.startsWith('http') ? path : `${base}${path}`;
  const token = getAgentToken();

  const headers = {
    'X-NoFollow': '1',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    ...(opts.headers || {})
  };

  try {
    const r = await fetch(targetUrl, { ...opts, headers });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (r.status === 401 && isRemoteOrigin()) {
        setAgentToken(null);
      }
      throw new Error(j.error || `${r.status} ${r.statusText}`);
    }
    window.__nfMixedContentBlocked = false;
    return j;
  } catch (err) {
    // Check if browser blocked connection due to Mixed Content / Local Network Access
    if (isRemoteOrigin() && (err.name === 'TypeError' || /Failed to fetch|NetworkError/i.test(err.message))) {
      window.__nfMixedContentBlocked = true;
    }
    throw err;
  }
}

export const post = (path, body = {}) => api(path, { method: 'POST', body: JSON.stringify(body) });
