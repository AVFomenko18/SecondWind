import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const start = server.indexOf("app.get('/api/chest-feed'");
const end = server.indexOf('// Сохранить состояние', start);
assert.ok(start >= 0 && end > start);

test('chest feed exposes the selected chest and all three revealed prizes', async () => {
  let handler;
  const context = {
    app: { get: (_route, callback) => { handler = callback; } },
    ensureTable: async () => {},
    pool: { query: async sql => String(sql).includes('FROM case_rounds') ? { rows: [{
      team_id: 1,
      request_id: 'case-1',
      player_id: 'player-1',
      created_at: '2026-09-22T12:00:00.000Z',
      resolved: {
        selectedChest: 2,
        reward: { at: '2026-09-22T11:59:00.000Z' },
        reveal: [
          { type: 'super', title: 'Сертификат 1 000 ₽' },
          { type: 'souvenir', title: 'Кубик удачного распределения' },
          { type: 'ordinary', title: 'Обед 1,5 часа' }
        ]
      }
    }] } : { rows: [{ id: 1, data: { players: [{ id: 'player-1', name: 'Александра' }] } }] } },
    teamIds: { fomenko: 1 }, teamNames: { fomenko: 'Фоменко' },
    databaseError: (_res, error) => { throw error; }
  };
  vm.createContext(context);
  vm.runInContext(server.slice(start, end), context);
  const response = {
    headers: {}, body: null,
    setHeader(key, value) { this.headers[key] = value; },
    json(value) { this.body = value; }
  };
  await handler({}, response);

  assert.equal(response.headers['Cache-Control'], 'no-store');
  assert.equal(response.body.rounds.length, 1);
  assert.equal(response.body.rounds[0].player, 'Александра');
  assert.equal(response.body.rounds[0].selectedChest, 3);
  assert.equal(response.body.rounds[0].selected.type, 'ordinary');
  assert.equal(response.body.rounds[0].selected.title, 'Обед 1,5 часа');
  assert.equal(JSON.stringify(response.body.rounds[0].chests.map(item => item.selected)), '[false,false,true]');
});
