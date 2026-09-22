import express from 'express';
import pg from 'pg';
import { createHmac, createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { CASE_COST, MINI_PRIZES, SUPER_CHEST_CHANCE, casePool, drawCaseOutcome, createChestRound } from './case.js';
import { publicUpdateValid } from './game-integrity.js';
import { dailyChallengeAdditionsValid } from './challenge-limits.js';
import { normalizeSalesName, parseSalesNotification, startsNewPeriod } from './telegram-actions.js';
import { FOMENKO_ALIASES, ROSTER_ALIASES, TEAM_ROSTERS, TELEGRAM_NAME_OVERRIDES } from './team-rosters.js';

const { Pool } = pg;
const app = express();
const ACTION_CREDIT_RESET_MIGRATION = '2026-09-21-reset-pending-action-credits-v2';
const FOMENKO_ACTION_CREDIT_GRANT_MIGRATION = '2026-09-22-grant-alexander-fomenko-action-credits-v1';
const ACTIVITY_CREDIT_GRANT_MIGRATION = '2026-09-22-grant-activity-70-percent-for-2026-09-21-v1';
const ZINKEVICH_PAYMENT_CREDIT_CORRECTION = '2026-09-22-move-zinkevich-high-payment-to-mid-v1';
const MANAGER_NAME_SYNC_MIGRATION = '2026-09-22-correct-five-manager-names-and-resync-v2';
const SUPER_PRIZE_LIMITS_MIGRATION = '2026-09-22-update-super-prize-limits-v1';
const CERTIFICATE_DEMO_STOCK_MIGRATION = '2026-09-22-reset-demo-certificate-stock-v1';
const ACTIVITY_CREDIT_GRANTS = Object.freeze({
  fomenko: ['Попова Анастасия', 'Мишин Иван'],
  shabanov: ['Константинова Екатерина', 'Левченко Владислав', 'Пименова Виктория', 'Тихомирова Алина'],
  lvovsky: ['Кузнецова Екатерина', 'Шмаков Юрий', 'Зыбченко Анастасия', 'Сопилкина Наталья', 'Соловьева Светлана'],
  kozhanov: ['Печинога Валерия', 'Шеханова Лилия', 'Негреева Диана'],
  kulikov: ['Ильина Диана', 'Кухто Арина', 'Беспалов Евгений', 'Забродская Карина'],
  kondratyev: ['Рассомакин Иван', 'Руденко Оксана', 'Шапошникова Натали', 'Шевелева Ксения'],
  otrakusha: ['Лобков Артур', 'Мартышкина Ольга', 'Пасхалиди Димитрий'],
  chekhova: ['Гурулёва Дарья', 'Шарапова Анастасия'],
  tolstov: ['Прохорова Василиса', 'Гусев Кирилл', 'Романова Людмила', 'Квон Екатерина', 'Умнова Виктория'],
  bagaturiya: ['Белеева Мария', 'Степанов Петр', 'Лем Станислав', 'Михайлова Карина', 'Брудковски Александра', 'Золотарев Игорь'],
  klimentovich: ['Шум Карина', 'Яловегин Николай', 'Гончарова Ирина', 'Зинкевич Елизавета']
});
const MANAGER_NAME_SYNCS = Object.freeze([
  { team: 'otrakusha', name: 'Пасхалиди Димитрий', aliases: ['Пасхалиди Дмитрий'] },
  { team: 'chekhova', name: 'Гурулёва Дарья', aliases: ['Турулёва Дарья'] },
  { team: 'bagaturiya', name: 'Брудковски Александра', aliases: ['Бруковски Александра'] },
  { team: 'klimentovich', name: 'Яловегин Николай', aliases: ['Яловеин Николай'] },
  { team: 'klimentovich', name: 'Качегова Даяна', aliases: ['Качетова Даяна'] }
]);

const NEW_SHOP_PRIZES = Object.freeze([
  { id: 'prize-21', name: 'Забрать оплату у робота Алёши · до 50 000 ₽', cost: 7, enabled: true },
  { id: 'prize-22', name: 'Индивидуальная гифка с менеджером', cost: 2, enabled: true },
  { id: 'prize-23', name: 'Доставка еды от босса', cost: 7, enabled: true },
  { id: 'prize-24', name: 'Индивидуальная плашка в чате продаж', cost: 2, enabled: true },
  { id: 'prize-25', name: 'Индивидуальная отбивка при продажах', cost: 2, enabled: true }
]);
const INITIAL_SUPER_PRIZE_LIMITS = Object.freeze({ 'prize-8': 10, 'prize-9': 10, 'prize-21': 6, 'prize-23': 10 });
const DEFAULT_SHOP_NAMES = ['Закончить день на 30 минут раньше', 'Обед 1,5 часа', 'День без встреч', 'День без отчётов', 'Несгораемый день', 'Отказаться от двух лидов', '+1 курс в распределение', 'Сертификат 1 000 ₽', 'Кино от босса'];
const DEFAULT_SHOP_COSTS = [2, 1, 3, 2, 3, 2, 3, 4, 2];
const DEFAULT_SHOP = DEFAULT_SHOP_NAMES.map((name, index) => ({ id: `prize-${index + 1}`, name, cost: DEFAULT_SHOP_COSTS[index], enabled: true })).concat(NEW_SHOP_PRIZES);
function completeShop(items) {
  const shop = Array.isArray(items) ? items.filter(item => !['prize-0', 'prize-10', 'prize-20'].includes(item.id)).map(item => ({ ...item })) : DEFAULT_SHOP.map(item => ({ ...item }));
  for (const item of shop) if (item.id === 'prize-9' && item.name === 'Обед от босса') item.name = 'Кино от босса';
  for (const item of shop) {
    if (item.id === 'prize-1' && item.name === 'Закончить день на час раньше') item.name = 'Закончить день на 30 минут раньше';
    if (item.id === 'prize-6' && /^Отказаться от (?:2|3|двух|трёх) лидов$/i.test(item.name)) item.name = 'Отказаться от двух лидов';
    if (item.id === 'prize-7' && /^\+[135] курс(?:ов|а)? в распределение$/i.test(item.name)) item.name = '+1 курс в распределение';
    if (item.id === 'prize-24' && item.name === 'Индивидуальный тег в группе в ТГ') item.name = 'Индивидуальная плашка в чате продаж';
  }
  for (const prize of NEW_SHOP_PRIZES) if (!shop.some(item => item.id === prize.id)) shop.push({ ...prize });
  return shop.map(item => ({ ...item,
    superPrize: typeof item.superPrize === 'boolean' ? item.superPrize : Object.hasOwn(INITIAL_SUPER_PRIZE_LIMITS, item.id),
    stockLimit: Number.isSafeInteger(item.stockLimit) && item.stockLimit > 0 ? item.stockLimit : (INITIAL_SUPER_PRIZE_LIMITS[item.id] || 5)
  }));
}
async function updateInitialSuperPrizeLimits() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const migration = await client.query(
      'INSERT INTO app_migrations (id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING id',
      [SUPER_PRIZE_LIMITS_MIGRATION]
    );
    if (migration.rows.length) {
      const result = await client.query('SELECT data FROM department_shop WHERE id = 1 FOR UPDATE');
      const catalog = completeShop(result.rows[0]?.data);
      for (const item of catalog) {
        if (Object.hasOwn(INITIAL_SUPER_PRIZE_LIMITS, item.id)) item.stockLimit = INITIAL_SUPER_PRIZE_LIMITS[item.id];
      }
      await client.query('UPDATE department_shop SET data = $1::jsonb WHERE id = 1', [JSON.stringify(catalog)]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
function validShop(shop) {
  return Array.isArray(shop) && shop.length > 0 && shop.length <= 50 && new Set(shop.map(item => item.id)).size === shop.length && shop.every(item =>
    item && typeof item.id === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)+$/i.test(item.id) && item.id.length <= 80 &&
    typeof item.name === 'string' && item.name.trim().length > 0 && item.name.length <= 200 &&
    Number.isSafeInteger(item.cost) && item.cost >= 1 && item.cost <= 10000 && typeof item.enabled === 'boolean' &&
    typeof item.superPrize === 'boolean' && Number.isSafeInteger(item.stockLimit) && item.stockLimit >= 1 && item.stockLimit <= 10000);
}
const DEFAULT_RULES = Object.freeze({ cashUnit: 50000, crossSteps: 1, actions: [], challenges: [
  { id: 'challenge-1', name: 'Личный рекорд', description: 'Превысить свой лучший дневной результат по количеству оплат. Предложение — согласуйте критерий до старта.', medals: 1, enabled: false },
  { id: 'challenge-2', name: 'Командный ассист', description: 'Помочь коллеге довести сложную сделку до оплаты. Предложение — согласуйте критерий до старта.', medals: 1, enabled: false },
  { id: 'challenge-3', name: 'Большой рывок', description: 'Выполнить особую цель периода, заранее согласованную с ведущим.', medals: 2, enabled: false },
  { id: 'challenge-power-calls', name: 'Мини-челлендж: мощный дожим', description: 'Провести три звонка с мощным дожимом. Можно выполнить один раз в день.', medals: 2, enabled: true }
] });
function sharedRules(config) {
  return { cashUnit: config?.cashUnit, crossSteps: config?.crossSteps,
    actions: config?.actions, challenges: config?.challenges };
}
function validRules(rules) {
  const validId = id => typeof id === 'string' && id.length <= 80 && /^[a-z0-9]+(?:-[a-z0-9]+)+$/i.test(id);
  const validName = name => typeof name === 'string' && name.length > 0 && name.length <= 120;
  const unique = items => items.every(item => item && typeof item === 'object') && new Set(items.map(item => item.id)).size === items.length;
  return rules && Number.isSafeInteger(rules.cashUnit) && rules.cashUnit >= 1 && rules.cashUnit <= 100000000 &&
    Number.isSafeInteger(rules.crossSteps) && rules.crossSteps >= 1 && rules.crossSteps <= 100 &&
    Array.isArray(rules.actions) && rules.actions.length <= 30 && unique(rules.actions) &&
    rules.actions.every(item => item && validId(item.id) && validName(item.name) &&
      Number.isSafeInteger(item.unit) && item.unit >= 1 && item.unit <= 1000000 &&
      Number.isSafeInteger(item.steps) && item.steps >= 1 && item.steps <= 100 && typeof item.enabled === 'boolean') &&
    Array.isArray(rules.challenges) && rules.challenges.length <= 30 && unique(rules.challenges) &&
    rules.challenges.every(item => item && validId(item.id) && validName(item.name) &&
      typeof item.description === 'string' && item.description.length > 0 && item.description.length <= 500 &&
      Number.isSafeInteger(item.medals) && item.medals >= 1 && item.medals <= 100 && typeof item.enabled === 'boolean');
}
function withDepartmentConfig(data, shop, rules) {
  if (!data?.config) return data;
  return { ...data, config: { ...data.config, shop, ...rules } };
}
function ruleUsage(states) {
  const challengeIds = new Set(), actionIds = new Set();
  let economyUsed = false;
  for (const game of states) {
    for (const entry of Array.isArray(game?.ledger) ? game.ledger : []) {
      if (entry?.source === 'challenge' && typeof entry.ref === 'string') {
        challengeIds.add(entry.ref.startsWith('challenge-power-calls:') ? 'challenge-power-calls' : entry.ref);
      }
    }
    for (const player of Array.isArray(game?.players) ? game.players : []) {
      if (player.cash > (player.cashBase || 0) || player.calls > 0 || player.cross > 0) economyUsed = true;
      for (const [key, count] of Object.entries(player.actionCounts || {})) {
        if (count && key.startsWith('action-')) actionIds.add(key);
        if (count) economyUsed = true;
      }
    }
  }
  return { economyUsed, challengeIds: [...challengeIds], actionIds: [...actionIds] };
}
function changesUsedRules(before, after, usage) {
  if (usage.economyUsed && (before.cashUnit !== after.cashUnit || before.crossSteps !== after.crossSteps)) return true;
  for (const [kind, ids, fields] of [
    ['challenges', usage.challengeIds, ['name', 'description', 'medals']],
    ['actions', usage.actionIds, ['name', 'unit', 'steps']]
  ]) {
    const next = new Map(after[kind].map(item => [item.id, item]));
    for (const item of before[kind]) {
      if (ids.includes(item.id) && (!next.has(item.id) || fields.some(field => item[field] !== next.get(item.id)[field]))) return true;
    }
  }
  return false;
}

app.use(express.json({ limit: '30mb' }));
app.use(express.static('.'));

const ADMIN_COOKIE = 'secondwind_admin';
const SESSION_MS = 8 * 60 * 60 * 1000;
const loginAttempts = new Map();
function equalSecret(a, b) {
  const left = createHash('sha256').update(a).digest();
  const right = createHash('sha256').update(b).digest();
  return timingSafeEqual(left, right);
}
function signature(expires) {
  return createHmac('sha256', process.env.ADMIN_PASSWORD).update(`secondwind-admin:${expires}`).digest('hex');
}
function isAdmin(req) {
  if (!process.env.ADMIN_PASSWORD) return false;
  const cookie = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(`${ADMIN_COOKIE}=`));
  const match = cookie?.slice(ADMIN_COOKIE.length + 1).match(/^(\d{13})\.([a-f0-9]{64})$/);
  return Boolean(match && Number(match[1]) > Date.now() && equalSecret(match[2], signature(match[1])));
}
function sameOrigin(req) {
  const origin = req.get('origin');
  if (!origin) return true;
  const forwardedHost = req.get('x-forwarded-host') || req.get('host');
  const protocol = req.get('x-forwarded-proto') || req.protocol;
  return origin === `${protocol}://${forwardedHost}`;
}
function adminCookie(req, value, maxAge) {
  const secure = req.secure || req.get('x-forwarded-proto') === 'https';
  return `${ADMIN_COOKIE}=${value}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}
app.get('/api/admin/session', (req, res) => res.json({ authenticated: isAdmin(req), configured: Boolean(process.env.ADMIN_PASSWORD) }));
app.post('/api/admin/login', (req, res) => {
  if (!sameOrigin(req)) return res.status(403).json({ error: 'Недопустимый источник запроса.' });
  if (!process.env.ADMIN_PASSWORD) return res.status(503).json({ error: 'На Render не задан ADMIN_PASSWORD. Руководитель должен добавить его в Environment.' });
  const key = req.ip;
  const attempt = loginAttempts.get(key) || { count: 0, until: 0 };
  if (attempt.until > Date.now()) return res.status(429).json({ error: 'Слишком много попыток. Повторите через 15 минут.' });
  const password = req.body?.password;
  if (typeof password !== 'string' || !equalSecret(password, process.env.ADMIN_PASSWORD)) {
    attempt.count++;
    if (attempt.count >= 5) { attempt.count = 0; attempt.until = Date.now() + 15 * 60 * 1000; }
    loginAttempts.set(key, attempt);
    return res.status(401).json({ error: 'Неверный пароль.' });
  }
  loginAttempts.delete(key);
  const expires = String(Date.now() + SESSION_MS);
  res.setHeader('Set-Cookie', adminCookie(req, `${expires}.${signature(expires)}`, SESSION_MS / 1000));
  res.json({ authenticated: true });
});
app.post('/api/admin/logout', (req, res) => {
  if (!sameOrigin(req)) return res.status(403).json({ error: 'Недопустимый источник запроса.' });
  res.setHeader('Set-Cookie', adminCookie(req, '', 0));
  res.json({ authenticated: false });
});

function protectedChange(before, after) {
  if (!before || Object.keys(before).length === 0) return false;
  if (!after || typeof after !== 'object') return true;
  if (!Array.isArray(after.players) || !Array.isArray(after.ledger)) return true;
  if (!isDeepStrictEqual(before.config, after.config) || before.id !== after.id) return true;
  const remainingPlayers = new Set(after.players.map(player => player.id));
  if ((Array.isArray(before.players) ? before.players : []).some(player => !remainingPlayers.has(player.id))) return true;
  const oldLogs = Array.isArray(before.logs) ? before.logs : [];
  const newLogs = Array.isArray(after.logs) ? after.logs : [];
  if (newLogs.length < oldLogs.length || (oldLogs.length > 0 && !isDeepStrictEqual(newLogs.slice(-oldLogs.length), oldLogs))) return true;
  const adminEntries = ledger => (Array.isArray(ledger) ? ledger : []).filter(x => ['challenge', 'manual'].includes(x?.source));
  return !isDeepStrictEqual(adminEntries(before.ledger), adminEntries(after.ledger));
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function stateETag(data) {
  return `"${createHash('sha256').update(canonicalJson(data)).digest('hex')}"`;
}

function countedReward(reward) {
  return reward?.superPrize === true || (reward?.superPrize === undefined && Object.hasOwn(INITIAL_SUPER_PRIZE_LIMITS, reward?.prizeId));
}
function inventoryChanges(before, after, ids) {
  const changes = {};
  // A period switch or restoration changes the state id. Historical purchases
  // have already been counted and must not be counted again or returned.
  if (before?.id && before.id !== after?.id) {
    return Object.fromEntries(ids.map(id => [id, 0]));
  }
  for (const id of ids) {
    const previous = new Map((Array.isArray(before?.rewards) ? before.rewards : [])
      .filter(reward => reward?.prizeId === id && countedReward(reward)).map(reward => [reward.id, reward]));
    const next = new Map((Array.isArray(after?.rewards) ? after.rewards : [])
      .filter(reward => reward?.prizeId === id && countedReward(reward)).map(reward => [reward.id, reward]));
    let change = 0;
    for (const [rewardId, reward] of next) {
      const old = previous.get(rewardId);
      if (!reward.cancelled && (!old || old.cancelled)) change++;
      if (reward.cancelled && old && !old.cancelled) change--;
    }
    // Rolling back a purchase within the same period restores stock.
    for (const [rewardId, reward] of previous) {
      // An opened case is final even if its manager is later removed.
      if (!next.has(rewardId) && !reward.cancelled && !reward.case) change--;
    }
    changes[id] = change;
  }
  return changes;
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// The original single-team game uses id 1, so its saved progress stays with Fomenko.
const teamIds = Object.freeze({ fomenko: 1, lvovsky: 2, shabanov: 3, kozhanov: 4, otrakusha: 5, kulikov: 6, kondratyev: 7, chekhova: 8, klimentovich: 9, bagaturiya: 10, tolstov: 11 });
const teamNames = Object.freeze({ fomenko: 'Фоменко', lvovsky: 'Львовский', shabanov: 'Шабанов', kozhanov: 'Кожанов', otrakusha: 'Отрокуша', kulikov: 'Куликов', kondratyev: 'Кондратьев', chekhova: 'Чехова', klimentovich: 'Клементович', bagaturiya: 'Багатурия', tolstov: 'Толстов' });
const PLAYER_COLORS = Object.freeze(['#286653','#cf744d','#6976b3','#af5980','#a19036','#448e9e','#795c9b','#6f8746']);
const ROSTER_MIGRATION = '2026-09-20-department-rosters-v1';

function blankPlayer(name, index) {
  return { id: randomUUID(), name, salesName: TELEGRAM_NAME_OVERRIDES[name] || name, color: PLAYER_COLORS[index % PLAYER_COLORS.length], sport: 7,
    pos: 0, bank: 0, cash: 0, cashBase: 0, calls: 0, cross: 0, shields: 0, high: 0, used: [], actionCounts: {} };
}

function blankGame(catalog, rules) {
  return { version: 3, id: randomUUID(), updated: new Date().toISOString(), config: {
    period: 'Второй период', cashUnit: rules.cashUnit, callUnit: 100, crossSteps: rules.crossSteps,
    milestones: [1, 1, 1, 1, 2], shop: catalog, actions: rules.actions, challenges: rules.challenges
  }, players: [], logs: [], rewards: [], ledger: [], undo: null };
}

function applyRoster(game, teamKey, names) {
  const next = structuredClone(game), existing = Array.isArray(next.players) ? next.players : [];
  const unused = new Set(existing);
  next.players = names.map((name, index) => {
    const aliases = [...(teamKey === 'fomenko' ? (FOMENKO_ALIASES[name] || []) : []), ...(ROSTER_ALIASES[name] || [])];
    const player = existing.find(item => unused.has(item) && [name, ...aliases].some(candidate => normalizeSalesName(item.name) === normalizeSalesName(candidate)));
    if (!player) return blankPlayer(name, index);
    unused.delete(player);
    const updated = { ...player, name, salesName: TELEGRAM_NAME_OVERRIDES[name] || name, sport: 7 };
    delete updated.avatar;
    return updated;
  });
  // Preserve an unlisted participant only when removing them would destroy recorded progress or rewards.
  for (const player of unused) {
    const used = player.pos || player.high || player.bank || player.cash || player.calls || player.cross ||
      Object.values(player.actionCounts || {}).some(Boolean) || next.ledger?.some(item => item.playerId === player.id) ||
      next.rewards?.some(item => item.playerId === player.id);
    if (used) next.players.push({ ...player, sport: 7, avatar: undefined });
  }
  const now = new Date().toISOString();
  next.updated = now;
  next.undo = null;
  next.logs = Array.isArray(next.logs) ? next.logs : [];
  next.logs.unshift({ id: randomUUID(), at: now, text: `Состав команды обновлён по списку отдела: ${names.length} менеджеров, всем установлен Робот-чемпион.` });
  return next;
}

async function seedDepartmentRosters(catalog, rules) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const claimed = await client.query(
      'INSERT INTO app_migrations (id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING id',
      [ROSTER_MIGRATION]
    );
    if (!claimed.rows.length) {
      await client.query('ROLLBACK');
      return;
    }
    for (const [teamKey, names] of Object.entries(TEAM_ROSTERS)) {
      const id = teamIds[teamKey];
      const current = await client.query('SELECT data FROM game_state WHERE id = $1 FOR UPDATE', [id]);
      const game = current.rows[0]?.data ?? blankGame(catalog, rules);
      const next = applyRoster(game, teamKey, names);
      await client.query(`
        INSERT INTO game_state (id, data, updated_at) VALUES ($1, $2::jsonb, now())
        ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at
      `, [id, JSON.stringify(next)]);
      for (const player of next.players) if (player.salesName) await client.query(`
        UPDATE telegram_action_credits SET team_id = $1, player_id = $2, status = 'pending'
        WHERE status = 'unmatched' AND normalized_name = $3
      `, [id, player.id, normalizeSalesName(player.salesName)]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function correctManagerNamesAndResyncCredits() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const claimed = await client.query(
      'INSERT INTO app_migrations (id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING id',
      [MANAGER_NAME_SYNC_MIGRATION]
    );
    if (!claimed.rows.length) {
      await client.query('ROLLBACK');
      return;
    }
    for (const correction of MANAGER_NAME_SYNCS) {
      const id = teamIds[correction.team];
      const current = await client.query('SELECT data FROM game_state WHERE id = $1 FOR UPDATE', [id]);
      const game = current.rows[0]?.data;
      const acceptedNames = [correction.name, ...correction.aliases].map(normalizeSalesName);
      const player = game?.players?.find(item => acceptedNames.includes(normalizeSalesName(item.name)));
      if (!player) throw new Error(`MANAGER_NAME_SYNC_NOT_FOUND:${correction.team}:${correction.name}`);
      const previousName = player.name;
      const previousSalesName = player.salesName;
      player.name = correction.name;
      player.salesName = correction.name;
      if (previousName !== correction.name || previousSalesName !== correction.name) {
        const now = new Date().toISOString();
        game.updated = now;
        game.logs = Array.isArray(game.logs) ? game.logs : [];
        game.logs.unshift({ id: randomUUID(), at: now, text: `Исправлено имя менеджера для синхронизации продаж: ${previousSalesName || previousName} → ${correction.name}.` });
      }
      await client.query('UPDATE game_state SET data = $2::jsonb, updated_at = now() WHERE id = $1', [id, JSON.stringify(game)]);
      const normalizedAliases = [correction.name, ...correction.aliases].map(normalizeSalesName);
      await client.query(`
        UPDATE telegram_action_credits
        SET team_id = $1, player_id = $2, status = 'pending'
        WHERE status = 'unmatched'
          AND action_kind IN ('cashLow','cashMid','cashHigh','cross')
          AND normalized_name = ANY($3::text[])
          AND created_at >= (((now() AT TIME ZONE 'Europe/Moscow')::date - 1)::timestamp AT TIME ZONE 'Europe/Moscow')
      `, [id, player.id, normalizedAliases]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function grantFomenkoActionCredits() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const claimed = await client.query(
      'INSERT INTO app_migrations (id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING id',
      [FOMENKO_ACTION_CREDIT_GRANT_MIGRATION]
    );
    if (!claimed.rows.length) {
      await client.query('ROLLBACK');
      return;
    }
    const current = await client.query('SELECT data FROM game_state WHERE id = $1 FOR UPDATE', [teamIds.fomenko]);
    const player = current.rows[0]?.data?.players?.find(item => normalizeSalesName(item.name) === normalizeSalesName('Александр Фоменко'));
    // This was a one-off manual grant. A manager may already have been removed
    // when a fresh service instance reruns startup migrations; that must not
    // make every game-state endpoint unavailable.
    if (!player) {
      await client.query('COMMIT');
      return;
    }
    const kinds = [
      ['cashLow', 49999],
      ['cashMid', 50000],
      ['cashHigh', 100000],
      ['cross', 1]
    ];
    let messageId = 1;
    for (const [kind, amount] of kinds) for (let copy = 0; copy < 2; copy++) {
      await client.query(`
        INSERT INTO telegram_action_credits
          (chat_id, message_id, source_bot_id, manager_name, normalized_name, action_kind, amount, team_id, player_id, status, raw_text)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',$10)
      `, [`manual:${FOMENKO_ACTION_CREDIT_GRANT_MIGRATION}`, messageId++, 'manual-admin', player.name,
        normalizeSalesName(player.name), kind, amount, teamIds.fomenko, player.id,
        'Ручное начисление руководителем: две возможности для каждой кнопки оплаты и кросс-сейла.']);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function grantActivityCredits() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const games = await client.query('SELECT id, data FROM game_state WHERE id = ANY($1::int[]) FOR UPDATE', [Object.values(teamIds)]);
    const gamesById = new Map(games.rows.map(row => [Number(row.id), row.data]));
    const grants = [];
    for (const [teamKey, names] of Object.entries(ACTIVITY_CREDIT_GRANTS)) {
      const id = teamIds[teamKey];
      const players = gamesById.get(id)?.players || [];
      for (const name of names) {
        const player = players.find(item => normalizeSalesName(item.name) === normalizeSalesName(name));
        if (!player) throw new Error(`ACTIVITY_PLAYER_NOT_FOUND:${teamKey}:${name}`);
        grants.push({ teamId: id, player });
      }
    }
    const claimed = await client.query(
      'INSERT INTO app_migrations (id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING id',
      [ACTIVITY_CREDIT_GRANT_MIGRATION]
    );
    if (!claimed.rows.length) {
      await client.query('ROLLBACK');
      return;
    }
    let messageId = 1;
    for (const { teamId: id, player } of grants) await client.query(`
      INSERT INTO telegram_action_credits
        (chat_id, message_id, source_bot_id, manager_name, normalized_name, action_kind, amount, team_id, player_id, status, raw_text)
      VALUES ($1,$2,$3,$4,$5,'activity',70,$6,$7,'pending',$8)
    `, [`manual:${ACTIVITY_CREDIT_GRANT_MIGRATION}`, messageId++, 'manual-dashboard', player.name,
      normalizeSalesName(player.name), id, player.id,
      'Активность 70%+ за 21.09.2026 подтверждена по дашборду Simba.']);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function correctZinkevichPaymentCredit() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const claimed = await client.query(
      'INSERT INTO app_migrations (id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING id',
      [ZINKEVICH_PAYMENT_CREDIT_CORRECTION]
    );
    if (!claimed.rows.length) {
      await client.query('ROLLBACK');
      return;
    }
    const current = await client.query('SELECT data FROM game_state WHERE id = $1 FOR UPDATE', [teamIds.klimentovich]);
    const player = current.rows[0]?.data?.players?.find(item => normalizeSalesName(item.name) === normalizeSalesName('Зинкевич Елизавета'));
    if (player) await client.query(`
      UPDATE telegram_action_credits
      SET action_kind = 'cashMid', amount = 50000,
          raw_text = raw_text || ' Исправлено руководителем: оплата перенесена из 100 000+ в диапазон 50 000–99 999.'
      WHERE id = (
        SELECT id FROM telegram_action_credits
        WHERE team_id = $1 AND player_id = $2 AND action_kind = 'cashHigh' AND status = 'pending'
        ORDER BY created_at, id LIMIT 1
      )
    `, [teamIds.klimentovich, player.id]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
function teamId(req, res) {
  const key = req.query.team ?? 'fomenko';
  if (typeof key !== 'string' || !Object.hasOwn(teamIds, key)) {
    res.status(400).json({ error: 'Неизвестная команда.' });
    return null;
  }
  return teamIds[key];
}

function telegramConfigured() {
  return Boolean(process.env.TELEGRAM_WEBHOOK_SECRET && process.env.TELEGRAM_CHAT_ID && process.env.TELEGRAM_SOURCE_BOT_ID);
}

function salesActionDeltas(before, after) {
  const keys = [['cashLow', 'payment-low'], ['cashMid', 'payment-mid'], ['cashHigh', 'payment-high']];
  const changes = [];
  for (const player of after?.players || []) {
    const old = before?.players?.find(item => item.id === player.id);
    if (!old) continue;
    for (const [kind, key] of keys) for (let count = 0; count < (player.actionCounts?.[key] || 0) - (old.actionCounts?.[key] || 0); count++) changes.push({ kind, playerId: player.id });
    for (const key of Object.keys(player.actionCounts || {})) if (/^activity-\d{4}-\d{2}-\d{2}$/.test(key) && !Object.hasOwn(old.actionCounts || {}, key)) changes.push({ kind: 'activity', playerId: player.id });
    for (let count = 0; count < player.cross - old.cross; count++) changes.push({ kind: 'cross', playerId: player.id });
  }
  return changes;
}

let tableReady;
function ensureTable() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL_MISSING');
  }
  if (!tableReady) {
    tableReady = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS game_state (
          id integer PRIMARY KEY,
          data jsonb NOT NULL DEFAULT '{}'::jsonb,
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS super_prize_inventory (
          prize_id text PRIMARY KEY,
          purchased integer NOT NULL DEFAULT 0 CHECK (purchased >= 0),
          limit_count integer NOT NULL DEFAULT 5 CHECK (limit_count > 0)
        )
      `);
      await pool.query('ALTER TABLE super_prize_inventory ADD COLUMN IF NOT EXISTS limit_count integer NOT NULL DEFAULT 5');
      await pool.query(`
        CREATE TABLE IF NOT EXISTS case_rounds (
          team_id integer NOT NULL,
          request_id text NOT NULL,
          player_id text NOT NULL,
          data jsonb NOT NULL,
          resolved jsonb,
          created_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (team_id, request_id)
        )
      `);
      await pool.query(`CREATE TABLE IF NOT EXISTS department_shop (id integer PRIMARY KEY CHECK (id = 1), data jsonb NOT NULL)`);
      await pool.query(`CREATE TABLE IF NOT EXISTS department_rules (id integer PRIMARY KEY CHECK (id = 1), data jsonb NOT NULL)`);
      await pool.query(`CREATE TABLE IF NOT EXISTS app_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS telegram_action_credits (
          id bigserial PRIMARY KEY,
          chat_id text NOT NULL,
          message_id bigint NOT NULL,
          source_bot_id text NOT NULL,
          manager_name text NOT NULL,
          normalized_name text NOT NULL,
          action_kind text NOT NULL CHECK (action_kind IN ('cashLow','cashMid','cashHigh','cross','activity')),
          amount bigint NOT NULL CHECK (amount > 0),
          team_id integer,
          player_id text,
          status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','unmatched','consumed')),
          raw_text text NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          consumed_at timestamptz,
          UNIQUE (chat_id, message_id)
        )
      `);
      await pool.query(`
        DO $$ BEGIN
          IF EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conrelid = 'telegram_action_credits'::regclass
              AND conname = 'telegram_action_credits_action_kind_check'
              AND pg_get_constraintdef(oid) NOT LIKE '%activity%'
          ) THEN
            ALTER TABLE telegram_action_credits DROP CONSTRAINT telegram_action_credits_action_kind_check;
            ALTER TABLE telegram_action_credits ADD CONSTRAINT telegram_action_credits_action_kind_check
              CHECK (action_kind IN ('cashLow','cashMid','cashHigh','cross','activity'));
          END IF;
        END $$
      `);
      await pool.query(`
        WITH claimed AS (
          INSERT INTO app_migrations (id) VALUES ($1)
          ON CONFLICT DO NOTHING RETURNING id
        )
        UPDATE telegram_action_credits
        SET status = 'consumed', consumed_at = now()
        WHERE status = 'pending'
          AND action_kind IN ('cashLow','cashMid','cashHigh','cross')
          AND EXISTS (SELECT 1 FROM claimed)
      `, [ACTION_CREDIT_RESET_MIGRATION]);
      let rulesResult = await pool.query('SELECT data FROM department_rules WHERE id = 1');
      if (!rulesResult.rows.length) {
        const fomenkoRules = await pool.query('SELECT data->\'config\' AS config FROM game_state WHERE id = 1');
        const initialRules = sharedRules(fomenkoRules.rows[0]?.config ?? DEFAULT_RULES);
        if (!validRules(initialRules)) throw new Error('INVALID_FOMENKO_RULES');
        await pool.query('INSERT INTO department_rules (id, data) VALUES (1, $1::jsonb) ON CONFLICT DO NOTHING', [JSON.stringify(initialRules)]);
        rulesResult = await pool.query('SELECT data FROM department_rules WHERE id = 1');
      }
      if (!validRules(rulesResult.rows[0]?.data)) throw new Error('INVALID_DEPARTMENT_RULES');
      const currentRules = rulesResult.rows[0].data;
      const oldChallengeText = 'Превысить свой лучший дневной результат по кассе. Предложение — согласуйте критерий до старта.';
      const defaultChallenge = currentRules.challenges.find(item => item.id === 'challenge-1');
      let rulesChanged = false;
      if (defaultChallenge?.description === oldChallengeText) {
        defaultChallenge.description = 'Превысить свой лучший дневной результат по количеству оплат. Предложение — согласуйте критерий до старта.';
        rulesChanged = true;
      }
      if (!currentRules.challenges.some(item => item.id === 'challenge-power-calls')) {
        currentRules.challenges.push({ id: 'challenge-power-calls', name: 'Мини-челлендж: мощный дожим', description: 'Провести три звонка с мощным дожимом. Можно выполнить один раз в день.', medals: 2, enabled: true });
        rulesChanged = true;
      }
      const powerCalls = currentRules.challenges.find(item => item.id === 'challenge-power-calls');
      if (powerCalls?.description === 'Провести три звонка с мощным дожимом. Руководитель может подтверждать выполнение без ограничений.') {
        powerCalls.description = 'Провести три звонка с мощным дожимом. Можно выполнить один раз в день.';
        rulesChanged = true;
      }
      if (rulesChanged) await pool.query('UPDATE department_rules SET data = $1::jsonb WHERE id = 1', [JSON.stringify(currentRules)]);
      const existingShop = await pool.query(`SELECT data #> '{config,shop}' AS shop FROM game_state WHERE jsonb_typeof(data #> '{config,shop}') = 'array' ORDER BY id LIMIT 1`);
      await pool.query('INSERT INTO department_shop (id, data) VALUES (1, $1::jsonb) ON CONFLICT DO NOTHING', [JSON.stringify(completeShop(existingShop.rows[0]?.shop))]);
      await updateInitialSuperPrizeLimits();
      const catalogResult = await pool.query('SELECT data FROM department_shop WHERE id = 1');
      const catalog = completeShop(catalogResult.rows[0].data);
      if (!validShop(catalog)) throw new Error('INVALID_SHOP_CATALOG');
      await pool.query('UPDATE department_shop SET data = $1::jsonb WHERE id = 1', [JSON.stringify(catalog)]);
      await seedDepartmentRosters(catalog, currentRules);
      await correctManagerNamesAndResyncCredits();
      await grantFomenkoActionCredits();
      await grantActivityCredits();
      await correctZinkevichPaymentCredit();
      for (const item of catalog.filter(item => item.superPrize)) {
        const id = item.id;
        await pool.query(`
          INSERT INTO super_prize_inventory (prize_id, purchased, limit_count)
          SELECT $1, COUNT(*)::integer, $2
          FROM game_state
          CROSS JOIN LATERAL jsonb_array_elements(
            CASE WHEN jsonb_typeof(data->'rewards') = 'array' THEN data->'rewards' ELSE '[]'::jsonb END
          ) AS reward(item)
          WHERE reward.item->>'prizeId' = $1 AND reward.item->>'cancelled' IS DISTINCT FROM 'true'
            AND (reward.item->>'superPrize' = 'true' OR ($3::boolean AND reward.item->>'superPrize' IS NULL))
          ON CONFLICT (prize_id) DO UPDATE
          SET purchased = GREATEST(super_prize_inventory.purchased, EXCLUDED.purchased),
              limit_count = EXCLUDED.limit_count
        `, [id, item.stockLimit, Object.hasOwn(INITIAL_SUPER_PRIZE_LIMITS, id)]);
      }
      await pool.query(`
        WITH applied AS (
          INSERT INTO app_migrations (id) VALUES ($1)
          ON CONFLICT DO NOTHING
          RETURNING id
        )
        UPDATE super_prize_inventory
        SET purchased = 0
        WHERE prize_id = 'prize-8' AND EXISTS (SELECT 1 FROM applied)
      `, [CERTIFICATE_DEMO_STOCK_MIGRATION]);
      for (const prize of NEW_SHOP_PRIZES) {
        await pool.query(`
          UPDATE game_state
          SET data = jsonb_set(data, '{config,shop}', (data #> '{config,shop}') || $1::jsonb),
              updated_at = now()
          WHERE jsonb_typeof(data #> '{config,shop}') = 'array'
            AND NOT EXISTS (
              SELECT 1 FROM jsonb_array_elements(data #> '{config,shop}') AS item
              WHERE item->>'id' = $2
            )
        `, [JSON.stringify([prize]), prize.id]);
      }
    })().catch(error => {
      tableReady = null;
      throw error;
    });
  }
  return tableReady;
}

