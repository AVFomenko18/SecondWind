import express from 'express';
import pg from 'pg';
import { createHmac, createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { CASE_COST, MINI_PRIZES, casePool, drawCaseOutcome, createChestRound } from './case.js';

const { Pool } = pg;
const app = express();

const NEW_SHOP_PRIZES = Object.freeze([
  { id: 'prize-20', name: 'Day off · дополнительный выходной', cost: 7, enabled: true },
  { id: 'prize-21', name: 'Забрать оплату у робота Алёши · до 50 000 ₽', cost: 7, enabled: true },
  { id: 'prize-22', name: 'Индивидуальная гифка с менеджером', cost: 2, enabled: true }
]);
const INITIAL_SUPER_PRIZE_LIMITS = Object.freeze({ 'prize-8': 5, 'prize-9': 5, 'prize-20': 5, 'prize-21': 5 });
const DEFAULT_SHOP_NAMES = ['Закончить день на час раньше', 'Обед 1,5 часа', 'День без встреч', 'День без отчётов', 'Несгораемый день', 'Отказаться от 3 лидов', '+5 курсов в распределение', 'Сертификат 1 000 ₽', 'Кино от босса'];
const DEFAULT_SHOP_COSTS = [2, 1, 3, 2, 3, 2, 3, 4, 2];
const DEFAULT_SHOP = DEFAULT_SHOP_NAMES.map((name, index) => ({ id: `prize-${index + 1}`, name, cost: DEFAULT_SHOP_COSTS[index], enabled: true })).concat(NEW_SHOP_PRIZES);
function completeShop(items) {
  const shop = Array.isArray(items) ? items.filter(item => !['prize-0', 'prize-10'].includes(item.id)).map(item => ({ ...item })) : DEFAULT_SHOP.map(item => ({ ...item }));
  for (const item of shop) if (item.id === 'prize-9' && item.name === 'Обед от босса') item.name = 'Кино от босса';
  for (const prize of NEW_SHOP_PRIZES) if (!shop.some(item => item.id === prize.id)) shop.push({ ...prize });
  return shop.map(item => ({ ...item,
    superPrize: typeof item.superPrize === 'boolean' ? item.superPrize : Object.hasOwn(INITIAL_SUPER_PRIZE_LIMITS, item.id),
    stockLimit: Number.isSafeInteger(item.stockLimit) && item.stockLimit > 0 ? item.stockLimit : (INITIAL_SUPER_PRIZE_LIMITS[item.id] || 5)
  }));
}
function validShop(shop) {
  return Array.isArray(shop) && shop.length > 0 && shop.length <= 50 && new Set(shop.map(item => item.id)).size === shop.length && shop.every(item =>
    item && typeof item.id === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)+$/i.test(item.id) && item.id.length <= 80 &&
    typeof item.name === 'string' && item.name.trim().length > 0 && item.name.length <= 200 &&
    Number.isSafeInteger(item.cost) && item.cost >= 1 && item.cost <= 10000 && typeof item.enabled === 'boolean' &&
    typeof item.superPrize === 'boolean' && Number.isSafeInteger(item.stockLimit) && item.stockLimit >= 1 && item.stockLimit <= 10000);
}
const DEFAULT_RULES = Object.freeze({ cashUnit: 50000, crossSteps: 1, actions: [], challenges: [
  { id: 'challenge-1', name: 'Личный рекорд', description: 'Превысить свой лучший дневной результат по кассе. Предложение — согласуйте критерий до старта.', medals: 1, enabled: false },
  { id: 'challenge-2', name: 'Командный ассист', description: 'Помочь коллеге довести сложную сделку до оплаты. Предложение — согласуйте критерий до старта.', medals: 1, enabled: false },
  { id: 'challenge-3', name: 'Большой рывок', description: 'Выполнить особую цель периода, заранее согласованную с ведущим.', medals: 2, enabled: false }
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
      if (entry?.source === 'challenge' && typeof entry.ref === 'string') challengeIds.add(entry.ref);
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
const teamNames = Object.freeze({ fomenko: 'Фоменко', lvovsky: 'Львовский', shabanov: 'Шабанов', kozhanov: 'Кожанов', otrakusha: 'Отрокуша', kulikov: 'Куликов', kondratyev: 'Кондратьев', chekhova: 'Чехова', klimentovich: 'Климентович', bagaturiya: 'Багатурия', tolstov: 'Толстов' });
function teamId(req, res) {
  const key = req.query.team ?? 'fomenko';
  if (typeof key !== 'string' || !Object.hasOwn(teamIds, key)) {
    res.status(400).json({ error: 'Неизвестная команда.' });
    return null;
  }
  return teamIds[key];
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
      let rulesResult = await pool.query('SELECT data FROM department_rules WHERE id = 1');
      if (!rulesResult.rows.length) {
        const fomenkoRules = await pool.query('SELECT data->\'config\' AS config FROM game_state WHERE id = 1');
        const initialRules = sharedRules(fomenkoRules.rows[0]?.config ?? DEFAULT_RULES);
        if (!validRules(initialRules)) throw new Error('INVALID_FOMENKO_RULES');
        await pool.query('INSERT INTO department_rules (id, data) VALUES (1, $1::jsonb) ON CONFLICT DO NOTHING', [JSON.stringify(initialRules)]);
        rulesResult = await pool.query('SELECT data FROM department_rules WHERE id = 1');
      }
      if (!validRules(rulesResult.rows[0]?.data)) throw new Error('INVALID_DEPARTMENT_RULES');
      const existingShop = await pool.query(`SELECT data #> '{config,shop}' AS shop FROM game_state WHERE jsonb_typeof(data #> '{config,shop}') = 'array' ORDER BY id LIMIT 1`);
      await pool.query('INSERT INTO department_shop (id, data) VALUES (1, $1::jsonb) ON CONFLICT DO NOTHING', [JSON.stringify(completeShop(existingShop.rows[0]?.shop))]);
      const catalogResult = await pool.query('SELECT data FROM department_shop WHERE id = 1');
      const catalog = completeShop(catalogResult.rows[0].data);
      if (!validShop(catalog)) throw new Error('INVALID_SHOP_CATALOG');
      await pool.query('UPDATE department_shop SET data = $1::jsonb WHERE id = 1', [JSON.stringify(catalog)]);
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
          SET purchased = GREATEST(super_prize_inventory.purchased, EXCLUDED.purchased)
        `, [id, item.stockLimit, Object.hasOwn(INITIAL_SUPER_PRIZE_LIMITS, id)]);
      }
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
    res.json({ cost: CASE_COST, superChestChance: 10, miniPrizes: MINI_PRIZES,
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
      const round = createChestRound(prize);
      await client.query('INSERT INTO case_rounds (team_id, request_id, player_id, data) VALUES ($1, $2, $3, $4::jsonb)',
        [id, requestId, playerId, JSON.stringify(round)]);
      next.pendingCase = { requestId, playerId, at };
    } else {
      reward = { id: requestId, playerId, prizeId: prize.id, title: prize.name, cost: CASE_COST,
        source: 'shop', superPrize: false, case: true, claimed: false, cancelled: false, at };
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
    const superPrize = chest === round.position;
    const consolation = superPrize ? null : round.miniPrizes[chest < round.position ? chest : chest - 1];
    if (!superPrize) {
      await client.query('UPDATE super_prize_inventory SET purchased = GREATEST(0, purchased - 1) WHERE prize_id = $1', [round.prize.id]);
    }
    const prize = superPrize ? round.prize : consolation;
    const reward = { id: requestId, playerId: saved.player_id, prizeId: prize.id, title: prize.name, cost: CASE_COST,
      source: 'shop', superPrize, miniPrize: !superPrize, case: true, claimed: false, cancelled: false, at: before.pendingCase.at };
    const reveal = [0, 1, 2].map(index => index === round.position
      ? { title: round.prize.name, superPrize: true }
      : { title: round.miniPrizes[index < round.position ? index : index - 1].name, superPrize: false });
    const next = structuredClone(before);
    delete next.pendingCase;
    next.rewards.push(reward);
    const purchase = next.ledger.find(entry => entry.source === 'purchase' && entry.ref === requestId);
    if (purchase) purchase.title = `Кейс: ${reward.title}`;
    const at = new Date().toISOString();
    next.logs.unshift({ id: randomUUID(), at,
      text: `${player.name}: выбрал(а) шкатулку №${chest + 1} и получил(а) «${reward.title}»${superPrize ? ' · СУПЕР-ПРИЗ!' : ' · мини-приз'}.` });
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
    if (!Array.isArray(req.body?.players) || req.body.players.some(player => player?.avatar !== undefined &&
        (typeof player.avatar !== 'string' || player.avatar.length > 300000 ||
          !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(player.avatar)))) {
      await client.query('ROLLBACK');
      return res.status(422).json({ error: 'Картинка персонажа повреждена или слишком велика.' });
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
        revenue: nonnegativeNumber(player.cash),
        laps: Math.floor(nonnegativeNumber(player.high) / 60),
        calls: nonnegativeNumber(player.calls),
        crossSales: nonnegativeNumber(player.cross),
        coins: ledger.reduce((sum, item) => sum + (item?.playerId === player.id && ['milestone', 'challenge', 'manual'].includes(item?.source) ? nonnegativeNumber(item.amount) : 0), 0)
      }));
      const totals = players.reduce((sum, player) => {
        for (const key of ['steps', 'revenue', 'laps', 'calls', 'crossSales', 'coins']) sum[key] += player[key];
        return sum;
      }, { steps: 0, revenue: 0, laps: 0, calls: 0, crossSales: 0, coins: 0 });
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
