import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('department leaderboard counts runs longer than six steps', () => {
  const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  const start = server.indexOf('function nonnegativeNumber(value) {');
  const end = server.indexOf("\napp.get('/api/department'", start);
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
