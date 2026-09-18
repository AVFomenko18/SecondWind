import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const historyStart = page.indexOf('function logView(){');
const historyEnd = page.indexOf('\nfunction rulesView(){', historyStart);
assert.ok(historyStart >= 0 && historyEnd > historyStart);
const sharedStart = page.indexOf('function keepSharedConfig(');
const sharedEnd = page.indexOf('\nfunction reverseTarget(', sharedStart);
assert.ok(sharedStart >= 0 && sharedEnd > sharedStart);
const functions = page.slice(sharedStart, sharedEnd) + '\n' + page.slice(historyStart, historyEnd);

test('history selector loads only the chosen team and keeps the active game untouched', async () => {
  const requests = [];
  const game = { logs: [{ id: 'game', text: 'Фоменко' }] };
  const selectedHistory = { logs: [{ id: 'other', at: '2026-09-18T08:00:00.000Z', text: 'Толстов' }] };
  const context = {
    TEAM_KEY: 'fomenko', TEAM_KEYS: ['fomenko', 'tolstov'], TEAM_NAMES: { fomenko: 'Фоменко', tolstov: 'Толстов' },
    historyTeam: 'fomenko', historyShown: 250, historyError: '', historySnapshot: null, historyETag: null,
    historyLoading: false, historyRequest: 0, settingsOpen: true, settingsSection: 'log', state: game,
    fetch: async (url) => { requests.push(url); return { ok: true, json: async () => selectedHistory, headers: { get: () => '"tolstov-etag"' } }; },
    migrate: value => value, valid: () => true, renderSettingsModal: () => {}, AbortSignal,
    esc: value => String(value), canRollback: () => false
  };
  vm.createContext(context);
  vm.runInContext(functions, context);
  await context.setHistoryTeam('tolstov');
  assert.deepEqual(requests, ['/api/game-state?team=tolstov']);
  assert.equal(context.historySnapshot.logs[0].id, 'other');
  assert.equal(context.historyETag, '"tolstov-etag"');
  assert.equal(context.historyShown, 100);
  assert.equal(context.state, game);
  const view = context.logView();
  assert.match(view, /Толстов/);
  assert.doesNotMatch(view, /Фоменко<\/div>/);
  assert.match(view, /<select id="historyTeam"/);
});

test('rollback of another team posts to its own state with its own ETag', async () => {
  const calls = [];
  const config = { shop: [], cashUnit: 50000, crossSteps: 1, actions: [], challenges: [] };
  const context = {
    TEAM_KEY: 'fomenko', TEAM_NAMES: { tolstov: 'Толстов' }, historyTeam: 'tolstov',
    historySnapshot: { version: 3, config, logs: [{ text: 'Действие', reverse: { kind: 'snapshot', state: { version: 3, config: { ...config, cashUnit: 10000 }, logs: [] } } }] },
    historyETag: '"tolstov-etag"', historyLoading: false, adminAuthed: true, settingsOpen: true,
    canRollback: () => true, confirm: () => true, valid: () => true, structuredClone,
    renderSettingsModal: () => {}, toast: () => {}, setHistoryTeam: async () => {}, AbortSignal,
    fetch: async (url, options) => { calls.push({ url, options }); return { ok: true }; }
  };
  vm.createContext(context);
  vm.runInContext(functions, context);
  await context.rollbackHistoryLog(0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/game-state?team=tolstov');
  assert.equal(calls[0].options.headers['If-Match'], '"tolstov-etag"');
  assert.equal(JSON.parse(calls[0].options.body).logs.length, 0);
  assert.equal(JSON.parse(calls[0].options.body).config.cashUnit, 50000);
});
