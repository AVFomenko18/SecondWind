import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('payments, activity days and cross-sales share one compact roster row', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url));
  const source = html.toString('latin1');
  assert.match(source, /\.roster-metrics\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\);gap:4px\}/);
  assert.doesNotMatch(source, /\.roster-metrics\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/);
});

test('the first three ranked managers get gold, silver and bronze podium frames', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /\.person\.podium-1\{[^}]*border-color:#d6a92f/);
  assert.match(html, /\.person\.podium-2\{[^}]*border-color:#aeb7bd/);
  assert.match(html, /\.person\.podium-3\{[^}]*border-color:#b9754d/);
  assert.match(html, /\.map\(\(x,rank\)=>/);
  assert.match(html, /rank===0\?'🏆':rank===1\?'🥈':'🥉'/);
  assert.doesNotMatch(html, /<b>\$\{state\.players\.indexOf\(x\)\+1\}\./);
});
