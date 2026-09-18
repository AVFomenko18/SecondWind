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
    state, writable: () => true, pnow: () => player,
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
  assert.equal(state.ledger.length, 1);
  assert.equal(state.ledger[0].ref, 12);
});
