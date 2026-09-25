import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { TEAM_ROSTERS } from '../team-rosters.js';

const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('confirmed dashboard activity grants exactly 42 roster credits once', () => {
  const source = server.match(/const ACTIVITY_CREDIT_GRANTS = Object\.freeze\((\{[\s\S]*?\})\);/)?.[1];
  assert.ok(source);
  const grants = vm.runInNewContext('(' + source + ')');
  const names = Object.values(grants).flat();
  assert.equal(names.length, 42);
  assert.equal(new Set(names).size, 42);
  for (const [team, teamNames] of Object.entries(grants)) {
    assert.ok(TEAM_ROSTERS[team]);
    for (const name of teamNames) assert.ok(TEAM_ROSTERS[team].includes(name), `${team}: ${name}`);
  }
  assert.match(server, /grant-activity-70-percent-for-2026-09-21-v1/);
  assert.match(server, /'activity',70/);
});

test('22 September dashboard grants exactly 42 roster credits once', () => {
  const source = server.match(/const ACTIVITY_CREDIT_GRANTS_2026_09_22 = Object\.freeze\((\{[\s\S]*?\})\);/)?.[1];
  assert.ok(source);
  const grants = vm.runInNewContext('(' + source + ')');
  const names = Object.values(grants).flat();
  assert.equal(names.length, 42);
  assert.equal(new Set(names).size, 42);
  for (const [team, teamNames] of Object.entries(grants)) {
    assert.ok(TEAM_ROSTERS[team]);
    for (const name of teamNames) assert.ok(TEAM_ROSTERS[team].includes(name), `${team}: ${name}`);
  }
  assert.match(server, /grant-activity-70-percent-for-2026-09-22-v1/);
  assert.match(server, /'22\.09\.2026'/);
});

test('23 September dashboard grants exactly 40 roster credits once', () => {
  const source = server.match(/const ACTIVITY_CREDIT_GRANTS_2026_09_23 = Object\.freeze\((\{[\s\S]*?\})\);/)?.[1];
  assert.ok(source);
  const grants = vm.runInNewContext('(' + source + ')');
  const names = Object.values(grants).flat();
  assert.equal(names.length, 40);
  assert.equal(new Set(names).size, 40);
  for (const [team, teamNames] of Object.entries(grants)) {
    assert.ok(TEAM_ROSTERS[team]);
    for (const name of teamNames) assert.ok(TEAM_ROSTERS[team].includes(name), `${team}: ${name}`);
  }
  assert.match(server, /grant-activity-70-percent-for-2026-09-23-v1/);
  assert.match(server, /'23\.09\.2026'/);
});

test('24 September dashboard grants exactly 41 roster credits once', () => {
  const source = server.match(/const ACTIVITY_CREDIT_GRANTS_2026_09_24 = Object\.freeze\((\{[\s\S]*?\})\);/)?.[1];
  assert.ok(source);
  const grants = vm.runInNewContext('(' + source + ')');
  const names = Object.values(grants).flat();
  assert.equal(names.length, 41);
  assert.equal(new Set(names).size, 41);
  for (const [team, teamNames] of Object.entries(grants)) {
    assert.ok(TEAM_ROSTERS[team]);
    for (const name of teamNames) assert.ok(TEAM_ROSTERS[team].includes(name), `${team}: ${name}`);
  }
  assert.match(server, /grant-activity-70-percent-for-2026-09-24-v1/);
  assert.match(server, /'24\.09\.2026'/);
});

test('activity buttons use server credits and server consumes them', () => {
  assert.match(html, /activityAllowed=salesCreditCount\(p,'activity'\)>0/);
  assert.match(html, /if\(kind==='activity'\)return salesCreditCount\(player,kind\)<1/);
  assert.match(server, /salesAction\.kind === 'activity' \|\| telegramConfigured\(\)/);
  assert.match(server, /Для этого дня нет подтверждённой активности 70%\+/);
});

test('activity credits accumulate until every confirmed day is claimed', () => {
  assert.match(html, /function nextActivityKey\(p\)/);
  assert.match(html, /5 шагов\$\{credit\('activity'\)\}/);
  assert.doesNotMatch(html, /activityDone\|\|!activityAllowed/);
  assert.match(server, /activity-\\d\{4\}-\\d\{2\}-\\d\{2\}\(\?:-\\d\+\)\?/);
});
