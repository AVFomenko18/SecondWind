import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const game = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const department = readFileSync(new URL('../department.html', import.meta.url), 'utf8');
const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const expected = [
  ['otrakusha', 'Отракуша', 5],
  ['kulikov', 'Куликов', 6],
  ['kondratyev', 'Кондратьев', 7],
  ['chekhova', 'Чехова', 8],
  ['klimentovich', 'Климентович', 9],
  ['bagaturiya', 'Багатурия', 10],
  ['tolstov', 'Толстов', 11]
];

test('all eleven teams have matching navigation and distinct server storage', () => {
  const gameStart = game.indexOf('const TEAM_KEYS=');
  const gameEnd = game.indexOf('const requestedTeam=', gameStart);
  const serverStart = server.indexOf('const teamIds =');
  const serverEnd = server.indexOf('function teamId(', serverStart);
  assert.ok(gameStart >= 0 && gameEnd > gameStart && serverStart >= 0 && serverEnd > serverStart);
  const gameConfig = vm.runInNewContext(`${game.slice(gameStart, gameEnd)};({ keys: TEAM_KEYS, names: TEAM_NAMES })`);
  const serverConfig = vm.runInNewContext(`${server.slice(serverStart, serverEnd)};({ ids: teamIds, names: teamNames })`);
  assert.equal(gameConfig.keys.length, 11);
  assert.equal(new Set(Object.values(serverConfig.ids)).size, 11);
  for (const [key, name, id] of expected) {
    assert.equal(gameConfig.names[key], name);
    assert.equal(serverConfig.names[key], name);
    assert.equal(serverConfig.ids[key], id);
    assert.ok(game.includes(`data-team="${key}" href="?team=${key}"`));
    assert.ok(department.includes(`href="index.html?team=${key}">${name}</a>`));
  }
});
