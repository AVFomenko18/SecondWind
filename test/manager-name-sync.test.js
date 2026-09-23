import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8');

test('manager correction keeps player ids and retries only recent unmatched sales events', () => {
  assert.match(server, /correct-five-manager-names-and-resync-v2/);
  assert.match(server, /name: 'Качегова Даяна', aliases: \['Качетова Даяна'\]/);
  assert.match(server, /player\.name = correction\.name/);
  assert.match(server, /player\.salesName = correction\.name/);
  assert.match(server, /WHERE status = 'unmatched'/);
  assert.match(server, /action_kind IN \('cashLow','cashMid','cashHigh','cross'\)/);
  assert.match(server, /AT TIME ZONE 'Europe\/Moscow'/);
  assert.match(server, /::date - 1/);
});

test('missing Telegram names fall back to manager names and recent events are retried', () => {
  assert.match(server, /backfill-missing-sales-names-and-resync-v1/);
  assert.match(server, /player\.salesName = player\.name/);
  assert.match(server, /normalizeSalesName\(player\.salesName \|\| player\.name\) === parsed\.normalizedName/);
  assert.match(server, /backfillMissingSalesNamesAndResyncCredits\(\)/);
});
