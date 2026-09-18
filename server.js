import express from 'express';
import pg from 'pg';
import { createHmac, createHash, timingSafeEqual } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

const { Pool } = pg;
const app = express();

const NEW_SHOP_PRIZES = Object.freeze([
  { id: 'prize-20', name: 'Day off · дополнительный выходной', cost: 7, enabled: true },
  { id: 'prize-21', name: 'Забрать оплату у робота Алёши · до 50 000 ₽', cost: 7, enabled: true },
  { id: 'prize-22', name: 'Индивидуальная гифка с менеджером', cost: 2, enabled: true }
]);
const SUPER_PRIZE_LIMITS = Object.freeze({ 'prize-20': 5, 'prize-21': 5 });

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
  if (!isDeepStrictEqual(before.config, after.config) || before.id !== after.id) return true;
  const oldLogs = Array.isArray(before.logs) ? before.logs : [];
  const newLogs = Array.isArray(after.logs) ? after.logs : [];
  if (newLogs.length < oldLogs.length || (oldLogs.length > 0 && !isDeepStrictEqual(newLogs.slice(-oldLogs.length), oldLogs))) return true;
  const oldChallenges = (Array.isArray(before.ledger) ? before.ledger : []).filter(x => x?.source === 'challenge');
  const newChallenges = (Array.isArray(after.ledger) ? after.ledger : []).filter(x => x?.source === 'challenge');
  return !isDeepStrictEqual(oldChallenges, newChallenges);
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

function inventoryChanges(before, after) {
  const changes = {};
  // A period switch or restoration changes the state id. Historical purchases
  // have already been counted and must not be counted again or returned.
  if (before?.id && before.id !== after?.id) {
    return Object.fromEntries(Object.keys(SUPER_PRIZE_LIMITS).map(id => [id, 0]));
  }
  for (const id of Object.keys(SUPER_PRIZE_LIMITS)) {
    const previous = new Map((Array.isArray(before?.rewards) ? before.rewards : [])
      .filter(reward => reward?.prizeId === id).map(reward => [reward.id, reward]));
    const next = new Map((Array.isArray(after?.rewards) ? after.rewards : [])
      .filter(reward => reward?.prizeId === id).map(reward => [reward.id, reward]));
    let change = 0;
    for (const [rewardId, reward] of next) {
      const old = previous.get(rewardId);
      if (!reward.cancelled && (!old || old.cancelled)) change++;
      if (reward.cancelled && old && !old.cancelled) change--;
    }
    // Rolling back a purchase within the same period restores stock.
    for (const [rewardId, reward] of previous) {
      if (!next.has(rewardId) && !reward.cancelled) change--;
    }
    changes[id] = change;
  }
  return changes;
}

function duplicateSuperPrize(after) {
  const owned = new Set();
  for (const reward of Array.isArray(after?.rewards) ? after.rewards : []) {
    if (!SUPER_PRIZE_LIMITS[reward?.prizeId] || reward.cancelled) continue;
    const key = `${reward.playerId}|${reward.prizeId}`;
    if (owned.has(key)) return true;
    owned.add(key);
  }
  return false;
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// The original single-team game uses id 1, so its saved progress stays with Fomenko.
const teamIds = Object.freeze({ fomenko: 1, lvovsky: 2, shabanov: 3, kozhanov: 4 });
const teamNames = Object.freeze({ fomenko: 'Фоменко', lvovsky: 'Львовский', shabanov: 'Шабанов', kozhanov: 'Кожанов' });
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
          purchased integer NOT NULL DEFAULT 0 CHECK (purchased >= 0)
        )
      `);
      for (const id of Object.keys(SUPER_PRIZE_LIMITS)) {
        await pool.query('INSERT INTO super_prize_inventory (prize_id) VALUES ($1) ON CONFLICT DO NOTHING', [id]);
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
    const result = await pool.query('SELECT data FROM game_state WHERE id = $1', [id]);
    const data = result.rows[0]?.data ?? {};
    res.setHeader('ETag', stateETag(data));
    res.json(data);
  } catch (err) {
    databaseError(res, err);
  }
});

app.get('/api/prize-stock', async (_req, res) => {
  try {
    await ensureTable();
    const result = await pool.query('SELECT prize_id, purchased FROM super_prize_inventory');
    const purchased = Object.fromEntries(result.rows.map(row => [row.prize_id, Number(row.purchased)]));
    const remaining = Object.fromEntries(Object.entries(SUPER_PRIZE_LIMITS)
      .map(([id, limit]) => [id, Math.max(0, limit - (purchased[id] || 0))]));
    res.json({ remaining, limits: SUPER_PRIZE_LIMITS });
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
    const current = await client.query('SELECT data FROM game_state WHERE id = $1 FOR UPDATE', [id]);
    const before = current.rows[0]?.data ?? {};
    if (req.get('if-match') !== stateETag(before)) {
      await client.query('ROLLBACK');
      return res.status(412).json({ error: 'Данные команды изменились в другой вкладке. Обновите страницу.' });
    }
    if (!isAdmin(req) && (!current.rows.length || protectedChange(before, req.body))) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Изменять настройки, историю и челленджи может только руководитель группы.' });
    }
    if (duplicateSuperPrize(req.body)) {
      await client.query('ROLLBACK');
      return res.status(422).json({ error: 'Один менеджер может купить каждый супер-приз только один раз.' });
    }
    for (const [prizeId, change] of Object.entries(inventoryChanges(before, req.body))) {
      if (!change) continue;
      const updated = await client.query(`
        UPDATE super_prize_inventory
        SET purchased = purchased + $2
        WHERE prize_id = $1 AND purchased + $2 BETWEEN 0 AND $3
        RETURNING purchased
      `, [prizeId, change, SUPER_PRIZE_LIMITS[prizeId]]);
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
    const match = text.match(/потрачено ([1-6]) шаг\./);
    return total + (match ? Number(match[1]) : 0);
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
        coins: ledger.reduce((sum, item) => sum + (item?.playerId === player.id && ['milestone', 'challenge'].includes(item?.source) ? nonnegativeNumber(item.amount) : 0), 0)
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
