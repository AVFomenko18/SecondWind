import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('shop sells a case, shows odds, and does not offer a case refund', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const start = html.indexOf('function caseIcon(item){');
  const end = html.indexOf('\nasync function openCase(){', start);
  assert.ok(start >= 0 && end > start);
  const player = { id: 'player-1', name: 'Оля' };
  const context = {
    state: { players: [player], rewards: [{ playerId: player.id, title: 'Приз', cost: 2, source: 'shop', case: true, claimed: false, cancelled: false }] },
    pnow: () => player, medals: () => 3, playerSelect: () => '<select></select>', esc: value => String(value),
    caseCatalog: { cost: 2, items: [{ id: 'prize-0', name: 'Простой приз', cost: 1, chance: 99.8, superPrize: false },
      { id: 'prize-20', name: 'Редкий приз', cost: 7, chance: 0.2, superPrize: true, remaining: 3 }] },
    caseLastReward: null, caseCatalogError: '', caseOpening: false, apiReady: true
  };
  vm.createContext(context);
  vm.runInContext(html.slice(start, end), context);
  const view = context.prizesView();
  assert.match(view, /Открыть кейс/);
  assert.match(view, /2 🪙 за открытие/);
  assert.match(view, /0,20%/);
  assert.match(view, /осталось 3 шт/);
  assert.doesNotMatch(view, /Вернуть монетки/);
  assert.doesNotMatch(view, /buyPrize/);
});

test('retrying an uncertain opening reuses its request id', async () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const start = html.indexOf('async function openCase(){');
  const end = html.indexOf('\nfunction animateCase(reward){', start);
  const ids = [];
  const player = { id: 'player-1', name: 'Оля' };
  let attempts = 0;
  const context = {
    caseOpening: false, caseRequestId: '', caseLastReward: null, caseCatalog: { cost: 2 },
    saveTask: null, pendingSave: null, apiETag: '"old"', apiReady: true, TEAM_KEY: 'fomenko', selected: player.id,
    state: {}, crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000001' },
    writable: () => true, pnow: () => player, medals: () => 3, confirm: () => true,
    render: () => {}, toast: () => {}, migrate: state => state, valid: () => true, syncStatus: () => {},
    animateCase: async () => {}, loadPrizeStock: () => {}, loadCaseCatalog: () => {}, loadRewardFeed: () => {},
    document: { getElementById: () => ({ textContent: '' }) },
    fetch: async (_url, options) => {
      ids.push(JSON.parse(options.body).requestId);
      if (++attempts === 1) throw Error('Соединение прервалось');
      return { ok: true, headers: { get: () => '"new"' }, json: async () => ({ state: {}, reward: { title: 'Приз' } }) };
    }
  };
  vm.createContext(context);
  vm.runInContext(html.slice(start, end), context);
  await context.openCase();
  assert.equal(context.caseRequestId, ids[0]);
  await context.openCase();
  assert.deepEqual(ids, [ids[0], ids[0]]);
  assert.equal(context.caseRequestId, '');
});
