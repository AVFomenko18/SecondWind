import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { publicUpdateValid } from '../game-integrity.js';

const at = '2026-09-18T12:00:00.000Z';
function fixture() {
  return {
    version: 3, id: 'period', updated: at, undo: null, pendingCase: undefined,
    config: { actions: [] },
    players: [{
      id: 'p1', name: 'Оля', color: '#286653', sport: 0,
      pos: 0, high: 0, bank: 0, cash: 0, cashBase: 0, calls: 0,
      cross: 0, shields: 0, used: [], actionCounts: {}
    }],
    ledger: [], rewards: [], logs: []
  };
}
function changed(before) {
  const after = structuredClone(before);
  after.logs.unshift({ id: 'log-1', at, text: 'Игровое действие', reverse: {
    kind: 'patch', ops: [
      { kind: 'set', path: ['players'], value: structuredClone(before.players) },
      { kind: 'set', path: ['ledger'], value: structuredClone(before.ledger) }
    ]
  } });
  return after;
}

test('ordinary payment, cross-sale and a run save without admin access', () => {
  for (const mutate of [
    next => { next.players[0].actionCounts['payment-low'] = 1; next.players[0].bank = 1; },
    next => { next.players[0].actionCounts['payment-mid'] = 1; next.players[0].bank = 2; },
    next => { next.players[0].actionCounts['payment-high'] = 1; next.players[0].bank = 4; },
    next => { next.players[0].cross = 1; next.players[0].bank = 2; }
  ]) {
    const before = fixture();
    const after = changed(before);
    mutate(after);
    assert.equal(publicUpdateValid(before, after), true);
  }
  const before = fixture();
  before.players[0].bank = 7;
  const after = changed(before);
  after.players[0].pos = 7; after.players[0].high = 7; after.players[0].bank = 0;
  after.ledger.push({ id: 'coin-6', playerId: 'p1', source: 'milestone', ref: '6', amount: 5, title: 'Рубеж 6', at });
  assert.equal(publicUpdateValid(before, after), true);
});

test('activity steps are rejected while activity buttons are closed', () => {
  const before = fixture();
  const after = changed(before);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' });
  after.players[0].actionCounts['activity-' + today] = 70;
  after.players[0].bank = 5;
  assert.equal(publicUpdateValid(before, after), false);
});

test('power calls cannot be credited as public steps anymore', () => {
  const before = fixture();
  const after = changed(before);
  after.players[0].calls = 3;
  after.players[0].actionCounts['power-calls'] = 1;
  after.players[0].bank = 1.5;
  assert.equal(publicUpdateValid(before, after), false);
});

test('ordinary users cannot forge money, position, awards or reward delivery', () => {
  const before = fixture();
  const corruptions = [
    next => { next.players[0].bank = 100; },
    next => { next.players[0].pos = 60; next.players[0].high = 60; },
    next => { next.players[0].actionCounts['payment-low'] = 1; next.players[0].bank = 100; },
    next => { next.players[0].actionCounts['activity-2020-01-01'] = 70; next.players[0].bank = 5; },
    next => { next.players[0].calls = 300; next.players[0].bank = 1.5; },
    next => { next.ledger.push({ id: 'coin', playerId: 'p1', source: 'milestone', ref: '6', amount: 5, title: 'Рубеж 6', at }); },
    next => { next.rewards.push({ id: 'free', playerId: 'p1', title: 'Приз', claimed: true }); }
  ];
  for (const corrupt of corruptions) {
    const after = changed(before);
    corrupt(after);
    assert.equal(publicUpdateValid(before, after), false);
  }
});

test('ordinary users can add a clean participant and change their own avatar', () => {
  const before = fixture();
  const addition = changed(before);
  addition.players.push({
    id: 'p2', name: 'Саша', color: '#cf744d', sport: 1,
    pos: 0, high: 0, bank: 0, cash: 0, cashBase: 0, calls: 0,
    cross: 0, shields: 0, used: [], actionCounts: {}
  });
  assert.equal(publicUpdateValid(before, addition), true);
  const avatar = changed(before);
  avatar.players[0].avatar = 'data:image/png;base64,AAAA';
  assert.equal(publicUpdateValid(before, avatar), true);
});

test('a forged rollback snapshot cannot plant future coins', () => {
  const before = fixture(), after = changed(before);
  after.players[0].actionCounts['payment-low'] = 1;
  after.players[0].bank = 1;
  after.logs[0].reverse.ops[0].value[0].bank = 100;
  assert.equal(publicUpdateValid(before, after), false);
  after.logs[0].reverse = { kind: 'snapshot', state: before };
  assert.equal(publicUpdateValid(before, after), false);
});

test('several real actions can be saved together, but repeated or log-only actions cannot be forged', () => {
  const before = fixture();
  const first = changed(before);
  first.players[0].actionCounts['payment-low'] = 1;
  first.players[0].bank = 1;
  const second = changed(first);
  second.logs[0].id = 'log-2';
  second.players[0].cross = 1;
  second.players[0].bank = 3;
  assert.equal(publicUpdateValid(before, second), true);

  const repeated = changed(before);
  repeated.players[0].actionCounts['payment-low'] = 1000;
  repeated.players[0].bank = 1000;
  assert.equal(publicUpdateValid(before, repeated), false);

  assert.equal(publicUpdateValid(before, changed(before)), false);
});

test('server accepts the browser rollback patch for a normal move', () => {
  const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const start = page.indexOf('function reverseDiff(');
  const end = page.indexOf('\nfunction commit(){', start);
  const context = {};
  vm.createContext(context);
  vm.runInContext(page.slice(start, end), context);
  const before = fixture();
  before.players[0].bank = 7;
  const after = changed(before);
  after.players[0].pos = 7; after.players[0].high = 7; after.players[0].bank = 0;
  after.ledger.push({ id: 'coin-6', playerId: 'p1', source: 'milestone', ref: '6', amount: 5, title: 'Рубеж 6', at });
  after.logs[0].reverse = context.makeReversePatch(before, after);
  assert.equal(publicUpdateValid(before, after), true);
});