function databaseError(res, error) {
  console.error('Game state database error:', error);
  const errorCode = typeof error.code === 'string' && /^[A-Z0-9_]{2,40}$/.test(error.code)
    ? error.code : 'UNKNOWN';
  const messages = {
    '28P01': 'Neon отклонил пароль в DATABASE_URL.',
    '3D000': 'База данных из DATABASE_URL не найдена.',
    '42501': 'У пользователя Neon нет прав на таблицу или её создание.',
    '42703': 'Структура существующей таблицы game_state не соответствует игре.',
    '42P01': 'Таблица game_state не найдена после подготовки.',
    'ENOTFOUND': 'Адрес Neon из DATABASE_URL не найден.',
    'EAI_AGAIN': 'Не удалось разрешить адрес Neon. Повторите попытку.',
    'ETIMEDOUT': 'Превышено время ожидания соединения с Neon.',
    'ECONNREFUSED': 'Neon отклонил сетевое соединение.'
  };
  const message = error.message === 'DATABASE_URL_MISSING'
    ? 'На сервере Render не задана переменная DATABASE_URL.'
    : messages[errorCode] || 'Не удалось подключиться к Neon или подготовить таблицу игры.';
  res.status(503).json({
    error: `${message} Код: ${errorCode}. Проверьте журнал Render.`
  });
}

