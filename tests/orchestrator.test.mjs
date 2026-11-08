import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { CentralJobOrchestrator, JOB_STATUS, JOB_TYPES } from '../src/automation/central-orchestrator.mjs';

const TEST_DIR = path.join(process.cwd(), 'tests', 'fixtures', 'orch-test-data');
const QUEUE_FILE = path.join(TEST_DIR, 'test-queue.json');
const AUDIT_FILE = path.join(TEST_DIR, 'test-audit.json');

function cleanup() {
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true, force: true });
}

test('CentralJobOrchestrator: enforces approval gate and single worker rule', async () => {
  cleanup();
  let fakeRan = 0;
  const fakeEngine = {
    active: false,
    start: async (list) => {
      fakeEngine.active = true;
      fakeRan += list.length;
      setTimeout(() => { fakeEngine.active = false; }, 20);
    },
    snapshot: () => ({ processed: fakeRan, successful: fakeRan })
  };

  const orchestrator = new CentralJobOrchestrator({
    queueFile: QUEUE_FILE,
    auditFile: AUDIT_FILE,
    engines: { unfollow: fakeEngine }
  });

  // 1. Job created without approval stays QUEUED
  const job1 = orchestrator.createJob({
    type: JOB_TYPES.UNFOLLOW,
    usernames: ['user1', 'user2'],
    approved: false
  });
  assert.equal(job1.status, JOB_STATUS.QUEUED);
  assert.equal(orchestrator.activeJobId, null, 'Unapproved job does not run');

  // 2. Approve job1 -> transitions and executes
  orchestrator.approveJob(job1.id);
  assert.equal(job1.status, JOB_STATUS.RUNNING);
  assert.equal(orchestrator.activeJobId, job1.id);

  // 3. Single Mutating Worker rule: Enqueueing job2 while job1 is running does not start job2
  const job2 = orchestrator.createJob({
    type: JOB_TYPES.UNFOLLOW,
    usernames: ['user3'],
    approved: true
  });
  assert.equal(job2.status, JOB_STATUS.APPROVED);
  assert.equal(orchestrator.activeJobId, job1.id, 'Single worker rule holds: job2 does not preempt job1');

  // 4. Wait for job1 to complete and job2 to automatically execute
  await new Promise(r => setTimeout(r, 100));
  assert.equal(job1.status, JOB_STATUS.COMPLETED);

  // 5. Audit history recorded
  const audit = orchestrator.getAuditHistory();
  assert.ok(audit.length >= 3, 'Audit entries recorded');
  assert.ok(audit.some(a => a.action === 'JOB_CREATED'));
  assert.ok(audit.some(a => a.action === 'JOB_APPROVED'));

  cleanup();
});

test('CentralJobOrchestrator: recovers interrupted jobs on restart', () => {
  cleanup();
  // Simulate saved state where a job was mid-flight when process died
  fs.mkdirSync(TEST_DIR, { recursive: true });
  fs.writeFileSync(QUEUE_FILE, JSON.stringify({
    version: 1,
    activeJobId: 'job-123',
    jobs: [
      { id: 'job-123', type: 'unfollow', usernames: ['u1'], status: JOB_STATUS.RUNNING, createdAt: new Date().toISOString() }
    ]
  }));

  const orchestrator = new CentralJobOrchestrator({
    queueFile: QUEUE_FILE,
    auditFile: AUDIT_FILE,
    engines: {}
  });

  const snap = orchestrator.getSnapshot();
  const recoveredJob = snap.jobs.find(j => j.id === 'job-123');
  assert.equal(recoveredJob.status, JOB_STATUS.INTERRUPTED, 'Mid-flight job recovered to INTERRUPTED');
  assert.equal(snap.activeJobId, null, 'Active worker cleared');

  cleanup();
});
