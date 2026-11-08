const norm = u => { try { const x = new URL(u); return `${x.hostname}${x.pathname}`.replace(/\/+$/, '').toLowerCase(); } catch { return String(u); } };

/**
 * Tracks every tab of the automation browser by id.
 *  - exactly one "action" tab: the only tab the engine ever drives
 *  - any number of "manual" tabs: opened by the user (or by Inspect), never touched by the engine
 * Closed tabs are detected through the page 'close' event, so a closed action tab is recreated instead of failing a click.
 */
export class BrowserTabManager {
  #seq = 0;
  #byPage = new WeakMap();

  constructor(logger) { this.logger = logger; this.ctx = null; this.tabs = new Map(); this.actionId = null; }

  attach(ctx) {
    this.ctx = ctx; this.tabs.clear(); this.actionId = null;
    for (const p of ctx.pages()) this.#track(p);
    ctx.on('page', p => this.#track(p));
  }

  #track(page, role = 'manual') {
    if (this.#byPage.has(page)) return this.#byPage.get(page);
    const rec = { id: `t${++this.#seq}`, role, page, openedAt: new Date().toISOString() };
    this.#byPage.set(page, rec); this.tabs.set(rec.id, rec);
    page.on('close', () => {
      this.tabs.delete(rec.id);
      if (this.actionId === rec.id) { this.actionId = null; this.logger?.warn('The automation tab was closed; a new one is opened when needed.'); }
    });
    return rec;
  }

  get count() { return [...this.tabs.values()].filter(t => !t.page.isClosed()).length; }

  /** The engine's own tab. Reuses the blank startup tab, otherwise opens a new one. */
  async action() {
    const cur = this.tabs.get(this.actionId);
    if (cur && !cur.page.isClosed()) return cur.page;
    let page = [...this.tabs.values()].find(t => t.role === 'manual' && !t.page.isClosed() && t.page.url() === 'about:blank')?.page;
    if (!page) page = await this.ctx.newPage();
    const rec = this.#track(page, 'action'); rec.role = 'action'; this.actionId = rec.id;
    page.on('popup', p => p.close().catch(() => {}));   // unexpected popups opened by the action tab only
    return page;
  }

  list() {
    return [...this.tabs.values()].filter(t => !t.page.isClosed()).map(t => ({ id: t.id, role: t.role, url: t.page.url(), openedAt: t.openedAt }));
  }

  /** Open a profile (or any URL) in a separate manual tab. An already open tab for the same URL is focused, not duplicated. */
  async openManual(url) {
    const key = norm(url);
    const dup = [...this.tabs.values()].find(t => t.role === 'manual' && !t.page.isClosed() && norm(t.page.url()) === key);
    if (dup) { await dup.page.bringToFront(); return { id: dup.id, reused: true, url: dup.page.url() }; }
    const page = await this.ctx.newPage();
    const rec = this.#track(page);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    return { id: rec.id, reused: false, url };
  }
}