// Получить состояние игры
app.get('/api/game-state', async (req, res) => {
  const id = teamId(req, res);
  if (id === null) return;
  try {
    await ensureTable();
    const [result, catalog, rules] = await Promise.all([
      pool.query('SELECT data FROM game_state WHERE id = $1', [id]),
      pool.query('SELECT data FROM department_shop WHERE id = 1'),
      pool.query('SELECT data FROM department_rules WHERE id = 1')
    ]);
    const data = withDepartmentConfig(result.rows[0]?.data ?? {}, catalog.rows[0].data, rules.rows[0].data);
    res.setHeader('ETag', stateETag(data));
    res.json(data);
  } catch (err) {
    databaseError(res, err);
  }
});

app.get('/api/prize-stock', async (_req, res) => {
  try {
    await ensureTable();
    const [result, catalog] = await Promise.all([
      pool.query('SELECT prize_id, purchased, limit_count FROM super_prize_inventory'),
      pool.query('SELECT data FROM department_shop WHERE id = 1')
    ]);
    const shop = catalog.rows[0].data;
    const purchased = Object.fromEntries(result.rows.map(row => [row.prize_id, Number(row.purchased)]));
    const limits = Object.fromEntries(shop.filter(item => item.superPrize).map(item => [item.id, item.stockLimit]));
    const remaining = Object.fromEntries(Object.entries(limits)
      .map(([id, limit]) => [id, Math.max(0, limit - (purchased[id] || 0))]));
    res.json({ remaining, limits, shop });
  } catch (error) {
    databaseError(res, error);
  }
});

