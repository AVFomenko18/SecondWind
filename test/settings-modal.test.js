import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('typing in settings cannot trigger backdrop close', () => {
  const dialog = page.slice(page.indexOf('<dialog id="settingsDialog"'), page.indexOf('<div class="settings-modal-shell"'));
  assert.ok(dialog.includes('oncancel="event.preventDefault();closeSettings()"'));
  assert.ok(!dialog.includes('onclick='));
  assert.ok(page.includes('onsubmit="event.preventDefault();grantManagerCoins(event)"'));
});

test('an older session response cannot replace the manager settings after login', async () => {
  const start = page.indexOf('async function checkAdmin(){');
  const end = page.indexOf('\nasync function loadSharedUsage(){', start);
  assert.ok(start >= 0 && end > start);
  let finishRequest;
  let renders = 0;
  const context = {
    adminSessionRevision: 0,
    adminAuthed: false,
    adminConfigured: true,
    settingsOpen: true,
    fetch: () => new Promise(resolve => { finishRequest = resolve; }),
    renderSettingsModal: () => { renders++; }
  };
  vm.createContext(context);
  vm.runInContext(page.slice(start, end), context);
  const pending = context.checkAdmin();
  context.adminSessionRevision++;
  context.adminAuthed = true;
  finishRequest({ json: async () => ({ authenticated: false, configured: true }) });
  await pending;
  assert.equal(context.adminAuthed, true);
  assert.equal(renders, 0);
});

test('an unchanged session check leaves typed settings form intact', async () => {
  const start = page.indexOf('async function checkAdmin(){');
  const end = page.indexOf('\nasync function loadSharedUsage(){', start);
  let renders = 0;
  const context = {
    adminSessionRevision: 0, adminAuthed: true, adminConfigured: true, settingsOpen: true,
    fetch: async () => ({ json: async () => ({ authenticated: true, configured: true }) }),
    renderSettingsModal: () => { renders++; }
  };
  vm.createContext(context);
  vm.runInContext(page.slice(start, end), context);
  await context.checkAdmin();
  assert.equal(renders, 0);
});
