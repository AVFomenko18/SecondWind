import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8');

test('Zinkevich pending payment credit moves from 100k+ to 50k–99,999', () => {
  const start = server.indexOf('async function correctZinkevichPaymentCredit()');
  const end = server.indexOf('function teamId(', start);
  const correction = server.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(correction, /normalizeSalesName\('Зинкевич Елизавета'\)/);
  assert.match(correction, /SET action_kind = 'cashMid', amount = 50000/);
  assert.match(correction, /action_kind = 'cashHigh' AND status = 'pending'/);
  assert.match(correction, /ORDER BY created_at, id LIMIT 1/);
  assert.match(server, /await correctZinkevichPaymentCredit\(\);/);
});
