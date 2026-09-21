import test from 'node:test';
import assert from 'node:assert/strict';
import { dailyChallengeAdditionsValid, moscowDay } from '../challenge-limits.js';

const entry = (id, playerId, at) => ({
  id, playerId, at, amount: 2, source: 'challenge',
  ref: `challenge-power-calls:${id}`, title: 'Мини-челлендж: мощный дожим'
});

test('power-call mini challenge is limited to once per Moscow calendar day', () => {
  const first = entry('first', 'player-1', '2026-09-21T08:00:00.000Z');
  const sameMoscowDay = entry('second', 'player-1', '2026-09-21T20:30:00.000Z');
  const nextMoscowDay = entry('third', 'player-1', '2026-09-21T21:30:00.000Z');
  assert.equal(moscowDay(first.at), '2026-09-21');
  assert.equal(moscowDay(nextMoscowDay.at), '2026-09-22');
  assert.equal(dailyChallengeAdditionsValid({ ledger: [first] }, { ledger: [first, sameMoscowDay] }), false);
  assert.equal(dailyChallengeAdditionsValid({ ledger: [first] }, { ledger: [first, nextMoscowDay] }), true);
});

test('daily limit is separate for every manager', () => {
  const first = entry('first', 'player-1', '2026-09-21T08:00:00.000Z');
  const other = entry('second', 'player-2', '2026-09-21T09:00:00.000Z');
  assert.equal(dailyChallengeAdditionsValid({ ledger: [first] }, { ledger: [first, other] }), true);
});