app.post('/api/telegram/webhook', async (req, res) => {
  if (!telegramConfigured()) return res.status(503).json({ error: 'Интеграция Telegram ещё не настроена.' });
  const suppliedSecret = req.get('x-telegram-bot-api-secret-token') || '';
  if (!equalSecret(suppliedSecret, process.env.TELEGRAM_WEBHOOK_SECRET)) return res.status(403).json({ error: 'Неверный секрет webhook.' });
  const message = req.body?.message ?? req.body?.channel_post;
  if (!message || String(message.chat?.id) !== String(process.env.TELEGRAM_CHAT_ID) ||
      String(message.from?.id) !== String(process.env.TELEGRAM_SOURCE_BOT_ID) || message.from?.is_bot !== true) return res.json({ ok: true });
  const rawText = message.text ?? message.caption;
  const parsed = parseSalesNotification(rawText);
  if (!parsed) return res.json({ ok: true, recognized: false });
  try {
    await ensureTable();
    const games = await pool.query('SELECT id, data FROM game_state WHERE id = ANY($1::int[])', [Object.values(teamIds)]);
    const matches = [];
    for (const row of games.rows) for (const player of Array.isArray(row.data?.players) ? row.data.players : []) {
      if (player.salesName && normalizeSalesName(player.salesName) === parsed.normalizedName) matches.push({ teamId: Number(row.id), playerId: player.id });
    }
    const match = matches.length === 1 ? matches[0] : null;
    await pool.query(`
      INSERT INTO telegram_action_credits
        (chat_id, message_id, source_bot_id, manager_name, normalized_name, action_kind, amount, team_id, player_id, status, raw_text)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      ON CONFLICT (chat_id, message_id) DO NOTHING
    `, [String(message.chat.id), message.message_id, String(message.from.id), parsed.managerName, parsed.normalizedName,
      parsed.kind, parsed.amount, match?.teamId ?? null, match?.playerId ?? null, match ? 'pending' : 'unmatched', rawText]);
    res.json({ ok: true, recognized: true, matched: Boolean(match) });
  } catch (error) {
    databaseError(res, error);
  }
});

