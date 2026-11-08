import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { PendingRequestStateService, PENDING_FINAL_STATUSES } from '../src/services/pending-request-state.mjs';
import { STATUS } from '../src/utils/constants.mjs';

test('PendingRequestStateService: exact count calculations and formula verification', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pending-counts-'));
  const file = path.join(dir, 'pending-request-state.json');
  const service = new PendingRequestStateService(file);

  const importedList = [
    'user_pending_1',
    'user_pending_2',
    'user_cancelled',
    'user_already_cancelled',
    'user_accepted',
    'user_unavailable',
    'user_failed',
    'user_needs_review',
    'user_in_progress'
  ];

  service.set('user_cancelled', { status: STATUS.CANCELLED });
  service.set('user_already_cancelled', { status: STATUS.ALREADY_CANCELLED });
  service.set('user_accepted', { status: STATUS.ACCEPTED });
  service.set('user_unavailable', { status: STATUS.PROFILE_UNAVAILABLE });
  service.set('user_failed', { status: STATUS.FAILED });
  service.set('user_needs_review', { status: STATUS.NEEDS_REVIEW });
  service.set('user_in_progress', { status: STATUS.IN_PROGRESS });

  const counts = service.calculateCounts(importedList);

  assert.equal(counts.imported, 9, 'Imported records match unique list');
  assert.equal(counts.cancelled, 1, 'Successfully cancelled count');
  assert.equal(counts.alreadyCancelled, 1, 'Already cancelled count');
  assert.equal(counts.accepted, 1, 'Accepted count');
  assert.equal(counts.unavailable, 1, 'Unavailable count');
  assert.equal(counts.failed, 1, 'Failed count');
  assert.equal(counts.needsReview, 1, 'Needs review count');
  assert.equal(counts.inProgress, 1, 'In progress count');
  assert.equal(counts.pending, 2, 'Pending unattempted count');

  // Verify Section 7 mandatory formula:
  // Imported = Pending + In Progress + Cancelled + Already Cancelled + Accepted + Unavailable + Needs Review + Failed
  const sum = counts.pending +
              counts.inProgress +
              counts.cancelled +
              counts.alreadyCancelled +
              counts.accepted +
              counts.unavailable +
              counts.needsReview +
              counts.failed;

  assert.equal(sum, counts.imported, 'Counts must partition imported records with zero overlap or double-counting');

  // Eligible = Imported - (Cancelled + Already Cancelled + Accepted + Unavailable)
  assert.equal(counts.eligible, 9 - 4, 'Eligible count excludes all final records');
  // Remaining = Eligible - InProgress
  assert.equal(counts.remaining, 5 - 1, 'Remaining count is eligible not yet in-flight');

  // isFinal verification
  assert.equal(service.isFinal('user_cancelled'), true);
  assert.equal(service.isFinal('user_already_cancelled'), true);
  assert.equal(service.isFinal('user_accepted'), true);
  assert.equal(service.isFinal('user_unavailable'), true);
  assert.equal(service.isFinal('user_failed'), false);
  assert.equal(service.isFinal('user_needs_review'), false);
  assert.equal(service.isFinal('user_pending_1'), false);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('PendingRequestStateService: recovery of interrupted accounts and runs', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pending-recover-'));
  const file = path.join(dir, 'pending-request-state.json');
  const service = new PendingRequestStateService(file);

  service.set('flying_user', { status: STATUS.IN_PROGRESS });
  const run = service.startRun(['flying_user']);
  assert.equal(run.status, 'RUNNING');

  const recovered = service.recoverInterrupted();
  assert.equal(recovered, 1);
  assert.equal(service.get('flying_user').status, STATUS.RETRY_PENDING);
  assert.equal(service.state.runs[0].status, 'INTERRUPTED');

  fs.rmSync(dir, { recursive: true, force: true });
});
