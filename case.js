import { randomInt } from 'node:crypto';

export const CASE_COST = 2;

export function caseWeight(item) {
  if (item.superPrize) return item.cost >= 7 ? 20 : item.cost >= 4 ? 50 : 100;
  return item.cost <= 1 ? 2400 : item.cost === 2 ? 1200 : item.cost === 3 ? 600 : Math.max(30, Math.round(1200 / item.cost ** 2));
}

export function casePool(shop, inventory) {
  const stock = new Map(inventory.map(row => [row.prize_id, row]));
  return shop.filter(item => item.enabled && (!item.superPrize || Number(stock.get(item.id)?.purchased) < Number(stock.get(item.id)?.limit_count)))
    .map(item => ({ ...item, weight: caseWeight(item), remaining: item.superPrize ? Number(stock.get(item.id).limit_count) - Number(stock.get(item.id).purchased) : null }));
}

export function drawCasePrize(items, drawRandom = randomInt) {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  if (!total) return null;
  let draw = drawRandom(total);
  return items.find(item => (draw -= item.weight) < 0);
}
