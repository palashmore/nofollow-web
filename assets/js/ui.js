export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fmtDate = iso => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—');
export const fmtNum = n => Number(n || 0).toLocaleString();
export const fmtDuration = sec => {
  const m = Math.round(sec / 60); if (m < 1) return 'under a minute';
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};

export const THEMES = [
  { id: 'obsidian-violet', name: 'Obsidian Violet', mode: 'dark', color: '#9280FF', bg: '#090B10', desc: 'Deep black, charcoal & royal violet' },
  { id: 'emerald-executive', name: 'Emerald Executive', mode: 'dark', color: '#10B981', bg: '#080F0D', desc: 'Forest obsidian, emerald & mint' },
  { id: 'midnight-ocean', name: 'Midnight Ocean', mode: 'dark', color: '#38BDF8', bg: '#0A0E17', desc: 'Deep navy, cyan & cool platinum' },
  { id: 'champagne-luxe', name: 'Champagne Luxe', mode: 'light', color: '#D97706', bg: '#FAF7F2', desc: 'Warm ivory, gold & warm bronze' },
  { id: 'royal-sapphire', name: 'Royal Sapphire', mode: 'dark', color: '#3B82F6', bg: '#070A14', desc: 'Abyss navy, sapphire & metallic silver' },
  { id: 'rose-gold', name: 'Rose Gold', mode: 'dark', color: '#F472B6', bg: '#110C10', desc: 'Charcoal, dusty rose & blush gold' },
  { id: 'arctic-silver', name: 'Arctic Silver', mode: 'light', color: '#6366F1', bg: '#F8FAFC', desc: 'Refined cool white, silver & indigo' },
  { id: 'carbon-neon', name: 'Carbon Neon', mode: 'dark', color: '#A3E635', bg: '#0A0A0A', desc: 'Carbon graphite & cyberpunk neon lime' },
];

const ICONS = {
  home: 'M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  userx: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M17 8l5 5M22 8l-5 5',
  heart: 'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20M12 6v6l4 2',
  ban: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20M4.9 4.9l14.2 14.2',
  history: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2',
  upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  moon: 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z',
  menu: 'M3 6h18M3 12h18M3 18h18',
  check: 'M20 6L9 17l-5-5',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  activity: 'M22 12h-4l-3 9L9 3l-3 9H2',
  sparkles: 'M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83',
  archive: 'M21 8v13H3V8M1 3h22v5H1zM10 12h4',
  external: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3',
  star: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35',
  palette: 'M12 2a10 10 0 1 0 10 10c0-1.1-.9-2-2-2h-2.2a2 2 0 0 1-2-2V7a5 5 0 0 0-5-5zm-5 8a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm4-3a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm4 3a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z',
  zap: 'M13 2L3 14h9l-1 8 10-12h-9l1-8z',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  close: 'M18 6L6 18M6 6l12 12',
  filter: 'M22 3H2l8 9.46V19l4 2v-8.54L22 3z',
  refresh: 'M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15',
  command: 'M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3H6a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3z',
};

export const icon = (name, size = 16) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICONS[name] || ICONS.users}"/></svg>`;