app.get('/api/action-credits', async (req, res) => {
  const id = teamId(req, res);
  if (id === null) return;
  try {
    await ensureTable();
    const result = await pool.query(`
      SELECT player_id, action_kind, COUNT(*)::integer AS count
      FROM telegram_action_credits
      WHERE team_id = $1 AND status = 'pending'
      GROUP BY player_id, action_kind
    `, [id]);
    const credits = {};
    for (const row of result.rows) {
      credits[row.player_id] ??= {};
      credits[row.player_id][row.action_kind] = Number(row.count);
    }
    res.setHeader('Cache-Control', 'no-store');
    res.json({ configured: telegramConfigured(), credits });
  } catch (error) {
    databaseError(res, error);
  }
});

app.post('/api/admin/player-adjustments', async (req, res) => {
  const id = teamId(req, res);
  if (id === null) return;
  if (!sameOrigin(req)) return res.status(403).json({ error: 'Недопустимый источник запроса.' });
  if (!isAdmin(req)) return res.status(403).json({ error: 'Корректировать шаги и активность может только руководитель группы.' });
  const adjustments = req.body?.adjustments;
  if (!Array.isArray(adjustments) || adjustments.length > 40 || adjustments.some(item =>
      !item || typeof item.playerId !== 'string' || item.playerId.length < 1 || item.playerId.length > 100 ||
      !Number.isFinite(item.bank) || item.bank < 0 || item.bank > 100000000 || !Number.isSafeInteger(item.bank * 2) ||
      !Number.isSafeInteger(item.activityCredits) || item.activityCredits < 0 || item.activityCredits > 1000) ||
      new Set(adjustments.map(item => item.playerId)).size !== adjustments.length) {
    return res.status(422).json({ error: 'Проверьте шаги и количество доступных подтверждений активности.' });
  }
  let client;
  try {
    await ensureTable();
    client = await pool.connect();
    await client.query('BEGIN');
    const [catalogResult, rulesResult, current] = await Promise.all([
      client.query('SELECT data FROM department_shop WHERE id = 1'),
      client.query('SELECT data FROM department_rules WHERE id = 1'),
      client.query('SELECT data FROM game_state WHERE id = $1 FOR UPDATE', [id])
    ]);
    const raw = current.rows[0]?.data;
    if (!raw || !Array.isArray(raw.players)) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Сначала создайте и сохраните команду.' });
    }
    const before = withDepartmentConfig(raw, catalogResult.rows[0].data, rulesResult.rows[0].data);
    if (req.get('if-match') !== stateETag(before)) {
      await client.query('ROLLBACK');
      return res.status(412).json({ error: 'Данные команды изменились в другой вкладке. Обновите страницу.' });
    }
    const players = new Map(raw.players.map(player => [player.id, player]));
    if (adjustments.length !== players.size || adjustments.some(item => !players.has(item.playerId))) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Состав команды изменился. Обновите страницу и повторите.' });
    }
    const changes = [];
    for (const adjustment of adjustments) {
      const player = players.get(adjustment.playerId);
      const credits = await client.query(`
        SELECT id FROM telegram_action_credits
        WHERE team_id = $1 AND player_id = $2 AND action_kind = 'activity' AND status = 'pending'
        ORDER BY created_at, id FOR UPDATE
      `, [id, player.id]);
      const oldBank = Number(player.bank);
      const oldActivityCredits = credits.rows.length;
      if (oldBank === adjustment.bank && oldActivityCredits === adjustment.activityCredits) continue;
      player.bank = adjustment.bank;
      if (adjustment.activityCredits < oldActivityCredits) {
        const surplus = credits.rows.slice(adjustment.activityCredits).map(row => row.id);
        await client.query(`
          UPDATE telegram_action_credits
          SET status = 'consumed', consumed_at = now(),
              raw_text = raw_text || ' Снято ручной корректировкой руководителя.'
          WHERE id = ANY($1::bigint[])
        `, [surplus]);
      } else {
        for (let index = oldActivityCredits; index < adjustment.activityCredits; index++) {
          await client.query(`
            INSERT INTO telegram_action_credits
              (chat_id, message_id, source_bot_id, manager_name, normalized_name, action_kind, amount, team_id, player_id, status, raw_text)
            VALUES ($1,1,'admin',$2,$3,'activity',70,$4,$5,'pending',$6)
          `, [`admin-activity-${randomUUID()}`, player.name, normalizeSalesName(player.salesName || player.name), id, player.id,
            `Ручная корректировка руководителя: доступно за активность ${adjustment.activityCredits}.`]);
        }
      }
      changes.push(`${player.name}: шаги ${String(oldBank).replace('.', ',')} → ${String(adjustment.bank).replace('.', ',')}, активность ${oldActivityCredits} → ${adjustment.activityCredits}`);
    }
    if (changes.length) {
      const now = new Date().toISOString();
      raw.updated = now;
      raw.logs.unshift({ id: randomUUID(), at: now, text: `Ручная корректировка руководителя. ${changes.join('; ')}` });
      await client.query('UPDATE game_state SET data = $2::jsonb, updated_at = now() WHERE id = $1', [id, JSON.stringify(raw)]);
    }
    const activityRows = await client.query(`
      SELECT player_id, COUNT(*)::integer AS count
      FROM telegram_action_credits
      WHERE team_id = $1 AND action_kind = 'activity' AND status = 'pending'
      GROUP BY player_id
    `, [id]);
    await client.query('COMMIT');
    const next = withDepartmentConfig(raw, catalogResult.rows[0].data, rulesResult.rows[0].data);
    res.setHeader('ETag', stateETag(next));
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true, state: next, activityCredits: Object.fromEntries(activityRows.rows.map(row => [row.player_id, Number(row.count)])) });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    databaseError(res, error);
  } finally {
    client?.release();
  }
});

