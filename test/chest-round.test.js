import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const start = server.indexOf("app.post('/api/open-case'");
const end = server.indexOf('// Recent reward purchases', start);
assert.ok(start >= 0 && end > start);

function setup({ forceNext = false } = {}) {
  const handlers = {};
  const database = {
    game: { id: 'period', players: [{ id: 'player-1', name: 'Саша' }], ledger: [{ id: 'coins', playerId: 'player-1', amount: 3 }], rewards: [], logs: [], updated: '2026-09-18T10:00:00.000Z' },
    stock: { prize_id: 'super', purchased: 0, limit_count: 5 }, round: null, forceNext
  };
  const client = {
    release() {},
    async query(sql, args = []) {
      const text = sql.replace(/\s+/g, ' ').trim();
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(text)) return { rows: [] };
      if (text.startsWith('SELECT data FROM department_shop')) return { rows: [{ data: [] }] };
      if (text.startsWith('SELECT data FROM department_rules')) return { rows: [{ data: {} }] };
      if (text.startsWith('SELECT data FROM game_state')) return { rows: [{ data: database.game }] };
      if (text.startsWith('SELECT player_id, resolved FROM case_rounds') || text.startsWith('SELECT player_id, data, resolved FROM case_rounds')) return { rows: database.round ? [database.round] : [] };
      if (text.startsWith('SELECT prize_id, purchased, limit_count FROM super_prize_inventory')) return { rows: [database.stock] };
      if (text.startsWith('UPDATE game_controls SET remaining = remaining - 1')) {
        if (!database.forceNext) return { rows: [] };
        database.forceNext = false;
        return { rows: [{ remaining: 0 }] };
      }
      if (text.startsWith('UPDATE super_prize_inventory SET purchased = purchased + 1')) { database.stock.purchased++; return { rows: [{ purchased: database.stock.purchased }] }; }
      if (text.startsWith('UPDATE super_prize_inventory SET purchased = GREATEST')) { database.stock.purchased--; return { rows: [] }; }
      if (text.startsWith('INSERT INTO case_rounds')) { database.round = { player_id: args[2], data: JSON.parse(args[3]), resolved: null }; return { rows: [] }; }
      if (text.startsWith('UPDATE game_state SET data =')) { database.game = JSON.parse(args[1]); return { rows: [] }; }
      if (text.startsWith('UPDATE case_rounds SET resolved =')) { database.round.resolved = JSON.parse(args[2]); return { rows: [] }; }
      throw Error(`Unexpected SQL: ${text.slice(0, 100)}`);
    }
  };
  const context = {
    app: { post: (route, handler) => { handlers[route] = handler; } },
    ensureTable: async () => {}, pool: { connect: async () => client },
    teamId: () => 1, sameOrigin: () => true, withDepartmentConfig: value => value, stateETag: () => '"etag"',
    casePool: () => [
      { id: 'super', name: 'Day off', superPrize: true, weight: 20 },
      { id: 'ordinary-1', name: 'Обед 1,5 часа', superPrize: false, weight: 1200 }
    ],
    drawCasePrize: items => items[0],
    drawCaseOutcome: () => ({ phase: 'chests', prize: { id: 'super', name: 'Day off', superPrize: true } }),
    createChestRound: (_prize, _ordinary, _random, guaranteed) => ({ position: guaranteed ? 0 : 1, prize: { id: 'super', name: 'Day off' }, chests: guaranteed
      ? [0, 1, 2].map(() => ({ type: 'super', prize: { id: 'super', name: 'Day off' } }))
      : [
        { type: 'souvenir', prize: { id: 'mini-1', name: 'Зелье дозвона' } },
        { type: 'super', prize: { id: 'super', name: 'Day off' } },
        { type: 'ordinary', prize: { id: 'ordinary-1', name: 'Обед 1,5 часа' } }
      ] }),
    randomUUID: () => 'log-id', CASE_COST: 2, FORCE_NEXT_GUARANTEED_SUPER_CHEST_CONTROL: 'force-next', structuredClone,
    databaseError: (_res, error) => { throw error; }
  };
  vm.createContext(context);
  vm.runInContext(server.slice(start, end), context);
  const requestId = 'case-00000000-0000-4000-8000-000000000001';
  const request = body => ({ body, get: key => key === 'if-match' ? '"etag"' : undefined });
  const response = () => ({
    statusCode: 200, headers: {}, data: null,
    status(code) { this.statusCode = code; return this; },
    setHeader(key, value) { this.headers[key] = value; },
    json(data) { this.data = data; return this; }
  });
  return { handlers, database, requestId, request, response };
}

