import test from 'node:test';
import assert from 'node:assert/strict';
import { CASE_COST, MINI_PRIZES, SOUVENIR_SECTORS, SUPER_CHEST_CHANCE, casePool, drawCasePrize, drawCaseOutcome, createChestRound } from '../case.js';

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

test('two percent of eligible case openings enter the chest round', () => {
  const items = casePool(shop, [{ prize_id: 'rare', purchased: 0, limit_count: 5 }]);
  assert.equal(SUPER_CHEST_CHANCE, 0.02);
  assert.equal(drawCaseOutcome(items, max => max === 1000 ? 19 : 0).phase, 'chests');
  assert.equal(drawCaseOutcome(items, max => max === 1000 ? 20 : 0).phase, 'reward');
  assert.equal(drawCaseOutcome(casePool(shop, [{ prize_id: 'rare', purchased: 5, limit_count: 5 }]), () => 0).phase, 'reward');
});

test('a chest round has one super prize and two distinct mini prizes', () => {
  assert.equal(MINI_PRIZES.length, 16);
  assert.equal(new Set(MINI_PRIZES.map(item => item.id)).size, MINI_PRIZES.length);
  const round = createChestRound({ id: 'rare', name: 'Выходной' }, max => max - 1);
  assert.equal(round.position, 2);
  assert.equal(round.prize.id, 'rare');
  assert.equal(new Set(round.miniPrizes.map(item => item.id)).size, 2);
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

test('souvenirs occupy eighty percent of non-chest outcomes as the ordinary catalog changes', () => {
  const ordinary = [{ id: 'cheap', cost: 1, enabled: true, superPrize: false },
    { id: 'standard', cost: 2, enabled: true, superPrize: false }];
  for (const catalog of [ordinary.slice(0, 1), ordinary]) {
    const items = casePool(catalog, []);
    const regularWeight = items.reduce((sum, item) => sum + item.weight, 0);
    let souvenirs = 0;
    for (let draw = 0; draw < regularWeight * 5; draw++) {
      const outcome = drawCaseOutcome(items, max => max === regularWeight * 5 ? draw : 0);
      if (outcome.souvenir) souvenirs++;
    }
    assert.equal(souvenirs, regularWeight * 4);
  }
});
