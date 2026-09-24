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
    writable: () => true, snapshot: () => {}, log: () => {}, commit: () => {},
    rewardAccessUntil: Date.now() + 60000, pendingClaimIndex: null, rewardAccessTimer: null,
    document: { getElementById: () => null }
  };
  vm.createContext(context);
  vm.runInContext(page.slice(start, end), context);
  context.claimReward(0);
  assert.equal(reward.claimed, true);
  assert.ok(Number.isFinite(Date.parse(reward.claimedAt)));
  context.claimReward(0);
  assert.equal(reward.claimed, false);
  assert.equal(Object.hasOwn(reward, 'claimedAt'), false);
  context.writable = () => false;
  context.claimReward(0);
  assert.equal(reward.claimed, false);
});

test('marking a reward asks for a password when the minute access expired', () => {
  const start = page.indexOf('function rewardAccessActive(){');
  const end = page.indexOf('\nfunction claimReward(', start);
  let shown = 0, focused = 0;
  const fields = {
    rewardAccessDialog: { open: false, showModal() { this.open = true; shown++; } },
    rewardAccessPassword: { value: 'old', focus() { focused++; } },
    rewardAccessError: { textContent: 'old error' }
  };
  const context = {
    state: { rewards: [{ claimed: false, cancelled: false }] }, rewardAccessUntil: 0, pendingClaimIndex: null,
    document: { getElementById: id => fields[id] }
  };
  vm.createContext(context);
  vm.runInContext(page.slice(start, end), context);
  context.claim(0);
  assert.equal(context.pendingClaimIndex, 0);
  assert.equal(shown, 1);
  assert.equal(focused, 1);
  assert.equal(fields.rewardAccessPassword.value, '');
  assert.equal(fields.rewardAccessError.textContent, '');
});
