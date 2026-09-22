import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('desktop dashboard fills the hero and quick-action rows without empty columns', () => {
  assert.match(page, /id="dense-dashboard-layout"/);
  assert.match(page, /\.hero\.has-challenges\{grid-template-columns:minmax\(280px,\.48fr\) minmax\(500px,1\.12fr\) minmax\(0,560px\);align-items:stretch/);
  assert.match(page, /\.hero\.has-challenges \.reward-feed\{height:292px;min-height:0/);
  assert.match(page, /\.reward-feed-list\{[^}]*flex:1 1 auto;[^}]*overflow-y:auto/);
  assert.match(page, /\.hero\.has-challenges \.hero-challenge\{min-height:156px/);
  assert.match(page, /\.field-controls \.quick-actions\{grid-template-columns:minmax\(0,1\.55fr\) repeat\(2,minmax\(0,1fr\)\)/);
});
