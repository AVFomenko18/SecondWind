import express from 'express';
import pg from 'pg';

const { Pool } = pg;
const app = express();

app.use(express.json({ limit: '10mb' }));
app.use(express.static('.'));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

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
  const missingConfig = error.message === 'DATABASE_URL_MISSING';
  res.status(503).json({
    error: missingConfig
      ? 'На сервере Render не задана переменная DATABASE_URL.'
      : 'Не удалось подключиться к Neon или подготовить таблицу игры. Проверьте DATABASE_URL и журнал Render.'
  });
}

// Получить состояние игры
app.get('/api/game-state', async (req, res) => {
  try {
    await ensureTable();
    const result = await pool.query('SELECT data FROM game_state WHERE id = 1');
    res.json(result.rows[0]?.data ?? {});
  } catch (err) {
    databaseError(res, err);
  }
});

// Сохранить состояние
app.post('/api/game-state', async (req, res) => {
  try {
    await ensureTable();
    await pool.query(
      `INSERT INTO game_state (id, data, updated_at)
       VALUES (1, $1::jsonb, now())
       ON CONFLICT (id) DO UPDATE
       SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at`,
      [JSON.stringify(req.body)]
    );
    res.json({ ok: true });
  } catch (err) {
    databaseError(res, err);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
