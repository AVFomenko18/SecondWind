import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('former boost, shield and cramp cells now move normally; milestones still pay', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const start = html.indexOf('function movePlayer(count){');
  const end = html.indexOf('\nfunction undo(){', start);
  assert.ok(start >= 0 && end > start);
  const player = { id: 'player-1', name: 'Оля', pos: 3, high: 3, bank: 20, shields: 1, used: [] };
  const state = { config: { milestones: [1, 1, 1, 1, 1] }, ledger: [] };
  const animations = [];
  const context = {
    state, CHECKPOINT_EVERY: 6, CHECKPOINT_COINS: 3, LAP_COINS: 6, writable: () => true, pnow: () => player,
    num: (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max,
    actionAnchor: () => null, snapshot: () => {}, log: () => {}, commit: () => {},
    showEarnedPop: () => {}, toast: () => {}, medals: () => state.ledger.reduce((sum, entry) => sum + entry.amount, 0),
    award: (_player, amount, source, ref) => { state.ledger.push({ amount, source, ref }); return true },
    animateRun: (...args) => animations.push(args),
    document: { getElementById: () => ({ textContent: '' }) }
  };
  vm.createContext(context);
  vm.runInContext(html.slice(start, end), context);
  for (const [steps, landing] of [[1, 4], [5, 9], [3, 12], [4, 16]]) {
    context.movePlayer(steps);
    assert.equal(player.pos, landing);
    assert.equal(animations.at(-1)[3], landing);
  }
  assert.equal(player.bank, 7);
  assert.equal(player.high, 16);
  assert.equal(player.shields, 1);
  assert.deepEqual(player.used, []);
  assert.deepEqual(state.ledger.map(entry => [entry.ref, entry.amount]), [[6, 3], [12, 3]]);
});

test('run button spends the whole earned balance, beyond six steps and across laps', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const start = html.indexOf('function movePlayer(count){');
  const end = html.indexOf('\nfunction undo(){', start);
  const player = { id: 'player-1', name: 'Оля', pos: 55, high: 55, bank: 20, shields: 0, used: [] };
  const state = { config: { milestones: [1, 1, 1, 1, 1] }, ledger: [] };
  const animations = [];
  const context = {
    state, CHECKPOINT_EVERY: 6, CHECKPOINT_COINS: 3, LAP_COINS: 6, writable: () => true, pnow: () => player,
    num: (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max,
    actionAnchor: () => null, snapshot: () => {}, log: () => {}, commit: () => {},
    showEarnedPop: () => {}, toast: () => {}, medals: () => state.ledger.length,
    award: (_player, amount, source, ref) => { state.ledger.push({ amount, source, ref }); return true },
    animateRun: (...args) => animations.push(args),
    document: { getElementById: () => ({ textContent: '' }) }
  };
  vm.createContext(context);
  vm.runInContext(html.slice(start, end), context);
  context.movePlayer();
  assert.equal(player.pos, 75);
  assert.equal(player.bank, 0);
  assert.deepEqual(state.ledger.map(entry => entry.ref), [60, 66, 72]);
  assert.deepEqual(state.ledger.map(entry => entry.amount), [6, 3, 3]);
  assert.equal(animations[0][3], 75);
});

test('every completed lap pays exactly six coins, including multiple laps in one run', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const start = html.indexOf('function movePlayer(count){');
  const end = html.indexOf('\nfunction undo(){', start);
  const player = { id: 'player-1', name: 'Оля', pos: 55, high: 55, bank: 125, shields: 0, used: [] };
  // Existing saved teams still have 1 in the old fifth-milestone setting.
  const state = { config: { milestones: [1, 1, 1, 1, 1] }, ledger: [] };
  const context = {
    state, CHECKPOINT_EVERY: 6, CHECKPOINT_COINS: 3, LAP_COINS: 6, writable: () => true, pnow: () => player,
    num: (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max,
    actionAnchor: () => null, snapshot: () => {}, log: () => {}, commit: () => {},
    showEarnedPop: () => {}, toast: () => {}, medals: () => state.ledger.reduce((total, entry) => total + entry.amount, 0),
    award: (_player, amount, source, ref) => { state.ledger.push({ amount, source, ref }); return true },
    animateRun: () => {}, document: { getElementById: () => ({ textContent: '' }) }
  };
  vm.createContext(context);
  vm.runInContext(html.slice(start, end), context);
  context.movePlayer();
  assert.equal(player.pos, 180);
  assert.equal(player.bank, 0);
  assert.deepEqual(state.ledger.filter(entry => entry.ref % 60 === 0).map(entry => [entry.ref, entry.amount]), [[60, 6], [120, 6], [180, 6]]);
  assert.equal(state.ledger.reduce((total, entry) => total + entry.amount, 0), 72);
});

test('long movement animation uses a bounded number of frames', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const start = html.indexOf('function animateRun(');
  const end = html.indexOf('\nwindow.addEventListener', start);
  let animation;
  const context = {
    runnerBusy: false,
    TRACK: Array.from({ length: 60 }, (_, i) => ({ x: i, y: i })),
    document: { querySelector: () => ({ animate: (frames, options) => { animation = { frames, options }; return {}; } }) },
    window: { matchMedia: () => ({ matches: false }) }
  };
  vm.createContext(context);
  vm.runInContext(html.slice(start, end), context);
  context.animateRun('player-1', 0, 100000, 100000);
  assert.ok(animation.frames.length <= 361);
  assert.equal(animation.options.duration, 12000);
});

test('track cells beyond six steps can be selected when the player has enough steps', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const start = html.indexOf('function reachable(n,p=pnow()){');
  const end = html.indexOf('\nfunction moveToCell(', start);
  const player = { pos: 3, bank: 20 };
  const context = { pnow: () => player };
  vm.createContext(context);
  vm.runInContext(html.slice(start, end), context);
  assert.equal(context.reachable(19), 16);
  assert.equal(context.reachable(24), 0);
});

test('saved milestone ledger accepts old third cells and the new sixth-cell checkpoint', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const start = html.indexOf('function valid(s){');
  const end = html.indexOf('\nfunction migrateOld(', start);
  assert.ok(start >= 0 && end > start);
  const context = {
    configValid: () => true,
    str: value => typeof value === 'string' && value.length > 0,
    stamp: value => !Number.isNaN(Date.parse(value)),
    num: (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max,
    unique: items => new Set(items.map(item => item.id)).size === items.length,
    COLORS: ['#000']
  };
  vm.createContext(context);
  vm.runInContext(html.slice(start, end), context);
  const player = {
    id: 'p', name: 'Оля', pos: 12, high: 12, bank: 0,
    cash: 0, cashBase: 0, calls: 0, cross: 0, shields: 0,
    color: '#000', used: [], actionCounts: {}
  };
  const state = {
    version: 3, id: 'game', updated: '2026-09-18T00:00:00Z',
    config: {}, players: [player], logs: [], rewards: [], ledger: [
      { id: 'old', playerId: 'p', amount: 3, source: 'milestone', ref: '9', title: 'Старый рубеж', at: '2026-09-18T00:00:00Z' },
      { id: 'new', playerId: 'p', amount: 5, source: 'milestone', ref: '12', title: 'Новый рубеж', at: '2026-09-18T00:00:00Z' }
    ]
  };
  assert.equal(context.valid(state), true);
  state.ledger[1].ref = '6';
  assert.equal(context.valid(state), true);
});
