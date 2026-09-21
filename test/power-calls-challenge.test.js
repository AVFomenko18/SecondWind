import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8');

test('power calls are an enabled two-coin manager challenge in browser and server defaults', () => {
  for (const source of [page, server]) {
    assert.match(source, /id:'challenge-power-calls'|id: 'challenge-power-calls'/);
    assert.match(source, /Мини-челлендж: мощный дожим/);
    assert.match(source, /medals:\s*2,\s*enabled:\s*true/);
  }
  assert.doesNotMatch(page, /requestQuickStep\('powerCalls'/);
});

test('existing department rules receive the mini-challenge once', () => {
  assert.match(server, /!currentRules\.challenges\.some\(item => item\.id === 'challenge-power-calls'\)/);
  assert.match(server, /currentRules\.challenges\.push\(\{ id: 'challenge-power-calls'/);
});