test('opening a super sector reserves stock without revealing the winning chest', async () => {
  const { handlers, database, requestId, request, response } = setup();
  const result = response();
  await handlers['/api/open-case'](request({ playerId: 'player-1', requestId }), result);
  assert.equal(result.statusCode, 200);
  assert.equal(result.data.phase, 'chests');
  assert.equal(result.data.reward, undefined);
  assert.equal(JSON.stringify(result.data).includes('position'), false);
  assert.equal(database.stock.purchased, 1);
  assert.equal(database.game.pendingCase.requestId, requestId);
  assert.equal(database.game.ledger.at(-1).amount, -2);
});

test('souvenir chest gives a souvenir and releases reserved stock', async () => {
  const { handlers, database, requestId, request, response } = setup();
  await handlers['/api/open-case'](request({ playerId: 'player-1', requestId }), response());
  const choice = response();
  await handlers['/api/choose-chest'](request({ requestId, chest: 0 }), choice);
  assert.equal(choice.statusCode, 200);
  assert.equal(choice.data.reward.title, 'Зелье дозвона');
  assert.equal(choice.data.reward.miniPrize, true);
  assert.equal(choice.data.reward.souvenir, true);
  assert.equal(database.stock.purchased, 0);
  assert.equal(database.game.pendingCase, undefined);
  assert.equal(database.game.rewards.length, 1);
  const retry = response();
  await handlers['/api/choose-chest'](request({ requestId, chest: 2 }), retry);
  assert.equal(retry.data.reward.title, 'Зелье дозвона');
  assert.equal(database.game.rewards.length, 1);
});

test('ordinary chest gives an ordinary reward and releases reserved stock', async () => {
  const { handlers, database, requestId, request, response } = setup();
  await handlers['/api/open-case'](request({ playerId: 'player-1', requestId }), response());
  const choice = response();
  await handlers['/api/choose-chest'](request({ requestId, chest: 2 }), choice);
  assert.equal(choice.data.reward.title, 'Обед 1,5 часа');
  assert.equal(choice.data.reward.superPrize, false);
  assert.equal(choice.data.reward.miniPrize, false);
  assert.equal(choice.data.reward.souvenir, false);
  assert.equal(choice.data.reveal[0].type, 'souvenir');
  assert.equal(choice.data.reveal[1].type, 'super');
  assert.equal(choice.data.reveal[2].type, 'ordinary');
  assert.equal(database.stock.purchased, 0);
});

test('correct chest awards the reserved super prize', async () => {
  const { handlers, database, requestId, request, response } = setup();
  await handlers['/api/open-case'](request({ playerId: 'player-1', requestId }), response());
  const choice = response();
  await handlers['/api/choose-chest'](request({ requestId, chest: 1 }), choice);
  assert.equal(choice.data.reward.title, 'Day off');
  assert.equal(choice.data.reward.superPrize, true);
  assert.equal(database.stock.purchased, 1);
});

test('one-time forced opening puts the super prize in every chest', async () => {
  const { handlers, database, requestId, request, response } = setup({ forceNext: true });
  const opening = response();
  await handlers['/api/open-case'](request({ playerId: 'player-1', requestId }), opening);
  assert.equal(opening.data.phase, 'chests');
  assert.equal(database.forceNext, false);
  assert.deepEqual(database.round.data.chests.map(item => item.type), ['super', 'super', 'super']);
  const choice = response();
  await handlers['/api/choose-chest'](request({ requestId, chest: 2 }), choice);
  assert.equal(choice.data.reward.superPrize, true);
  assert.equal(choice.data.reward.title, 'Day off');
  assert.equal(database.stock.purchased, 1);
});
