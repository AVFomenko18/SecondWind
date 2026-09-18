import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('shop shows a prize wheel without percentage odds or a case refund', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const start = html.indexOf('function caseIcon(item){');
  const end = html.indexOf('\nasync function openCase(){', start);
  assert.ok(start >= 0 && end > start);
  const player = { id: 'player-1', name: 'Оля' };
  const context = {
    state: { players: [player], rewards: [{ playerId: player.id, title: 'Приз', cost: 2, source: 'shop', case: true, claimed: false, cancelled: false, at: '2026-09-18T10:28:00.000Z' }] },
    pnow: () => player, medals: () => 3, playerSelect: () => '<select></select>', esc: value => String(value),
    caseCatalog: { cost: 2, miniPrizes: [{ id: 'mini-call-potion', icon: '🧪', name: 'Зелье удачного дозвона' }],
      items: [{ id: 'prize-0', name: 'Простой приз', cost: 1, superPrize: false },
        { id: 'prize-20', name: 'Редкий приз', cost: 7, superPrize: true, remaining: 3 }] },
    caseLastReward: null, caseCatalogError: '', caseOpening: false, apiReady: true,
    COIN_ICON: '<img class="coin-icon" src="assets/coin-ruble.svg" alt="монетка">'
  };
  vm.createContext(context);
  vm.runInContext(html.slice(start, end), context);
  const view = context.prizesView();
  assert.match(view, /Крутить барабан/);
  assert.match(view, /case-wheel-disk/);
  assert.match(view, /Зелье удачного дозвона/);
  assert.match(view, /2 <img class="coin-icon"[^>]+> за открытие/);
  assert.doesNotMatch(view, /\d+[,.]?\d*%/);
  assert.doesNotMatch(view, /Шансы и доступные награды/);
  assert.match(view, /Осталось <b>3<\/b> штук/);
  assert.match(view, /Мини-призы/);
  assert.match(view, /Награды за спортивные заслуги/);
  assert.match(view, /Супер-призы/);
  assert.equal((view.match(/case-super-card/g) || []).length, 1);
  assert.doesNotMatch(view, /Супер-приз · осталось/);
  assert.doesNotMatch(view, /Вернуть монетки/);
  assert.doesNotMatch(view, /buyPrize/);

  context.state.rewards.unshift({ id: 'mini-1', playerId: player.id, title: 'Зелье оплат в касание',
    miniPrize: true, cost: 2, source: 'shop', case: true, claimed: false, cancelled: false,
    at: '2026-09-18T10:29:00.000Z' });
  const opened = context.prizesView().split('Открытые награды')[1];
  assert.doesNotMatch(opened, /Зелье оплат в касание/);
  assert.match(opened, /Приз/);
  assert.match(opened, /claim\(1\)/);

  context.state.rewards.pop();
  assert.match(context.prizesView().split('Открытые награды')[1], /Пока нет открытых наград/);
});

test('the wheel has every ordinary prize, three souvenir and three super prize sectors', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const start = html.indexOf('function caseWheelEntries(items){');
  const end = html.indexOf('function rewardDateTime(value){', start);
  assert.ok(start >= 0 && end > start);
  const context = { esc: value => String(value), caseIcon: () => '⭐' };
  vm.createContext(context);
  vm.runInContext(html.slice(start, end), context);
  const ordinary = [{ id: 'a', name: 'Обед', cost: 1, superPrize: false }, { id: 'b', name: 'Выходной', cost: 2, superPrize: false }];
  const superPrizes = [{ id: 's1', name: 'Кино', cost: 5, superPrize: true }, { id: 's2', name: 'Day off', cost: 7, superPrize: true }];
  const options = [...ordinary, ...superPrizes];
  const segments = context.caseWheelEntries(options);
  assert.equal(segments.filter(item => item.chestSector).length, 3);
  assert.equal(segments.filter(item => item.souvenirSector).length, 3);
  assert.deepEqual(Array.from(segments.filter(item => !item.chestSector && !item.souvenirSector).map(item => item.id)), ['a', 'b']);
  assert.match(context.caseWheelView(options), /Супер-приз/);
  assert.match(context.caseWheelView(options), /Сувенир/);
});

test('public case catalog does not return probability weights', () => {
  const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  const start = server.indexOf("app.get('/api/case-catalog'");
  const end = server.indexOf("app.post('/api/open-case'", start);
  assert.ok(start >= 0 && end > start);
  const catalog = server.slice(start, end);
  assert.ok(!catalog.includes('chance:'));
  assert.ok(!catalog.includes('weight:'));
});

test('retrying an uncertain opening reuses its request id', async () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const start = html.indexOf('async function openCase(){');
  const end = html.indexOf('\nfunction animateCaseWheel(outcome){', start);
  const ids = [];
  const player = { id: 'player-1', name: 'Оля' };
  let attempts = 0;
  const context = {
    caseOpening: false, caseRequestId: '', caseLastReward: null, caseCatalog: { cost: 2 },
    saveTask: null, pendingSave: null, apiETag: '"old"', apiReady: true, TEAM_KEY: 'fomenko', selected: player.id,
    state: {}, crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000001' },
    writable: () => true, pnow: () => player, medals: () => 3, confirm: () => true,
    render: () => {}, toast: () => {}, migrate: state => state, valid: () => true, syncStatus: () => {},
    animateCaseWheel: async () => {}, loadPrizeStock: () => {}, loadCaseCatalog: () => {}, loadRewardFeed: () => {},
    document: { getElementById: () => ({ textContent: '' }) },
    fetch: async (_url, options) => {
      ids.push(JSON.parse(options.body).requestId);
      if (++attempts === 1) throw Error('Соединение прервалось');
      return { ok: true, headers: { get: () => '"new"' }, json: async () => ({ state: {}, phase: 'reward', reward: { title: 'Приз' } }) };
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

test('wheel stays a surprise during the longer spin and celebrates the saved reward', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /case-wheel-disk\.spinning\{transition:transform 10s /);
  assert.match(html, /setTimeout\(done,10800\)/);
  const viewStart = html.indexOf('function caseIcon(item){');
  const viewEnd = html.indexOf('\nasync function openCase(){', viewStart);
  const reward = { id: 'case-1', playerId: 'player-1', prizeId: 'prize-20', title: 'Day off', cost: 2, source: 'shop', case: true, superPrize: true };
  const player = { id: 'player-1', name: 'Оля' };
  const context = {
    state: { players: [player], rewards: [reward] }, pnow: () => player, medals: () => 3,
    playerSelect: () => '<select></select>', esc: value => String(value),
    caseCatalog: { cost: 2, items: [{ id: 'prize-20', name: 'Day off', cost: 7, superPrize: true, remaining: 4 }] },
    caseLastReward: reward, caseCatalogError: '', caseOpening: true, apiReady: true,
    COIN_ICON: '<img class="coin-icon" src="assets/coin-ruble.svg" alt="монетка">'
  };
  vm.createContext(context);
  vm.runInContext(html.slice(viewStart, viewEnd), context);
  const spinningView = context.prizesView();
  assert.match(spinningView, /Барабан вращается…/);
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
