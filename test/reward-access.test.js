import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rewardDeliveryUpdateValid } from '../game-integrity.js';

const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8');

function states() {
  const reward = { id: 'reward-1', playerId: 'player-1', title: 'Обед', claimed: false, cancelled: false };
  const before = {
    id: 'period', version: 3, updated: '2026-09-24T08:00:00.000Z', undo: null,
    config: { shop: [] }, players: [{ id: 'player-1', name: 'Саша' }], rewards: [reward], ledger: [], logs: []
  };
  const claimedAt = '2026-09-24T09:00:00.000Z';
  const after = structuredClone(before);
  after.updated = claimedAt;
  after.rewards[0].claimed = true;
  after.rewards[0].claimedAt = claimedAt;
  after.logs.unshift({
    id: 'log-1', at: claimedAt, text: 'Саша: приз «Обед» выдан',
    reverse: { kind: 'patch', ops: [
      { kind: 'set', path: ['rewards', 0, 'claimed'], value: false },
      { kind: 'delete', path: ['rewards', 0, 'claimedAt'] }
    ] }
  });
  return { before, after };
}

test('reward-only session lasts one minute and has separate endpoints', () => {
  assert.match(server, /const REWARD_SESSION_MS = 60 \* 1000;/);
  assert.match(server, /app\.post\('\/api\/reward-access\/login'/);
  assert.match(server, /app\.post\('\/api\/reward-access\/logout'/);
  assert.match(server, /hasRewardAccess\(req\) && rewardDeliveryUpdateValid\(before, req\.body\)/);
});

test('reward-only access accepts exactly one delivery toggle with its audit record', () => {
  const { before, after } = states();
  assert.equal(rewardDeliveryUpdateValid(before, after), true);
  const changedPlayer = structuredClone(after);
  changedPlayer.players[0].name = 'Подмена';
  assert.equal(rewardDeliveryUpdateValid(before, changedPlayer), false);
  const changedWithoutAudit = structuredClone(after);
  changedWithoutAudit.logs = [];
  assert.equal(rewardDeliveryUpdateValid(before, changedWithoutAudit), false);
});
