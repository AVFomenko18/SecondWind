import test from 'node:test';
import assert from 'node:assert/strict';
import { CASE_COST, MINI_PRIZES, MINI_PRIZE_CHANCE, SOUVENIR_SECTORS, SOUVENIR_WEIGHT_MULTIPLIER, SPORTS_REWARD_CHANCE, SUPER_CHEST_CHANCE, SUPER_PRIZE_CHANCE, casePool, drawCasePrize, drawCaseOutcome, createChestRound } from '../case.js';

const shop = [
  { id: 'cheap', name: 'Обед', cost: 1, enabled: true, superPrize: false },
  { id: 'standard', name: 'Ранний уход', cost: 2, enabled: true, superPrize: false },
  { id: 'rare', name: 'Выходной', cost: 7, enabled: true, superPrize: true },
  { id: 'hidden', name: 'Не продаётся', cost: 1, enabled: false, superPrize: false }
];

test('case odds favor cheaper prizes and keep expensive super prizes rare', () => {
  assert.equal(CASE_COST, 2);
  const items = casePool(shop, [{ prize_id: 'rare', purchased: 0, limit_count: 5 }]);
  assert.deepEqual(items.map(item => item.id), ['cheap', 'standard', 'rare']);
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  assert.ok(items[0].weight > items[1].weight);
  assert.ok(items[1].weight > items[2].weight);
  assert.ok(items[2].weight / total < 0.01);
  assert.equal(items[2].remaining, 5);
  assert.equal(drawCasePrize(items, () => 0).id, 'cheap');
  assert.equal(drawCasePrize(items, () => total - 1).id, 'rare');
});

test('sold-out and disabled prizes cannot be drawn', () => {
  const items = casePool(shop, [{ prize_id: 'rare', purchased: 5, limit_count: 5 }]);
  assert.deepEqual(items.map(item => item.id), ['cheap', 'standard']);
  assert.equal(drawCasePrize([], () => 0), null);
});

test('six and three-quarter percent of eligible case openings enter the chest round', () => {
  const items = casePool(shop, [{ prize_id: 'rare', purchased: 0, limit_count: 5 }]);
  assert.ok(Math.abs(SUPER_CHEST_CHANCE - 0.0675) < Number.EPSILON);
  assert.equal(drawCaseOutcome(items, max => max === 1_000_000 ? 67_499 : 0).phase, 'chests');
  assert.equal(drawCaseOutcome(items, max => max === 1_000_000 ? 67_500 : 0).phase, 'reward');
  assert.equal(drawCaseOutcome(casePool(shop, [{ prize_id: 'rare', purchased: 5, limit_count: 5 }]), () => 0).phase, 'reward');
});

test('a chest round has one super prize, one souvenir and one ordinary prize', () => {
  assert.equal(MINI_PRIZES.length, 16);
  assert.equal(new Set(MINI_PRIZES.map(item => item.id)).size, MINI_PRIZES.length);
  const ordinary = casePool(shop, [{ prize_id: 'rare', purchased: 0, limit_count: 5 }]).filter(item => !item.superPrize);
  const round = createChestRound({ id: 'rare', name: 'Выходной' }, ordinary, max => max - 1);
  assert.equal(round.position, 2);
  assert.equal(round.prize.id, 'rare');
  assert.deepEqual(round.chests.map(item => item.type).sort(), ['ordinary', 'souvenir', 'super']);
  assert.equal(round.chests[2].prize.id, 'rare');
  assert.equal(round.chests.find(item => item.type === 'souvenir').prize.id, MINI_PRIZES.at(-1).id);
  assert.equal(round.chests.find(item => item.type === 'ordinary').prize.id, 'standard');
});

test('a guaranteed chest round still looks like a normal three-category round', () => {
  const ordinary = casePool(shop, [{ prize_id: 'rare', purchased: 0, limit_count: 5 }]).filter(item => !item.superPrize);
  const round = createChestRound({ id: 'rare', name: 'Выходной' }, ordinary, () => 0, true);
  assert.equal(round.guaranteedSuper, true);
  assert.deepEqual(round.chests.map(item => item.type).sort(), ['ordinary', 'souvenir', 'super']);
});

test('three souvenir sectors award a random souvenir without changing super chest odds', () => {
  const items = casePool(shop, [{ prize_id: 'rare', purchased: 0, limit_count: 5 }]);
  assert.equal(SOUVENIR_SECTORS, 3);
  const picks = [500_000, 999_999, 0];
  const first = drawCaseOutcome(items, () => picks.shift());
  assert.equal(first.phase, 'reward');
  assert.equal(first.souvenir, true);
  assert.equal(first.prize.id, MINI_PRIZES[0].id);
  const secondPicks = [500_000, 999_999, MINI_PRIZES.length - 1];
  const second = drawCaseOutcome(items, () => secondPicks.shift());
  assert.equal(second.prize.id, MINI_PRIZES.at(-1).id);
});

test('halved super-prize chance returns its share to mini prizes', () => {
  assert.equal(SOUVENIR_WEIGHT_MULTIPLIER, 10);
  const previousSuperPrizeChance = SUPER_PRIZE_CHANCE * 2;
  const previousMiniChance = 1 - SPORTS_REWARD_CHANCE - previousSuperPrizeChance;
  assert.ok(Math.abs(SPORTS_REWARD_CHANCE - 0.1018) < 0.0001);
  assert.ok(Math.abs(MINI_PRIZE_CHANCE - 0.8757) < 0.0001);
  assert.ok(Math.abs(MINI_PRIZE_CHANCE - previousMiniChance - 0.0225) < Number.EPSILON);
  assert.ok(Math.abs(SUPER_CHEST_CHANCE / 3 - SUPER_PRIZE_CHANCE) < Number.EPSILON);
  assert.ok(Math.abs(SUPER_PRIZE_CHANCE - 0.0225) < Number.EPSILON);
});
