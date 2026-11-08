export const $ = (sel, root = document) => root.querySelector(sel);
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fmtDate = iso => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—');
export const fmtNum = n => Number(n || 0).toLocaleString();
export const fmtDuration = sec => {
  const m = Math.round(sec / 60); if (m < 1) return 'under a minute';
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};

const ICONS = {
  home: 'M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  userx: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M17 8l5 5M22 8l-5 5',
  heart: 'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20M12 6v6l4 2',
  ban: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20M4.9 4.9l14.2 14.2',
  history: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2',
  upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  menu: 'M3 6h18M3 12h18M3 18h18',
  check: 'M20 6L9 17l-5-5',
};
export const icon = (name, size = 16) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICONS[name] || ''}"/></svg>`;

export function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = `toast ${type}`; el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), type === 'err' ? 7000 : 4000);
}

/** Resolves true/false. Esc and the backdrop cancel. */
export function confirmModal({ title, body, confirmText = 'Confirm', danger = false }) {
  return new Promise(resolve => {
    const root = $('#modal');
    root.innerHTML = `<div class="overlay" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="modal">
      <h2>${esc(title)}</h2><div>${body}</div>
      <div class="row"><button class="btn ghost" data-r="0">Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" data-r="1">${esc(confirmText)}</button></div></div></div>`;
    const done = v => { root.innerHTML = ''; document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = e => { if (e.key === 'Escape') done(false); };
    document.addEventListener('keydown', onKey);
    root.querySelector('.overlay').addEventListener('click', e => { if (e.target.classList.contains('overlay')) done(false); });
    root.querySelectorAll('[data-r]').forEach(b => b.addEventListener('click', () => done(b.dataset.r === '1')));
    root.querySelector('[data-r="0"]').focus();
  });
}

export const badge = s => `<span class="badge b-${esc(s)}">${esc(String(s).replace(/_/g, ' ').toLowerCase())}</span>`;

export function setTheme(t) {
  document.documentElement.dataset.theme = t === 'light' ? 'light' : 'dark';
  try { localStorage.setItem('nf-theme', t); } catch { /* private mode */ }
}

export function infoModal(title, html) {
  const root = $('#modal');
  root.innerHTML = `<div class="overlay" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="modal"><h2>${esc(title)}</h2><div>${html}</div><div class="row"><button class="btn primary" data-close>Close</button></div></div></div>`;
  const done = () => { root.innerHTML = ''; document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape') done(); };
  document.addEventListener('keydown', onKey);
  root.querySelector('[data-close]').addEventListener('click', done);
  root.querySelector('.overlay').addEventListener('click', e => { if (e.target.classList.contains('overlay')) done(); });
}
