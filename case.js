import { randomInt } from 'node:crypto';

export const CASE_COST = 2;
export const SUPER_CHEST_CHANCE = 0.02;
export const SOUVENIR_SECTORS = 3;
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
  { id: 'mini-warm-lead-lantern', name: 'Фонарь тёплого лида', icon: '🏮' },
  { id: 'mini-next-call-key', name: 'Ключ к следующему созвону', icon: '🗝️' },
  { id: 'mini-timing-watch', name: 'Часы удачного касания', icon: '⏱️' },
  { id: 'mini-pitch-cloak', name: 'Плащ уверенного питча', icon: '🦸' },
  { id: 'mini-offer-die', name: 'Кубик удачного оффера', icon: '🎲' }
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
  const chestRound = superPrizes.length && drawRandom(1000) < SUPER_CHEST_CHANCE * 1000;
  if (chestRound) return { phase: 'chests', prize: drawCasePrize(superPrizes, drawRandom) };
  const ordinaryWeight = ordinary.reduce((sum, item) => sum + item.weight, 0);
  const souvenirWeight = ordinaryWeight ? ordinaryWeight * 4 : SOUVENIR_SECTORS;
  const souvenirSectors = Array.from({ length: SOUVENIR_SECTORS }, (_, index) =>
    ({ id: `souvenir-sector-${index}`, weight: Math.floor(souvenirWeight / SOUVENIR_SECTORS) + (index < souvenirWeight % SOUVENIR_SECTORS ? 1 : 0), souvenirSector: true }));
  const drawn = drawCasePrize([...ordinary, ...souvenirSectors], drawRandom);
  return drawn.souvenirSector
    ? { phase: 'reward', prize: MINI_PRIZES[drawRandom(MINI_PRIZES.length)], souvenir: true }
    : { phase: 'reward', prize: drawn };
}

export function createChestRound(prize, drawRandom = randomInt) {
  const position = drawRandom(3);
  const first = drawRandom(MINI_PRIZES.length);
  const secondDraw = drawRandom(MINI_PRIZES.length - 1);
  const second = secondDraw >= first ? secondDraw + 1 : secondDraw;
  return { position, prize: { id: prize.id, name: prize.name }, miniPrizes: [MINI_PRIZES[first], MINI_PRIZES[second]] };
}
