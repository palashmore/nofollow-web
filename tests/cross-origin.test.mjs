import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import fs from 'fs';
import { createApp } from '../src/server.mjs';

const TEST_DIR = path.join(process.cwd(), 'tests', 'fixtures', 'cors-test-data');

function cleanup() {
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true, force: true });
}

test('Cross-Origin & PNA: preflight OPTIONS and authentication from Vercel', async () => {
  cleanup();
  const app = createApp({ dataDir: path.join(TEST_DIR, 'data'), logsDir: path.join(TEST_DIR, 'logs') });
  await new Promise(res => app.server.listen(0, '127.0.0.1', res));
  const port = app.server.address().port;
  const base = `http://127.0.0.1:${port}`;

  try {
    const origin = 'https://nofollow-web.vercel.app';

    // 1. Preflight OPTIONS request
    const preflight = await fetch(`${base}/api/ping`, {
      method: 'OPTIONS',
      headers: {
        'Origin': origin,
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'X-NoFollow'
      }
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), origin);
    assert.equal(preflight.headers.get('access-control-allow-private-network'), 'true');

    // 2. Unauthenticated GET /api/ping from Vercel is allowed (health check)
    const ping = await fetch(`${base}/api/ping`, {
      headers: { 'Origin': origin }
    });
    assert.equal(ping.status, 200);
    const pingData = await ping.json();
    assert.equal(pingData.app, 'nofollow-web');

    // 3. Unauthenticated protected request from Vercel is rejected with 401
    const unauth = await fetch(`${base}/api/state`, {
      headers: { 'Origin': origin }
    });
    assert.equal(unauth.status, 401, 'Cross-origin request without pairing token is blocked');

    // 4. Pairing: Obtain PIN and pair
    const pin = app.pairing.getOrCreatePin();
    const pairRes = await fetch(`${base}/api/pairing/pair`, {
      method: 'POST',
      headers: {
        'Origin': origin,
        'Content-Type': 'application/json',
        'X-NoFollow': '1'
      },
      body: JSON.stringify({ pin })
    });
    assert.equal(pairRes.status, 200);
    const { token } = await pairRes.json();
    assert.ok(token.startsWith('nf_sess_'));

    // 5. Authenticated request from Vercel with token succeeds
    const authState = await fetch(`${base}/api/state`, {
      headers: {
        'Origin': origin,
        'Authorization': `Bearer ${token}`
      }
    });
    assert.equal(authState.status, 200, 'Cross-origin request with valid token succeeds');

    // 6. Direct loopback request without token succeeds (local dashboard)
    const loopback = await fetch(`${base}/api/state`);
    assert.equal(loopback.status, 200, 'Direct loopback request succeeds without token');
  } finally {
    app.server.closeAllConnections?.();
    app.server.close();
    cleanup();
  }
});
