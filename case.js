import { randomInt } from 'node:crypto';

export const CASE_COST = 2;
const SPORTS_BALANCE_REFERENCE_CHEST_CHANCE = 0.045;
export const SUPER_PRIZE_CHANCE = 0.0225;
export const SUPER_CHEST_CHANCE = SUPER_PRIZE_CHANCE * 3;
export const SOUVENIR_SECTORS = 3;
export const SOUVENIR_WEIGHT_MULTIPLIER = 10;
export const SPORTS_REWARD_CHANCE = (1 - SPORTS_BALANCE_REFERENCE_CHEST_CHANCE) / (1 + SOUVENIR_WEIGHT_MULTIPLIER) + SPORTS_BALANCE_REFERENCE_CHEST_CHANCE / 3;
export const MINI_PRIZE_CHANCE = 1 - SPORTS_REWARD_CHANCE - SUPER_CHEST_CHANCE / 3;
const NON_CHEST_SPORTS_CHANCE = (SPORTS_REWARD_CHANCE - SUPER_CHEST_CHANCE / 3) / (1 - SUPER_CHEST_CHANCE);
const CATEGORY_DRAW_SCALE = 1_000_000;
export const MINI_PRIZES = Object.freeze([
  { id: 'mini-bank-charm', name: 'Оберег от отказов банка', icon: '🧿' },
  { id: 'mini-garlic', name: 'Чеснок для отпугивания CCC клиентов', icon: '🧄' },
  { id: 'mini-call-potion', name: 'Зелье оплат в касание', icon: '🧪' },
  { id: 'mini-objection-hammer', name: 'Молот отработки возражений', icon: '🔨' },
  { id: 'mini-lead-compass', name: 'Компас переговорных путей', icon: '🧭' },
  { id: 'mini-client-amulet', name: 'Амулет спокойного клиента', icon: '✨' },
  { id: 'mini-script-feather', name: 'Перо идеального скрипта', icon: '🪶' },
  { id: 'mini-deal-magnet', name: 'Магнит закрытых сделок', icon: '🧲' },
  { id: 'mini-meeting-shield', name: 'Щит от переноса встречи', icon: '🛡️' },
  { id: 'mini-needs-lens', name: 'Лупа скрытой потребности', icon: '🔍' },
  { id: 'mini-client-boomerang', name: 'Бумеранг пропавшего клиента', icon: '🪃' },
  { id: 'mini-warm-lead-lantern', name: 'Фонарь горячего лида', icon: '🏮' },
  { id: 'mini-next-call-key', name: 'Ключ к следующему созвону', icon: '🗝️' },
  { id: 'mini-timing-watch', name: 'Часы быстрой оплаты', icon: '⏱️' },
  { id: 'mini-pitch-cloak', name: 'Плащ уверенной презентации', icon: '🦸' },
  { id: 'mini-offer-die', name: 'Кубик удачного распределения', icon: '🎲' }
]);

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

export function drawCaseOutcome(items, drawRandom = randomInt) {
  const ordinary = items.filter(item => !item.superPrize);
  const superPrizes = items.filter(item => item.superPrize);
  if (!ordinary.length && !superPrizes.length) return null;
  const chestEligible = Boolean(superPrizes.length && ordinary.length);
  const chestRound = chestEligible && drawRandom(CATEGORY_DRAW_SCALE) < Math.round(SUPER_CHEST_CHANCE * CATEGORY_DRAW_SCALE);
  if (chestRound) return { phase: 'chests', prize: drawCasePrize(superPrizes, drawRandom) };
  const sportsChance = chestEligible ? NON_CHEST_SPORTS_CHANCE : 1 / (1 + SOUVENIR_WEIGHT_MULTIPLIER);
  const sportsReward = ordinary.length && drawRandom(CATEGORY_DRAW_SCALE) < Math.round(sportsChance * CATEGORY_DRAW_SCALE);
  return sportsReward
    ? { phase: 'reward', prize: drawCasePrize(ordinary, drawRandom) }
    : { phase: 'reward', prize: MINI_PRIZES[drawRandom(MINI_PRIZES.length)], souvenir: true };
}

export function createChestRound(prize, ordinaryPrizes, drawRandom = randomInt, guaranteedSuper = false) {
  if (!ordinaryPrizes.length) throw new Error('A chest round requires an ordinary prize');
  const superPrize = { id: prize.id, name: prize.name };
  const position = drawRandom(3);
  const openPositions = [0, 1, 2].filter(index => index !== position);
  const souvenirPosition = openPositions.splice(drawRandom(2), 1)[0];
  const ordinaryPosition = openPositions[0];
  const souvenir = MINI_PRIZES[drawRandom(MINI_PRIZES.length)];
  const ordinary = drawCasePrize(ordinaryPrizes, drawRandom);
  const chests = [];
  chests[position] = { type: 'super', prize: superPrize };
  chests[souvenirPosition] = { type: 'souvenir', prize: souvenir };
  chests[ordinaryPosition] = { type: 'ordinary', prize: { id: ordinary.id, name: ordinary.name } };
  return { position, prize: superPrize, chests, ...(guaranteedSuper ? { guaranteedSuper: true } : {}) };
}
