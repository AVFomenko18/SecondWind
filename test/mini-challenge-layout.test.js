import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('mini challenges are separated from main challenges in compact cards', () => {
  assert.match(page, /mainItems=items\.filter\(c=>!challengeRepeatable\(c\)\)/);
  assert.match(page, /miniItems=items\.filter\(c=>challengeRepeatable\(c\)\)/);
  assert.match(page, /mainChallenges=active\.filter\(c=>!challengeRepeatable\(c\)\)/);
  assert.match(page, /miniChallenges=active\.filter\(c=>challengeRepeatable\(c\)\)/);
  assert.match(page, /class="hero-mini-challenges"/);
  assert.match(page, /class="mini-challenge-card"/);
  assert.match(page, /\.mini-challenge-card\{display:grid/);
  assert.match(page, /<h3>Мини-челленджи<\/h3>/);
});
