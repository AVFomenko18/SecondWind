import test from 'node:test';
import assert from 'node:assert/strict';
import { CASE_COST, MINI_PRIZES, SOUVENIR_SECTORS, SOUVENIR_WEIGHT_MULTIPLIER, SUPER_CHEST_CHANCE, casePool, drawCasePrize, drawCaseOutcome, createChestRound } from '../case.js';

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

test('four and a half percent of eligible case openings enter the chest round', () => {
  const items = casePool(shop, [{ prize_id: 'rare', purchased: 0, limit_count: 5 }]);
  assert.equal(SUPER_CHEST_CHANCE, 0.045);
  assert.equal(drawCaseOutcome(items, max => max === 1000 ? 44 : 0).phase, 'chests');
  assert.equal(drawCaseOutcome(items, max => max === 1000 ? 45 : 0).phase, 'reward');
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

test('three souvenir sectors award a random souvenir without changing super chest odds', () => {
  const items = casePool(shop, [{ prize_id: 'rare', purchased: 0, limit_count: 5 }]);
  assert.equal(SOUVENIR_SECTORS, 3);
  const picks = [500, 3600, 0];
  const first = drawCaseOutcome(items, () => picks.shift());
  assert.equal(first.phase, 'reward');
  assert.equal(first.souvenir, true);
  assert.equal(first.prize.id, MINI_PRIZES[0].id);
  const secondPicks = [500, 3600, MINI_PRIZES.length - 1];
  const second = drawCaseOutcome(items, () => secondPicks.shift());
  assert.equal(second.prize.id, MINI_PRIZES.at(-1).id);
});

test('souvenirs replace half of the previous sports-reward probability', () => {
  assert.equal(SOUVENIR_WEIGHT_MULTIPLIER, 10);
  const previousSportsChance = (1 - SUPER_CHEST_CHANCE) / 5 + SUPER_CHEST_CHANCE / 3;
  const sportsChance = (1 - SUPER_CHEST_CHANCE) / (1 + SOUVENIR_WEIGHT_MULTIPLIER) + SUPER_CHEST_CHANCE / 3;
  const souvenirChance = (1 - SUPER_CHEST_CHANCE) * SOUVENIR_WEIGHT_MULTIPLIER / (1 + SOUVENIR_WEIGHT_MULTIPLIER) + SUPER_CHEST_CHANCE / 3;
  assert.ok(sportsChance <= previousSportsChance / 2);
  assert.ok(Math.abs(sportsChance - 0.1018) < 0.0001);
  assert.ok(Math.abs(souvenirChance - 0.8832) < 0.0001);
  const ordinary = [{ id: 'cheap', cost: 1, enabled: true, superPrize: false },
    { id: 'standard', cost: 2, enabled: true, superPrize: false }];
  for (const catalog of [ordinary.slice(0, 1), ordinary]) {
    const items = casePool(catalog, []);
    const regularWeight = items.reduce((sum, item) => sum + item.weight, 0);
    let souvenirs = 0;
    for (let draw = 0; draw < regularWeight * (1 + SOUVENIR_WEIGHT_MULTIPLIER); draw++) {
      const outcome = drawCaseOutcome(items, max => max === regularWeight * (1 + SOUVENIR_WEIGHT_MULTIPLIER) ? draw : 0);
      if (outcome.souvenir) souvenirs++;
    }
    assert.equal(souvenirs, regularWeight * SOUVENIR_WEIGHT_MULTIPLIER);
  }
});
