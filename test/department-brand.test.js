import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('department header omits the sports drama lockup', () => {
  const html = readFileSync(new URL('../department.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /class="brand"/);
  assert.doesNotMatch(html, /\.brand(?:\{|\s)/);
  assert.match(html, /<div class="header-team-navigation">/);
});