export function toast(msg, type = '') {
  const el = document.createElement('div');
  const iconType = type === 'ok' ? 'check' : type === 'err' ? 'ban' : type === 'warn' ? 'clock' : 'activity';
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="toast-icon">${icon(iconType, 15)}</span><span class="toast-msg">${esc(msg)}</span>`;
  $('#toasts').append(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(10px) scale(0.96)';
    el.style.transition = 'all 0.22s cubic-bezier(0.16, 1, 0.3, 1)';
    setTimeout(() => el.remove(), 220);
  }, type === 'err' ? 7000 : 4000);
}

/** Resolves true/false. Esc and the backdrop cancel. */
export function confirmModal({ title, body, confirmText = 'Confirm', danger = false }) {
  return new Promise(resolve => {
    const root = $('#modal');
    root.innerHTML = `<div class="overlay" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="modal">
      <div class="modal-header">
        <h2>${esc(title)}</h2>
        <button class="modal-close-btn" data-r="0" aria-label="Close">${icon('close', 14)}</button>
      </div>
      <div class="modal-body">${body}</div>
      <div class="row" style="margin-top:20px;justify-content:flex-end">
        <button class="btn ghost" data-r="0">Cancel</button>
        <button class="btn ${danger ? 'danger' : 'primary'}" data-r="1">${esc(confirmText)}</button>
      </div></div></div>`;
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
  // Normalize light/dark aliases while supporting all 8 themes
  document.documentElement.dataset.theme = t;
  const isLight = t === 'light' || t === 'arctic-silver' || t === 'champagne-luxe';
  document.documentElement.dataset.themeMode = isLight ? 'light' : 'dark';
  try { localStorage.setItem('nf-theme', t); } catch { /* private mode */ }
}

export function getCurrentTheme() {
  return document.documentElement.dataset.theme || 'obsidian-violet';
}

export function infoModal(title, html) {
  const root = $('#modal');
  root.innerHTML = `<div class="overlay" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="modal">
    <div class="modal-header">
      <h2>${esc(title)}</h2>
      <button class="modal-close-btn" data-close aria-label="Close">${icon('close', 14)}</button>
    </div>
    <div class="modal-body">${html}</div>
    <div class="row" style="margin-top:20px;justify-content:flex-end"><button class="btn primary" data-close>Close</button></div>
  </div></div>`;
  const done = () => { root.innerHTML = ''; document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape') done(); };
  document.addEventListener('keydown', onKey);
  root.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', done));
  root.querySelector('.overlay').addEventListener('click', e => { if (e.target.classList.contains('overlay')) done(); });
}

/** Theme Gallery Modal with live swatches */
export function themeGalleryModal(onSelect) {
  const cur = getCurrentTheme();
  const html = `
    <div class="theme-grid">
      ${THEMES.map(t => {
        const active = cur === t.id || (cur === 'dark' && t.id === 'obsidian-violet') || (cur === 'light' && t.id === 'arctic-silver');
        return `
          <div class="theme-card ${active ? 'active' : ''}" data-theme-id="${t.id}">
            <div class="theme-preview" style="background:${t.bg}">
              <div class="theme-swatch" style="background:${t.color};box-shadow:0 0 12px ${t.color}66"></div>
              <div class="theme-chip" style="color:${t.mode === 'dark' ? '#F8FAFC' : '#0F172A'}">${t.mode === 'dark' ? 'Dark' : 'Light'}</div>
            </div>
            <div class="theme-info">
              <div class="theme-title-row">
                <span class="theme-name">${esc(t.name)}</span>
                ${active ? `<span class="theme-active-tag">${icon('check', 12)} Active</span>` : ''}
              </div>
              <div class="theme-desc">${esc(t.desc)}</div>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
  const root = $('#modal');
  root.innerHTML = `<div class="overlay" role="dialog" aria-modal="true" aria-label="Theme Customizer"><div class="modal modal-lg">
    <div class="modal-header">
      <div>
        <h2 style="margin:0 0 4px">Luxury Theme Engine</h2>
        <p class="sub" style="margin:0;font-size:12.5px">Select from eight curated, precision-tuned aesthetic palettes.</p>
      </div>
      <button class="modal-close-btn" data-close aria-label="Close">${icon('close', 14)}</button>
    </div>
    <div class="modal-body">${html}</div>
    <div class="row" style="margin-top:20px;justify-content:flex-end">
      <button class="btn primary" data-close>Done</button>
    </div>
  </div></div>`;
  const done = () => { root.innerHTML = ''; document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape') done(); };
  document.addEventListener('keydown', onKey);
  root.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', done));
  root.querySelector('.overlay').addEventListener('click', e => { if (e.target.classList.contains('overlay')) done(); });

  root.querySelectorAll('[data-theme-id]').forEach(card => {
    card.addEventListener('click', () => {
      const tid = card.dataset.themeId;
      setTheme(tid);
      root.querySelectorAll('.theme-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      if (typeof onSelect === 'function') onSelect(tid);
    });
  });
}

/** Universal Raycast/Linear Command Palette (Ctrl+K / ⌘K) */
export function commandPaletteModal(routes, onNavigate, onAction) {
  const root = $('#modal');
  root.innerHTML = `
    <div class="overlay cmd-overlay" role="dialog" aria-modal="true" aria-label="Command Palette">
      <div class="cmd-palette">
        <div class="cmd-search-box">
          <span class="cmd-search-icon">${icon('search', 18)}</span>
          <input type="text" class="cmd-input" id="cmd-input" placeholder="Type a command or jump to screen... (ESC to close)" autocomplete="off" spellcheck="false">
          <kbd class="cmd-kbd">ESC</kbd>
        </div>
        <div class="cmd-results" id="cmd-results"></div>
        <div class="cmd-footer">
          <span><kbd class="cmd-kbd">↑</kbd> <kbd class="cmd-kbd">↓</kbd> to navigate</span>
          <span><kbd class="cmd-kbd">↵</kbd> to select</span>
          <span><kbd class="cmd-kbd">ESC</kbd> to close</span>
        </div>
      </div>
    </div>
  `;

  const input = $('#cmd-input', root);
  const resultsEl = $('#cmd-results', root);
  let selectedIndex = 0;

  const actions = [
    { id: 'act:sync', label: 'Start Live Sync from Instagram', icon: 'zap', group: 'Actions', run: () => onAction?.('liveSync') },
    { id: 'act:theme', label: 'Open Luxury Theme Gallery', icon: 'palette', group: 'Preferences', run: () => themeGalleryModal(onAction?.themeChanged) },
    { id: 'act:ig', label: 'Open Instagram in Browser', icon: 'external', group: 'Actions', run: () => onAction?.('openBrowser') },
    { id: 'act:verify', label: 'Verify Instagram Session', icon: 'shield', group: 'Actions', run: () => onAction?.('verifySession') },
  ];

  const searchableItems = [
    ...routes.filter(r => r.id).map(r => ({
      id: r.id,
      label: r.label,
      icon: r.icon,
      group: 'Navigation',
      run: () => onNavigate?.(r.id),
    })),
    ...actions,
  ];

  function renderList(query = '') {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? searchableItems.filter(item => item.label.toLowerCase().includes(q) || item.group.toLowerCase().includes(q))
      : searchableItems;

    if (!filtered.length) {
      resultsEl.innerHTML = `<div class="cmd-empty">No results found for "${esc(query)}"</div>`;
      return;
    }

    if (selectedIndex >= filtered.length) selectedIndex = 0;

    let currentGroup = '';
    let html = '';
    filtered.forEach((item, idx) => {
      if (item.group !== currentGroup) {
        currentGroup = item.group;
        html += `<div class="cmd-group-label">${esc(currentGroup)}</div>`;
      }
      html += `
        <div class="cmd-item ${idx === selectedIndex ? 'selected' : ''}" data-idx="${idx}">
          <span class="cmd-item-icon">${icon(item.icon, 16)}</span>
          <span class="cmd-item-label">${esc(item.label)}</span>
          <span class="cmd-item-arrow">${icon('chevronRight', 14)}</span>
        </div>
      `;
    });
    resultsEl.innerHTML = html;

    resultsEl.querySelectorAll('.cmd-item').forEach(el => {
      el.addEventListener('click', () => {
        const idx = Number(el.dataset.idx);
        close();
        filtered[idx]?.run();
      });
      el.addEventListener('mouseenter', () => {
        selectedIndex = Number(el.dataset.idx);
        resultsEl.querySelectorAll('.cmd-item').forEach((c, i) => c.classList.toggle('selected', i === selectedIndex));
      });
    });

    const activeEl = resultsEl.querySelector('.cmd-item.selected');
    if (activeEl) activeEl.scrollIntoView({ block: 'nearest' });
  }

  function close() {
    root.innerHTML = '';
    document.removeEventListener('keydown', onKeyDown);
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    const q = input.value.trim().toLowerCase();
    const filtered = q
      ? searchableItems.filter(item => item.label.toLowerCase().includes(q) || item.group.toLowerCase().includes(q))
      : searchableItems;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIndex = (selectedIndex + 1) % filtered.length;
      renderList(input.value);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIndex = (selectedIndex - 1 + filtered.length) % filtered.length;
      renderList(input.value);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[selectedIndex]) {
        close();
        filtered[selectedIndex].run();
      }
    }
  }

  input.addEventListener('input', () => {
    selectedIndex = 0;
    renderList(input.value);
  });

  document.addEventListener('keydown', onKeyDown);
  root.querySelector('.cmd-overlay').addEventListener('click', e => {
    if (e.target.classList.contains('cmd-overlay')) close();
  });

  renderList();
  input.focus();
}