app.get('/api/department-rules', async (_req, res) => {
  try {
    await ensureTable();
    const [result, games] = await Promise.all([
      pool.query('SELECT data FROM department_rules WHERE id = 1'),
      pool.query('SELECT data FROM game_state WHERE id = ANY($1::int[])', [Object.values(teamIds)])
    ]);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ rules: result.rows[0].data, usage: ruleUsage(games.rows.map(row => row.data)) });
  } catch (error) {
    databaseError(res, error);
  }
});

app.get('/api/case-catalog', async (_req, res) => {
  try {
    await ensureTable();
    const [catalog, inventory] = await Promise.all([
      pool.query('SELECT data FROM department_shop WHERE id = 1'),
      pool.query('SELECT prize_id, purchased, limit_count FROM super_prize_inventory')
    ]);
    const items = casePool(catalog.rows[0].data, inventory.rows);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ cost: CASE_COST, superChestChance: SUPER_CHEST_CHANCE * 100, miniPrizes: MINI_PRIZES,
      items: items.map(({ id, name, cost, superPrize, remaining }) =>
        ({ id, name, cost, superPrize, remaining })) });
  } catch (error) {
    databaseError(res, error);
  }
});

app.post('/api/open-case', async (req, res) => {
  const id = teamId(req, res);
  if (id === null) return;
  if (!sameOrigin(req)) return res.status(403).json({ error: 'Недопустимый источник запроса.' });
  const { playerId, requestId } = req.body || {};
  if (typeof playerId !== 'string' || !/^case-[a-f0-9-]{36}$/.test(requestId || '')) {
    return res.status(422).json({ error: 'Проверьте участника и номер открытия кейса.' });
  }
  let client;
  try {
    await ensureTable();
    client = await pool.connect();
    await client.query('BEGIN');
    const catalog = (await client.query('SELECT data FROM department_shop WHERE id = 1 FOR UPDATE')).rows[0].data;
    const rules = (await client.query('SELECT data FROM department_rules WHERE id = 1 FOR UPDATE')).rows[0].data;
    const current = await client.query('SELECT data FROM game_state WHERE id = $1 FOR UPDATE', [id]);
    const before = withDepartmentConfig(current.rows[0]?.data ?? {}, catalog, rules);
    const existing = before.rewards?.find(reward => reward.id === requestId && reward.playerId === playerId && reward.case === true);
    if (existing) {
      await client.query('COMMIT');
      res.setHeader('ETag', stateETag(before));
      return res.json({ state: before, phase: 'reward', reward: existing });
    }
    const previousRound = await client.query('SELECT player_id, resolved FROM case_rounds WHERE team_id = $1 AND request_id = $2 FOR UPDATE', [id, requestId]);
    if (previousRound.rows.length) {
      await client.query('COMMIT');
      res.setHeader('ETag', stateETag(before));
      const round = previousRound.rows[0];
      return res.json(round.resolved
        ? { state: before, phase: 'reward', reward: round.resolved.reward }
        : { state: before, phase: 'chests', roundId: requestId });
    }
    if (before.pendingCase) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Сначала выберите шкатулку в предыдущем кейсе.' });
    }
    if (!current.rows.length || req.get('if-match') !== stateETag(before)) {
      await client.query('ROLLBACK');
      return res.status(412).json({ error: 'Прогресс изменился. Обновите страницу перед открытием кейса.' });
    }
    const player = before.players?.find(entry => entry.id === playerId);
    const balance = before.ledger?.filter(entry => entry.playerId === playerId).reduce((sum, entry) => sum + entry.amount, 0);
    if (!player || !Number.isSafeInteger(balance) || balance < CASE_COST) {
      await client.query('ROLLBACK');
      return res.status(422).json({ error: 'Недостаточно монеток для открытия кейса.' });
    }
    const inventory = (await client.query('SELECT prize_id, purchased, limit_count FROM super_prize_inventory FOR UPDATE')).rows;
    const items = casePool(catalog, inventory);
    const total = items.reduce((sum, item) => sum + item.weight, 0);
    if (!total) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'В кейсе пока нет доступных наград.' });
    }
    const outcome = drawCaseOutcome(items);
    const prize = outcome.prize;
    if (outcome.phase === 'chests') {
      const updated = await client.query('UPDATE super_prize_inventory SET purchased = purchased + 1 WHERE prize_id = $1 AND purchased < limit_count RETURNING purchased', [prize.id]);
      if (!updated.rows.length) throw new Error('CASE_STOCK_CHANGED');
    }
    const next = structuredClone(before);
    const at = new Date().toISOString();
    let reward = null;
    if (outcome.phase === 'chests') {
      const round = createChestRound(prize, items.filter(item => !item.superPrize));
      await client.query('INSERT INTO case_rounds (team_id, request_id, player_id, data) VALUES ($1, $2, $3, $4::jsonb)',
        [id, requestId, playerId, JSON.stringify(round)]);
      next.pendingCase = { requestId, playerId, at };
    } else {
      reward = { id: requestId, playerId, prizeId: prize.id, title: prize.name, cost: CASE_COST,
        source: 'shop', superPrize: false, miniPrize: Boolean(outcome.souvenir), souvenir: Boolean(outcome.souvenir),
        case: true, claimed: false, cancelled: false, at };
      next.rewards.push(reward);
    }
    next.ledger.push({ id: randomUUID(), playerId, amount: -CASE_COST, source: 'purchase', ref: requestId,
      title: outcome.phase === 'chests' ? 'Кейс: выбор шкатулки' : `Кейс: ${prize.name}`, at });
    next.logs.unshift({ id: randomUUID(), at, text: outcome.phase === 'chests'
      ? `${player.name}: открыл(а) кейс за ${CASE_COST} мон. и выбирает шкатулку.`
      : `${player.name}: открыл(а) кейс за ${CASE_COST} мон. и получил(а) «${prize.name}».` });
    next.updated = at;
    next.undo = null;
    await client.query('UPDATE game_state SET data = $2::jsonb, updated_at = now() WHERE id = $1', [id, JSON.stringify(next)]);
    await client.query('COMMIT');
    res.setHeader('ETag', stateETag(next));
    res.json(outcome.phase === 'chests'
      ? { state: next, phase: 'chests', roundId: requestId }
      : { state: next, phase: 'reward', reward });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    databaseError(res, error);
  } finally {
    client?.release();
  }
});

