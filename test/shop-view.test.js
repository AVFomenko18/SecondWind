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

test('case stays a surprise during the longer spin and celebrates the saved reward', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /case-reel\.spinning\{transition:transform 10s /);
  assert.match(html, /setTimeout\(done,10800\)/);
  const viewStart = html.indexOf('function caseIcon(item){');
  const viewEnd = html.indexOf('\nasync function openCase(){', viewStart);
  const reward = { id: 'case-1', playerId: 'player-1', prizeId: 'prize-20', title: 'Day off', cost: 2, source: 'shop', case: true, superPrize: true };
  const player = { id: 'player-1', name: 'Оля' };
  const context = {
    state: { players: [player], rewards: [reward] }, pnow: () => player, medals: () => 3,
    playerSelect: () => '<select></select>', esc: value => String(value),
    caseCatalog: { cost: 2, items: [{ id: 'prize-20', name: 'Day off', cost: 7, chance: 1, superPrize: true, remaining: 4 }] },
    caseLastReward: reward, caseCatalogError: '', caseOpening: true, apiReady: true
  };
  vm.createContext(context);
  vm.runInContext(html.slice(viewStart, viewEnd), context);
  const spinningView = context.prizesView();
  assert.match(spinningView, /Кейс открывается…/);
  assert.doesNotMatch(spinningView, /Выпало: Day off/);
  assert.doesNotMatch(spinningView, /<p>Day off<\/p>/);
  context.caseOpening = false;
  assert.match(context.prizesView(), /Выпало: Day off/);

  const celebrationStart = html.indexOf('function showCaseCelebration(reward){');
  const celebrationEnd = html.indexOf('\nfunction finishCaseAnimation(reward){', celebrationStart);
  const elements = Object.fromEntries(['caseWinDialog', 'caseWinIcon', 'caseWinTitle', 'caseWinType', 'caseConfetti'].map(id => [id, { textContent: '', innerHTML: '' }]));
  elements.caseWinDialog.open = false;
  elements.caseWinDialog.classList = { toggle: (_name, enabled) => { elements.caseWinDialog.super = enabled; } };
  elements.caseWinDialog.showModal = () => { elements.caseWinDialog.open = true; };
  context.document = { getElementById: id => elements[id] };
  vm.runInContext(html.slice(celebrationStart, celebrationEnd), context);
  context.showCaseCelebration(reward);
  assert.equal(elements.caseWinDialog.open, true);
  assert.equal(elements.caseWinDialog.super, true);
  assert.equal(elements.caseWinTitle.textContent, 'Day off');
  assert.match(elements.caseWinType.textContent, /СУПЕР-ПРИЗ/);
  assert.equal((elements.caseConfetti.innerHTML.match(/<i style=/g) || []).length, 52);
});
