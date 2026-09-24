import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('game polling pauses for hidden and idle tabs and uses slower refresh intervals', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /ACTION_CREDITS_REFRESH_MS=30000/);
  assert.match(html, /REWARD_FEED_REFRESH_MS=60000/);
  assert.match(html, /PRIZE_DATA_REFRESH_MS=60000/);
  assert.match(html, /UI_IDLE_TIMEOUT_MS=5\*60\*1000/);
  assert.match(html, /document\.visibilityState==='visible'&&!runnerSessionActive&&Date\.now\(\)-lastUiActivityAt<UI_IDLE_TIMEOUT_MS/);
  assert.match(html, /tab==='board'&&backgroundRefreshAllowed\(\).*loadActionCredits/);
  assert.match(html, /tab==='board'&&backgroundRefreshAllowed\(\).*loadRewardFeed/);
  assert.doesNotMatch(html, /setInterval\([^\n]+,5000\)/);
  assert.match(html, /if\(rewardDataDirty\)\{rewardDataDirty=false;void loadPrizeStock\(\);void loadRewardFeed\(true\)\}/);
  assert.doesNotMatch(html, /syncStatus\('● Сохранено на сервере'\);void loadPrizeStock\(\);void loadRewardFeed\(true\)/);
});

test('department polling also stops after inactivity', () => {
  const html = readFileSync(new URL('../department.html', import.meta.url), 'utf8');
  assert.match(html, /DEPARTMENT_REFRESH_MS=60000,UI_IDLE_TIMEOUT_MS=5\*60\*1000/);
  assert.match(html, /setInterval\(\(\)=>\{if\(backgroundRefreshAllowed\(\)\)void refresh\(\)\}/);
});

test('polling APIs coalesce reads and stay cached until a write invalidates them', () => {
  const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  assert.match(server, /rewardFeedRefresh \|\|= \(async \(\) =>/);
  assert.match(server, /const actionCreditsCache = new Map\(\)/);
  assert.match(server, /departmentRefresh \|\|= \(async \(\) =>/);
  assert.match(server, /prizeDataRefresh \|\|= \(async \(\) =>/);
  assert.match(server, /function invalidateReadCaches\(teamId, rewards = false\)/);
  assert.match(server, /Cache-Control', 'private, max-age=5'/);
});

test('Neon connections and pending-credit lookup are bounded', () => {
  const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  assert.match(server, /max: 3/);
  assert.match(server, /idleTimeoutMillis: 10000/);
  assert.match(server, /telegram_action_credits_pending_team_idx/);
  assert.match(server, /WHERE status = 'pending'/);
});
