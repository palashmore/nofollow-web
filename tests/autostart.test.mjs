import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

test('Autostart scripts: presence and syntax validation', () => {
  const scriptsDir = path.join(process.cwd(), 'scripts');
  const installPs = path.join(scriptsDir, 'install-autostart.ps1');
  const removePs = path.join(scriptsDir, 'remove-autostart.ps1');
  const checkPs = path.join(scriptsDir, 'check-agent.ps1');

  assert.ok(fs.existsSync(installPs), 'install-autostart.ps1 exists');
  assert.ok(fs.existsSync(removePs), 'remove-autostart.ps1 exists');
  assert.ok(fs.existsSync(checkPs), 'check-agent.ps1 exists');

  const installContent = fs.readFileSync(installPs, 'utf8');
  assert.match(installContent, /Register-ScheduledTask/, 'Uses Register-ScheduledTask');
  assert.match(installContent, /-AtLogOn/, 'Uses AtLogOn trigger');
  assert.match(installContent, /MultipleInstances IgnoreNew/, 'Prevents duplicate instances');

  const removeContent = fs.readFileSync(removePs, 'utf8');
  assert.match(removeContent, /Unregister-ScheduledTask/, 'Uses Unregister-ScheduledTask');

  const checkContent = fs.readFileSync(checkPs, 'utf8');
  assert.match(checkContent, /Get-ScheduledTask/, 'Checks task state');
  assert.match(checkContent, /127\.0\.0\.1/, 'Queries local loopback API');
});