app.post('/api/choose-chest', async (req, res) => {
  const id = teamId(req, res);
  if (id === null) return;
  if (!sameOrigin(req)) return res.status(403).json({ error: 'Недопустимый источник запроса.' });
  const { requestId, chest } = req.body || {};
  if (typeof requestId !== 'string' || !/^case-[a-f0-9-]{36}$/.test(requestId) || !Number.isSafeInteger(chest) || chest < 0 || chest > 2) {
    return res.status(422).json({ error: 'Выберите одну из трёх шкатулок.' });
  }
  let client;
  try {
    await ensureTable();
    client = await pool.connect();
    await client.query('BEGIN');
    const catalog = (await client.query('SELECT data FROM department_shop WHERE id = 1 FOR UPDATE')).rows[0].data;
    const rules = (await client.query('SELECT data FROM department_rules WHERE id = 1 FOR UPDATE')).rows[0].data;
    const current = await client.query('SELECT data FROM game_state WHERE id = $1 FOR UPDATE', [id]);
    const before = withDepartmentConfig(current.rows[0]?.data ?? {}, catalog, rules);
    const result = await client.query('SELECT player_id, data, resolved FROM case_rounds WHERE team_id = $1 AND request_id = $2 FOR UPDATE', [id, requestId]);
    if (!result.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Раунд со шкатулками не найден.' });
    }
    const saved = result.rows[0];
    if (saved.resolved) {
      await client.query('COMMIT');
      res.setHeader('ETag', stateETag(before));
      return res.json({ state: before, ...saved.resolved });
    }
    if (before.pendingCase?.requestId !== requestId || before.pendingCase.playerId !== saved.player_id) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Состояние кейса изменилось. Обновите страницу.' });
    }
    const player = before.players.find(item => item.id === saved.player_id);
    if (!player) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Участник кейса не найден.' });
    }
    const round = saved.data;
    const legacyChest = index => index === round.position
      ? { type: 'super', prize: round.prize }
      : { type: 'souvenir', prize: round.miniPrizes[index < round.position ? index : index - 1] };
    const chestResult = Array.isArray(round.chests) ? round.chests[chest] : legacyChest(chest);
    const superPrize = chestResult.type === 'super';
    if (!superPrize) {
      await client.query('UPDATE super_prize_inventory SET purchased = GREATEST(0, purchased - 1) WHERE prize_id = $1', [round.prize.id]);
    }
    const prize = chestResult.prize;
    const souvenir = chestResult.type === 'souvenir';
    const reward = { id: requestId, playerId: saved.player_id, prizeId: prize.id, title: prize.name, cost: CASE_COST,
      source: 'shop', superPrize, miniPrize: souvenir, souvenir, case: true, claimed: false, cancelled: false, at: before.pendingCase.at };
    const reveal = [0, 1, 2].map(index => {
      const result = Array.isArray(round.chests) ? round.chests[index] : legacyChest(index);
      return { title: result.prize.name, type: result.type, superPrize: result.type === 'super' };
    });
    const next = structuredClone(before);
    delete next.pendingCase;
    next.rewards.push(reward);
    const purchase = next.ledger.find(entry => entry.source === 'purchase' && entry.ref === requestId);
    if (purchase) purchase.title = `Кейс: ${reward.title}`;
    const at = new Date().toISOString();
    next.logs.unshift({ id: randomUUID(), at,
      text: `${player.name}: выбрал(а) шкатулку №${chest + 1} и получил(а) «${reward.title}»${superPrize ? ' · СУПЕР-ПРИЗ!' : souvenir ? ' · сувенир' : ' · награда за спортивные заслуги'}.` });
    next.updated = at;
    next.undo = null;
    const resolution = { reward, reveal, selectedChest: chest };
    await client.query('UPDATE game_state SET data = $2::jsonb, updated_at = now() WHERE id = $1', [id, JSON.stringify(next)]);
    await client.query('UPDATE case_rounds SET resolved = $3::jsonb WHERE team_id = $1 AND request_id = $2', [id, requestId, JSON.stringify(resolution)]);
    await client.query('COMMIT');
    res.setHeader('ETag', stateETag(next));
    res.json({ state: next, ...resolution });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    databaseError(res, error);
  } finally {
    client?.release();
  }
});

// Recent reward purchases across the whole department, for the public game feed.
app.get('/api/reward-feed', async (_req, res) => {
  try {
    await ensureTable();
    const result = await pool.query('SELECT id, data FROM game_state WHERE id = ANY($1::int[])', [Object.values(teamIds)]);
    const teamsById = Object.fromEntries(Object.entries(teamIds).map(([key, id]) => [id, teamNames[key]]));
    const entries = result.rows.flatMap(({ id, data }) => {
      const players = new Map((Array.isArray(data?.players) ? data.players : []).map(player => [player.id, player.name]));
      return (Array.isArray(data?.rewards) ? data.rewards : [])
        .filter(reward => reward?.source === 'shop' && !reward.cancelled && typeof reward.at === 'string')
        .map(reward => ({
          id: `${id}:${reward.id}`,
          team: teamsById[id],
          player: players.get(reward.playerId) || 'Участник',
          title: reward.title,
          cost: reward.cost,
          case: reward.case === true,
          superPrize: countedReward(reward),
          miniPrize: reward.miniPrize === true,
          souvenir: reward.souvenir === true,
          at: reward.at
        }));
    }).filter(entry => typeof entry.title === 'string' && Number.isSafeInteger(entry.cost) && Number.isFinite(Date.parse(entry.at)))
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 150);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ entries });
  } catch (error) {
    databaseError(res, error);
  }
});

// Resolved chest rounds for operational statistics. The game UI does not use this feed,
// but it lets the administrator distinguish direct rewards from chest selections.
app.get('/api/chest-feed', async (_req, res) => {
  try {
    await ensureTable();
    const [roundResult, gameResult] = await Promise.all([
      pool.query(`
        SELECT team_id, request_id, player_id, resolved, created_at
        FROM case_rounds
        WHERE resolved IS NOT NULL
        ORDER BY created_at DESC
        LIMIT 1000
      `),
      pool.query('SELECT id, data FROM game_state WHERE id = ANY($1::int[])', [Object.values(teamIds)])
    ]);
    const teamsById = Object.fromEntries(Object.entries(teamIds).map(([key, id]) => [id, teamNames[key]]));
    const playersByTeam = new Map(gameResult.rows.map(({ id, data }) => [id,
      new Map((Array.isArray(data?.players) ? data.players : []).map(player => [player.id, player.name]))]));
    const rounds = roundResult.rows.map(row => {
      const selectedChest = row.resolved?.selectedChest;
      const reveal = Array.isArray(row.resolved?.reveal) ? row.resolved.reveal : [];
      if (!Number.isSafeInteger(selectedChest) || selectedChest < 0 || selectedChest > 2 || reveal.length !== 3) return null;
      const chests = reveal.map((item, index) => ({
        number: index + 1,
        type: item?.type,
        title: item?.title,
        selected: index === selectedChest
      }));
      if (chests.some(item => !['super', 'souvenir', 'ordinary'].includes(item.type) || typeof item.title !== 'string')) return null;
      return {
        id: `${row.team_id}:${row.request_id}`,
        team: teamsById[row.team_id] || 'Команда',
        player: playersByTeam.get(row.team_id)?.get(row.player_id) || 'Участник',
        at: row.resolved?.reward?.at || row.created_at,
        selectedChest: selectedChest + 1,
        selected: { type: chests[selectedChest].type, title: chests[selectedChest].title },
        chests
      };
    }).filter(Boolean);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ rounds });
  } catch (error) {
    databaseError(res, error);
  }
});

