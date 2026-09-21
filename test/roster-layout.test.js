import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('payments, activity days and cross-sales share one compact roster row', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url));
  const source = html.toString('latin1');
  assert.match(source, /\.roster-metrics\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\);gap:4px\}/);
  assert.doesNotMatch(source, /\.roster-metrics\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/);
});
