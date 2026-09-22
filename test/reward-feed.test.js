import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('reward feed uses neutral verbs without guessing gender from names', async () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const start = html.indexOf('async function loadRewardFeed(){');
  const end = html.indexOf('\nfunction renderHeroChallenges', start);
  assert.ok(start >= 0 && end > start);
  const list = { scrollTop: 0, innerHTML: '' };
  const status = { textContent: '' };
  const entries = [
    { id: '1', player: 'Саша', title: 'Day off', cost: 2, case: true, team: 'Фоменко', superPrize: true, at: '2026-09-18T10:00:00.000Z' },
    { id: '2', player: 'Никита', title: 'Обед', cost: 2, case: true, team: 'Чехова', superPrize: false, miniPrize: false, at: '2026-09-18T09:00:00.000Z' },
    { id: '3', player: 'Ирина', title: 'Кубик удачного распределения', cost: 2, case: true, team: 'Куликов', superPrize: false, miniPrize: true, at: '2026-09-18T08:00:00.000Z' }
  ];
  const context = {
    rewardFeedLoading: false, rewardFeedSignature: '',
    document: { visibilityState: 'visible', getElementById: id => id === 'rewardFeedList' ? list : status },
    fetch: async () => ({ ok: true, json: async () => ({ entries }) }),
    esc: value => String(value), coinWord: () => 'монеты',
    COIN_ICON: '<img class="coin-icon" src="assets/coin-ruble.svg" alt="монетка">'
  };
  vm.createContext(context);
  vm.runInContext(html.slice(start, end), context);
  await context.loadRewardFeed();
  assert.match(list.innerHTML, /Саша<\/b> открыл\(а\) кейс за 2 монеты <img class="coin-icon"[^>]+> и получил\(а\) «Day off»/);
  assert.match(list.innerHTML, /class="reward-feed-item sport"/);
  assert.match(list.innerHTML, /СПОРТИВНАЯ НАГРАДА/);
  assert.match(list.innerHTML, /class="reward-feed-item mini"/);
  assert.match(list.innerHTML, /МИНИ-ПРИЗ/);
  assert.match(list.innerHTML, /Никита<\/b> открыл\(а\) кейс.*«Обед»/);
  assert.match(list.innerHTML, /Ирина<\/b> открыл\(а\) кейс.*«Кубик удачного распределения»/);
  assert.doesNotMatch(list.innerHTML, /открыла|купила/);
});

test('reward feed API exposes prize categories used by the dashboard', () => {
  const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  assert.match(server, /miniPrize: reward\.miniPrize === true/);
  assert.match(server, /souvenir: reward\.souvenir === true/);
});
