import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { createApp } from '../src/server.mjs';

test('UI Verification: Followers Intelligence renders KPI cards, ratios, and recommendations with zero errors', async () => {
  const app = createApp();
  await new Promise(res => app.server.listen(0, '127.0.0.1', res));
  const port = app.server.address().port;
  const base = `http://127.0.0.1:${port}`;

  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true }).catch(() => chromium.launch({ headless: true }));
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));

    await page.goto(`${base}/#/intelligence`);
    await page.waitForSelector('#intel-kpis .kpi');

    // 1. Verify 5 KPI cards
    const kpiCount = await page.locator('#intel-kpis .kpi').count();
    assert.equal(kpiCount, 5, '5 KPI cards rendered');

    // 2. Verify Ratios rendered
    const ratiosText = await page.locator('#intel-ratios').innerText();
    assert.match(ratiosText, /Follow-Back Conversion:/);
    assert.match(ratiosText, /59\.52%/);

    // 3. Verify Recommendations rendered
    const recsCount = await page.locator('#intel-recs li').count();
    assert.ok(recsCount >= 1, 'Recommendations rendered');

    // 4. Verify ZERO page errors
    assert.deepEqual(pageErrors, [], 'No page errors or kpi ReferenceErrors');

    // 5. Verify NO error toasts
    const errorToasts = await page.locator('#toasts .err').count();
    assert.equal(errorToasts, 0, 'No error toasts displayed');
  } finally {
    await browser?.close();
    app.server.closeAllConnections?.();
    app.server.close();
  }
});
