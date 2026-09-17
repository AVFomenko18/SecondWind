import express from 'express';
import pg from 'pg';
import { createHmac, createHash, timingSafeEqual } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

const { Pool } = pg;
const app = express();

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
    tableReady = pool.query(`
      CREATE TABLE IF NOT EXISTS game_state (
        id integer PRIMARY KEY,
        data jsonb NOT NULL DEFAULT '{}'::jsonb,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `).catch(error => {
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
    res.json(result.rows[0]?.data ?? {});
  } catch (err) {
    databaseError(res, err);
  }
});

// Сохранить состояние
app.post('/api/game-state', async (req, res) => {
  const id = teamId(req, res);
  if (id === null) return;
  if (!sameOrigin(req)) return res.status(403).json({ error: 'Недопустимый источник запроса.' });
  try {
    await ensureTable();
    const current = await pool.query('SELECT data FROM game_state WHERE id = $1', [id]);
    if (!isAdmin(req) && (!current.rows.length || protectedChange(current.rows[0]?.data, req.body))) {
      return res.status(403).json({ error: 'Изменять настройки, историю и челленджи может только руководитель группы.' });
    }
    await pool.query(
      `INSERT INTO game_state (id, data, updated_at)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT (id) DO UPDATE
       SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at`,
      [id, JSON.stringify(req.body)]
    );
    res.json({ ok: true });
  } catch (err) {
    databaseError(res, err);
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
