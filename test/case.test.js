import test from 'node:test';
import assert from 'node:assert/strict';
import { CASE_COST, casePool, drawCasePrize } from '../case.js';

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
