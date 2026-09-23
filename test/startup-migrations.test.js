import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8');

test('one-off Fomenko credit grant cannot take down startup after the manager is removed', () => {
  const start = server.indexOf('async function grantFomenkoActionCredits()');
  const end = server.indexOf('async function grantActivityCredits(', start);
  const migration = server.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.ok(migration.indexOf('INSERT INTO app_migrations') < migration.indexOf("normalizeSalesName('Александр Фоменко')"));
  assert.match(migration, /if \(!player\) \{\s*await client\.query\('COMMIT'\);\s*return;/);
  assert.doesNotMatch(migration, /ALEXANDER_FOMENKO_NOT_FOUND/);
});
