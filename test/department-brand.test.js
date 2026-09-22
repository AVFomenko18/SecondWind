import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('department header uses the large two-line sports drama lockup', () => {
  const html = readFileSync(new URL('../department.html', import.meta.url), 'utf8');
  assert.match(html, /<div class="brand" aria-label="Спортивная драма"><span>СПОРТИВНАЯ<\/span><em>ДРАМА\.<\/em><\/div>/);
  assert.match(html, /\.brand\{[^}]*flex-direction:column[^}]*font:900[^}]*Georgia/);
  assert.match(html, /\.brand em\{font-style:normal;color:#d8583f\}/);
  assert.doesNotMatch(html, /class="logo">⚑/);
});
