import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('rules page replaces legacy help blocks with a free demo wheel', () => {
  const start = html.indexOf('function rulesView(){');
  const end = html.indexOf('function renderSettingsModal(){', start);
  const rules = html.slice(start, end);
  assert.match(rules, /БЕСПЛАТНАЯ ДЕМОНСТРАЦИЯ/);
  assert.match(rules, /onclick="spinDemoWheel\(\)"/);
  assert.doesNotMatch(rules, /06 \/ Сохраняем прогресс|При переносе прежней игры|Дополнительные действия/);
});

test('demo always targets a chest and does not call prize APIs or mutate game state', () => {
  const start = html.indexOf('function spinDemoWheel(){');
  const end = html.indexOf('function rulesView(){', start);
  const demo = html.slice(start, end);
  assert.match(demo, /item\.chestSector/);
  assert.match(demo, /reveal\[chest\]=\{type:'super'/);
  assert.match(demo, /showCaseCelebration\(\{title:superPrize\.name,superPrize:true\}\)/);
  assert.doesNotMatch(demo, /fetch\(|apiRequest\(|commit\(|persist\(|state\.(?:rewards|ledger|pendingCase)\s*=/);
});
