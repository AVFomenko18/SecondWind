import test from 'node:test';
import assert from 'node:assert/strict';
import { TEAM_ROSTERS, TELEGRAM_NAME_OVERRIDES } from '../team-rosters.js';

test('department roster contains 83 unique managers across all eleven teams', () => {
  const names = Object.values(TEAM_ROSTERS).flat();
  assert.equal(Object.keys(TEAM_ROSTERS).length, 11);
  assert.equal(names.length, 83);
  assert.equal(new Set(names.map(name => name.toLocaleLowerCase('ru-RU'))).size, 83);
  assert.ok(Object.values(TEAM_ROSTERS).every(team => team.length > 0 && team.length <= 40));
});

test('Telegram examples are assigned to their listed teams', () => {
  assert.ok(TEAM_ROSTERS.kozhanov.includes('Шеханова Лилия'));
  assert.ok(TEAM_ROSTERS.klimentovich.includes('Качегова Даяна'));
  assert.equal(TELEGRAM_NAME_OVERRIDES['Качегова Даяна'], 'Качетова Даяна');
});
