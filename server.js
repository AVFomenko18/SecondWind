import express from 'express';
import pg from 'pg';

const { Pool } = pg;
const app = express();

app.use(express.json({ limit: '30mb' }));
app.use(express.static('.'));

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
  try {
    await ensureTable();
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
