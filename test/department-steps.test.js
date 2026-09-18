import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('department leaderboard counts runs longer than six steps', () => {
  const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  const start = server.indexOf('function nonnegativeNumber(value) {');
  const end = server.indexOf("\napp.get('/api/revenue'", start);
  assert.ok(start >= 0 && end > start);
  const context = {};
  vm.createContext(context);
  vm.runInContext(server.slice(start, end), context);
  const player = { name: 'Оля', high: 75 };
  const logs = [
    { text: 'Оля: дистанция 55 → 75, потрачено 20 шаг.' },
    { text: 'Оля: дистанция 50 → 55, потрачено 5 шаг.' },
    { text: 'Оля присоединяется к игре' }
  ];
  assert.equal(context.stepsFromHistory(player, logs), 25);
});

test('department counts all payment buttons and previous recorded payments', () => {
  const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  const start = server.indexOf('function nonnegativeNumber(value) {');
  const end = server.indexOf("\napp.get('/api/revenue'", start);
  const context = {};
  vm.createContext(context);
  vm.runInContext(server.slice(start, end), context);
  const player = { name: 'Оля', actionCounts: { 'payment-low': 2, 'payment-mid': 1, 'payment-high': 3 } };
  const logs = [{ text: 'Оля: новая оплата 75 000 ₽, +1 шаг.' }, { text: 'Саша: новая оплата 75 000 ₽, +1 шаг.' }];
  assert.equal(context.paymentCount(player, logs), 7);
  const department = readFileSync(new URL('../department.html', import.meta.url), 'utf8');
  assert.match(department, /key:'payments',label:'Оплаты'/);
  assert.match(department, /key:'revenue',label:'Выручка'/);
  assert.match(department, /Выручка месяца/);
});
