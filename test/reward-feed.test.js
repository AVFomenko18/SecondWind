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
    { id: '2', player: 'Никита', title: 'Обед', cost: 2, case: false, team: 'Чехова', superPrize: false, at: '2026-09-18T09:00:00.000Z' }
  ];
  const context = {
    rewardFeedLoading: false, rewardFeedSignature: '',
    document: { visibilityState: 'visible', getElementById: id => id === 'rewardFeedList' ? list : status },
    fetch: async () => ({ ok: true, json: async () => ({ entries }) }),
    esc: value => String(value), coinWord: () => 'монеты'
  };
  vm.createContext(context);
  vm.runInContext(html.slice(start, end), context);
  await context.loadRewardFeed();
  assert.match(list.innerHTML, /Саша<\/b> открыл\/а кейс за 2 монеты 🪙 и получил\/а «Day off»/);
  assert.match(list.innerHTML, /Никита<\/b> купил\/а «Обед»/);
  assert.doesNotMatch(list.innerHTML, /открыла|купила/);
});
