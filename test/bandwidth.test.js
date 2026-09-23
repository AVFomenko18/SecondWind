import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

test('large artwork is served as cacheable assets instead of embedded in HTML', () => {
  for (const page of ['index.html', 'department.html']) {
    const url = new URL(`../${page}`, import.meta.url);
    const html = readFileSync(url, 'utf8');
    assert.doesNotMatch(html, /data:image\//);
    assert.ok(statSync(url).size < 300_000, `${page} should stay below 300 KB`);
    for (const [, asset] of html.matchAll(/(?:url\(["']?|src=["'])(assets\/[^"')]+)/g)) {
      assert.ok(existsSync(fileURLToPath(new URL(`../${asset}`, import.meta.url))), `${asset} should exist`);
    }
  }
  const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  assert.match(server, /app\.use\('\/assets', express\.static\('assets', \{ maxAge: '1y', immutable: true \}\)\)/);
});

test('repeating dashboard feeds use conditional requests', () => {
  const game = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const department = readFileSync(new URL('../department.html', import.meta.url), 'utf8');
  const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  assert.match(game, /headers\['If-None-Match'\]=rewardFeedETag/);
  assert.match(game, /response\.status===304/);
  assert.match(department, /headers\['If-None-Match'\]=departmentETag/);
  assert.match(department, /response\.status===304/);
  assert.equal((server.match(/req\.get\('if-none-match'\) === etag/g) || []).length, 2);
});
