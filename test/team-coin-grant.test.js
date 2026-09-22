import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('coin settings offer an explicit whole-team action', () => {
  assert.match(page, /onclick="grantManagerCoins\(event,true\)">Начислить всей команде<\/button>/);
  assert.match(page, /Сколько монет начислить каждому/);
});

test('whole-team coin grant awards every manager in one saved action', () => {
  const start = page.indexOf('function grantManagerCoins(');
  const end = page.indexOf('\nfunction addShopPrize', start);
  const awards = [], logs = [], messages = [];
  let snapshots = 0, commits = 0, confirmations = 0, id = 0;
  const inputs = {
    coinManager: { value: 'first' }, coinAmount: { value: '3' }, coinReason: { value: 'Командный бонус' }
  };
  const context = {
    state: { players: [{ id: 'first', name: 'Первый' }, { id: 'second', name: 'Второй' }] },
    document: { getElementById: key => inputs[key] }, adminWrite: () => true,
    num: (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max,
    str: (value, max) => typeof value === 'string' && value.length <= max,
    confirm: () => { confirmations++; return true; }, actionAnchor: () => null,
    snapshot: () => { snapshots++; },
    award: (player, amount, source, ref, reason) => awards.push({ player: player.id, amount, source, ref, reason }),
    uid: () => `grant-${++id}`, log: message => logs.push(message), commit: () => { commits++; },
    showEarnedPop: () => {}, toast: message => messages.push(message), coinWord: () => 'монеты'
  };
  vm.createContext(context);
  vm.runInContext(page.slice(start, end), context);
  context.grantManagerCoins({}, true);

  assert.equal(confirmations, 1);
  assert.equal(snapshots, 1);
  assert.equal(commits, 1);
  assert.equal(awards.length, 2);
  assert.equal(awards[0].player, 'first');
  assert.equal(awards[1].player, 'second');
  assert.equal(awards.every(item => item.amount === 3 && item.source === 'manual'), true);
  assert.match(logs[0], /Вся команда/);
  assert.match(messages.at(-1), /Всей команде начислено/);
});
