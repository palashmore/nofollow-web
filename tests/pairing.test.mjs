import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { PairingService } from '../src/services/pairing-service.mjs';

const TEST_DIR = path.join(process.cwd(), 'tests', 'fixtures', 'pairing-test-data');
const TEST_FILE = path.join(TEST_DIR, 'test-pairing.json');

function cleanup() {
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true, force: true });
}

test('PairingService: generates and validates pairing PIN', () => {
  cleanup();
  const service = new PairingService(TEST_FILE);

  const pin = service.getOrCreatePin();
  assert.match(pin, /^NF-\d{4}$/, 'PIN follows NF-XXXX format');
  assert.equal(service.getOrCreatePin(), pin, 'Returns same PIN within TTL');

  assert.equal(service.verifyPin('wrong-pin'), false, 'Rejects invalid PIN');
  assert.equal(service.verifyPin(pin), true, 'Accepts valid PIN');

  // Verify PIN is consumed/rotated after successful verification
  const newPin = service.getOrCreatePin();
  assert.notEqual(newPin, pin, 'PIN rotates after verification');
  cleanup();
});

test('PairingService: creates and validates session tokens', () => {
  cleanup();
  const service = new PairingService(TEST_FILE);

  const session = service.createSession({ origin: 'https://test.vercel.app', userAgent: 'Chrome' });
  assert.ok(session.token.startsWith('nf_sess_'));
  assert.equal(session.origin, 'https://test.vercel.app');

  const validated = service.validateToken(session.token);
  assert.ok(validated);
  assert.equal(validated.token, session.token);

  // Bearer prefix format
  const bearerValidated = service.validateToken(`Bearer ${session.token}`);
  assert.ok(bearerValidated);

  // Revocation
  service.revokeSession(session.token);
  assert.equal(service.validateToken(session.token), null, 'Revoked token is null');

  cleanup();
});