// Сохранить состояние
app.post('/api/game-state', async (req, res) => {
  const id = teamId(req, res);
  if (id === null) return;
  if (!sameOrigin(req)) return res.status(403).json({ error: 'Недопустимый источник запроса.' });
  let client;
  try {
    await ensureTable();
    client = await pool.connect();
    await client.query('BEGIN');
    const catalogResult = await client.query('SELECT data FROM department_shop WHERE id = 1 FOR UPDATE');
    const catalog = catalogResult.rows[0].data;
    const rulesResult = await client.query('SELECT data FROM department_rules WHERE id = 1 FOR UPDATE');
    const rules = rulesResult.rows[0].data;
    const current = await client.query('SELECT data FROM game_state WHERE id = $1 FOR UPDATE', [id]);
    const before = withDepartmentConfig(current.rows[0]?.data ?? {}, catalog, rules);
    if (req.get('if-match') !== stateETag(before)) {
      await client.query('ROLLBACK');
      return res.status(412).json({ error: 'Данные команды изменились в другой вкладке. Обновите страницу.' });
    }
    const pendingPurchase = before.pendingCase && before.ledger?.find(entry => entry.source === 'purchase' && entry.ref === before.pendingCase.requestId);
    const incomingPurchase = before.pendingCase && Array.isArray(req.body?.ledger) && req.body.ledger.find(entry => entry.source === 'purchase' && entry.ref === before.pendingCase.requestId);
    if (!isDeepStrictEqual(before.pendingCase ?? null, req.body?.pendingCase ?? null) ||
        (before.pendingCase && (!Array.isArray(req.body?.players) || !req.body.players.some(player => player.id === before.pendingCase.playerId) ||
          !isDeepStrictEqual(before.rewards, req.body?.rewards) || !isDeepStrictEqual(pendingPurchase, incomingPurchase)))) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Сначала завершите выбор шкатулки.' });
    }
    if (!isAdmin(req) && (!current.rows.length || protectedChange(before, req.body))) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Изменять настройки, историю и челленджи может только руководитель группы.' });
    }
    if (!isAdmin(req) && !publicUpdateValid(before, req.body)) {
      await client.query('ROLLBACK');
      return res.status(422).json({ error: 'Игровые шаги, монетки и награды не совпадают с выполненными действиями.' });
    }
    if (!dailyChallengeAdditionsValid(before, req.body)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Мини-челлендж «Мощный дожим» можно подтвердить только один раз в день для каждого менеджера.' });
    }
    const salesActions = salesActionDeltas(before, req.body);
    for (const salesAction of salesActions) if (salesAction.kind === 'activity' || telegramConfigured()) {
      const credit = await client.query(`
        WITH chosen AS (
          SELECT id FROM telegram_action_credits
          WHERE team_id = $1 AND player_id = $2 AND action_kind = $3 AND status = 'pending'
          ORDER BY created_at, id FOR UPDATE SKIP LOCKED LIMIT 1
        )
        UPDATE telegram_action_credits AS credit
        SET status = 'consumed', consumed_at = now()
        FROM chosen WHERE credit.id = chosen.id
        RETURNING credit.id
      `, [id, salesAction.playerId, salesAction.kind]);
      if (!credit.rows.length) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: salesAction.kind === 'activity' ? 'Для этого дня нет подтверждённой активности 70%+.' : 'Для этого действия нет нового подтверждения из чата продаж.' });
      }
    }
    if (!Array.isArray(req.body?.players) || req.body.players.some(player =>
        (player?.salesName !== undefined && (typeof player.salesName !== 'string' || player.salesName.length > 120)) ||
        (player?.avatar !== undefined && (typeof player.avatar !== 'string' || player.avatar.length > 300000 ||
          !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(player.avatar))))) {
      await client.query('ROLLBACK');
      return res.status(422).json({ error: 'Имя для Telegram или картинка персонажа заполнены неверно.' });
    }
    const requestedShop = req.body?.config?.shop;
    if (!validShop(requestedShop)) {
      await client.query('ROLLBACK');
      return res.status(422).json({ error: 'Проверьте названия, цены и лимиты наград в магазине.' });
    }
    const requestedRules = sharedRules(req.body?.config);
    if (!validRules(requestedRules)) {
      await client.query('ROLLBACK');
      return res.status(422).json({ error: 'Проверьте общие правила шагов и челленджей.' });
    }
    if (!current.rows.length && !isDeepStrictEqual(rules, requestedRules)) {
      await client.query('ROLLBACK');
      return res.status(412).json({ error: 'Общие правила отдела изменились. Обновите страницу перед созданием команды.' });
    }
    if (!isDeepStrictEqual(rules, requestedRules)) {
      if (!isAdmin(req)) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'Менять общие правила может только руководитель группы.' });
      }
      const allGames = await client.query('SELECT data FROM game_state WHERE id = ANY($1::int[])', [Object.values(teamIds)]);
      if (changesUsedRules(rules, requestedRules, ruleUsage(allGames.rows.map(row => row.data)))) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Уже использованные курсы, челленджи и действия нельзя менять для всего отдела. Создайте новое условие.' });
      }
      await client.query('UPDATE department_rules SET data = $1::jsonb WHERE id = 1', [JSON.stringify(requestedRules)]);
    }
    if (!isDeepStrictEqual(catalog, requestedShop)) {
      if (!isAdmin(req)) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'Менять магазин может только руководитель группы.' });
      }
      for (const item of requestedShop.filter(item => item.superPrize)) {
        await client.query(`
          INSERT INTO super_prize_inventory (prize_id, purchased, limit_count)
          VALUES ($1, 0, $2)
          ON CONFLICT (prize_id) DO UPDATE SET limit_count = EXCLUDED.limit_count
        `, [item.id, item.stockLimit]);
      }
      await client.query('UPDATE department_shop SET data = $1::jsonb WHERE id = 1', [JSON.stringify(requestedShop)]);
    }
    const stockRows = await client.query('SELECT prize_id, purchased, limit_count FROM super_prize_inventory FOR UPDATE');
    const currentSuperIds = new Set(requestedShop.filter(item => item.superPrize).map(item => item.id));
    const previousRewards = new Map((Array.isArray(before.rewards) ? before.rewards : []).map(reward => [reward.id, reward]));
    const incomingRewards = new Map((Array.isArray(req.body?.rewards) ? req.body.rewards : []).map(reward => [reward.id, reward]));
    const remainingPlayers = new Set((Array.isArray(req.body?.players) ? req.body.players : []).map(player => player.id));
    for (const previous of before.id === req.body?.id ? previousRewards.values() : []) {
      if (!previous.case) continue;
      const incoming = incomingRewards.get(previous.id);
      const beforeSpend = before.ledger?.find(entry => entry.source === 'purchase' && entry.ref === previous.id);
      const afterSpend = req.body?.ledger?.find(entry => entry.source === 'purchase' && entry.ref === previous.id);
      if (!incoming && !remainingPlayers.has(previous.playerId) && !afterSpend &&
          !req.body.ledger?.some(entry => entry.source === 'refund' && entry.ref === previous.id)) continue;
      if (!incoming || incoming.cancelled || !incoming.case ||
          ['id', 'playerId', 'prizeId', 'title', 'cost', 'source', 'superPrize', 'at'].some(key => incoming[key] !== previous[key]) ||
          !isDeepStrictEqual(afterSpend, beforeSpend) ||
          req.body.ledger?.some(entry => entry.source === 'refund' && entry.ref === previous.id)) {
        await client.query('ROLLBACK');
        return res.status(422).json({ error: 'Результат открытого кейса и списание за него изменить нельзя.' });
      }
    }
    for (const reward of Array.isArray(req.body?.rewards) ? req.body.rewards : []) {
      const previous = previousRewards.get(reward?.id);
      if (!previous && reward?.source === 'shop' && !isAdmin(req)) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'Новые награды выдаются через открытие кейса.' });
      }
      if (previous?.case && reward.cancelled !== previous.cancelled) {
        await client.query('ROLLBACK');
        return res.status(422).json({ error: 'Открытый кейс нельзя отменить после раскрытия награды.' });
      }
      if (previous && (previous.prizeId !== reward.prizeId || countedReward(previous) !== countedReward(reward))) {
        await client.query('ROLLBACK');
        return res.status(422).json({ error: 'Тип уже купленной награды менять нельзя.' });
      }
      if (!previous && reward?.source === 'shop' && !reward.cancelled && reward.superPrize !== currentSuperIds.has(reward.prizeId)) {
        await client.query('ROLLBACK');
        return res.status(422).json({ error: 'Тип покупки не совпадает с настройками магазина.' });
      }
    }
    for (const [prizeId, change] of Object.entries(inventoryChanges(before, req.body, stockRows.rows.map(row => row.prize_id)))) {
      if (!change) continue;
      const stock = stockRows.rows.find(row => row.prize_id === prizeId);
      const updated = await client.query(`
        UPDATE super_prize_inventory
        SET purchased = purchased + $2
        WHERE prize_id = $1 AND purchased + $2 >= 0 AND ($2 < 0 OR purchased + $2 <= $3)
        RETURNING purchased
      `, [prizeId, change, stock.limit_count]);
      if (!updated.rows.length) {
        await client.query('ROLLBACK');
        return res.status(409).json({ code: 'SUPER_PRIZE_SOLD_OUT', error: 'Супер-приз уже разобрали. Обновите страницу и выберите другую награду.' });
      }
    }
    if (startsNewPeriod(before, req.body)) {
      await client.query(`
        UPDATE telegram_action_credits
        SET status = 'consumed', consumed_at = now()
        WHERE team_id = $1 AND status = 'pending'
          AND action_kind IN ('cashLow','cashMid','cashHigh','cross','activity')
      `, [id]);
    }
    await client.query(
      `INSERT INTO game_state (id, data, updated_at)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT (id) DO UPDATE
       SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at`,
      [id, JSON.stringify(req.body)]
    );
    await client.query('COMMIT');
    res.setHeader('ETag', stateETag(req.body));
    res.json({ ok: true });
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    databaseError(res, err);
  } finally {
    client?.release();
  }
});

function nonnegativeNumber(value) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function paymentCount(player, logs) {
  const counts = player?.actionCounts || {};
  const quick = ['payment-low', 'payment-mid', 'payment-high']
    .reduce((sum, key) => sum + nonnegativeNumber(counts[key]), 0);
  const legacy = (Array.isArray(logs) ? logs : []).filter(entry =>
    typeof entry?.text === 'string' && entry.text.startsWith(`${player.name}: новая оплата `)).length;
  return quick + legacy;
}

function stepsFromHistory(player, logs) {
  if (!Array.isArray(logs)) return nonnegativeNumber(player.high);
  const joinedAt = logs.findIndex(entry => entry?.text === `${player.name} присоединяется к игре`);
  const currentLogs = joinedAt < 0 ? logs : logs.slice(0, joinedAt);
  const prefix = `${player.name}: дистанция `;
  const steps = currentLogs.reduce((total, entry) => {
    const text = entry?.text;
    if (typeof text !== 'string' || !text.startsWith(prefix)) return total;
    const match = text.match(/потрачено ([1-9]\d*) шаг\./);
    const count = match ? Number(match[1]) : 0;
    return total + (Number.isSafeInteger(count) ? count : 0);
  }, 0);
  // Older imported saves might have distance but no detailed move history.
  return steps || (joinedAt < 0 ? nonnegativeNumber(player.high) : 0);
}

app.get('/api/department', async (req, res) => {
  try {
    await ensureTable();
    const result = await pool.query('SELECT id, data, updated_at FROM game_state WHERE id = ANY($1::int[])', [Object.values(teamIds)]);
    const byId = new Map(result.rows.map(row => [Number(row.id), row]));
    const teams = Object.entries(teamIds).map(([key, id]) => {
      const row = byId.get(id);
      const game = row?.data || {};
      const ledger = Array.isArray(game.ledger) ? game.ledger : [];
      const players = (Array.isArray(game.players) ? game.players : []).map(player => ({
        id: String(player.id ?? ''),
        name: String(player.name ?? 'Участник'),
        steps: stepsFromHistory(player, game.logs),
        payments: paymentCount(player, game.logs),
        laps: Math.floor(nonnegativeNumber(player.high) / 60),
        calls: nonnegativeNumber(player.calls),
        activityDays: Object.keys(player.actionCounts || {}).filter(key => /^activity-\d{4}-\d{2}-\d{2}$/.test(key)).length,
        crossSales: nonnegativeNumber(player.cross),
        coins: ledger.reduce((sum, item) => sum + (item?.playerId === player.id && ['milestone', 'challenge', 'manual'].includes(item?.source) ? nonnegativeNumber(item.amount) : 0), 0)
      }));
      const totals = players.reduce((sum, player) => {
        for (const key of ['steps', 'payments', 'laps', 'calls', 'activityDays', 'crossSales', 'coins']) sum[key] += player[key];
        return sum;
      }, { steps: 0, payments: 0, laps: 0, calls: 0, activityDays: 0, crossSales: 0, coins: 0 });
      return { key, name: teamNames[key], players, totals, saved: Boolean(row), updatedAt: game.updated ?? row?.updated_at ?? null };
    });
    res.json({ teams });
  } catch (error) {
    databaseError(res, error);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
