import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('each reward shows its opening time and recorded delivery time', () => {
  const start = page.indexOf('function rewardDateTime(value){');
  const end = page.indexOf('function prizesView(){', start);
  assert.ok(start >= 0 && end > start);
  const reward = {
    id: 'reward-1', playerId: 'player-1', title: 'Обед 1,5 часа', cost: 2, source: 'shop', case: true,
    claimed: true, cancelled: false, at: '2026-09-18T10:28:00.000Z', claimedAt: '2026-09-18T11:42:00.000Z'
  };
  const context = { state: { players: [{ id: 'player-1', name: 'Саша' }] }, esc: value => String(value) };
  vm.createContext(context);
  vm.runInContext(page.slice(start, end), context);
  const shown = context.rewardEntryView(reward, 0);
  assert.match(shown, /Открыт кейс: 18\.09\.2026/);
  assert.match(shown, /Выдано: 18\.09\.2026/);
  assert.match(shown, /datetime="2026-09-18T10:28:00.000Z"/);
  assert.match(shown, /datetime="2026-09-18T11:42:00.000Z"/);
  delete reward.claimedAt;
  assert.match(context.rewardEntryView(reward, 0), /Выдано ранее · время не сохранено/);
});

test('marking a reward delivered records time and returning it clears that time', () => {
  const start = page.indexOf('function claim(i){');
  const end = page.indexOf('\nfunction boardChallengesView(){', start);
  assert.ok(start >= 0 && end > start);
  const reward = { playerId: 'player-1', title: 'Обед', claimed: false, cancelled: false };
  const context = {
    state: { players: [{ id: 'player-1', name: 'Саша' }], rewards: [reward] },
    adminWrite: () => true, snapshot: () => {}, log: () => {}, commit: () => {}
  };
  vm.createContext(context);
  vm.runInContext(page.slice(start, end), context);
  context.claim(0);
  assert.equal(reward.claimed, true);
  assert.ok(Number.isFinite(Date.parse(reward.claimedAt)));
  context.claim(0);
  assert.equal(reward.claimed, false);
  assert.equal(Object.hasOwn(reward, 'claimedAt'), false);
  context.adminWrite = () => false;
  context.claim(0);
  assert.equal(reward.claimed, false);
});
