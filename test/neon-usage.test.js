import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('game polling pauses for hidden and idle tabs and uses slower refresh intervals', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /ACTION_CREDITS_REFRESH_MS=15000/);
  assert.match(html, /REWARD_FEED_REFRESH_MS=60000/);
  assert.match(html, /PRIZE_DATA_REFRESH_MS=60000/);
  assert.match(html, /UI_IDLE_TIMEOUT_MS=5\*60\*1000/);
  assert.match(html, /document\.visibilityState==='visible'&&Date\.now\(\)-lastUiActivityAt<UI_IDLE_TIMEOUT_MS/);
  assert.match(html, /tab==='board'&&backgroundRefreshAllowed\(\).*loadActionCredits/);
  assert.match(html, /tab==='board'&&backgroundRefreshAllowed\(\).*loadRewardFeed/);
  assert.doesNotMatch(html, /setInterval\([^\n]+,5000\)/);
});

test('department polling also stops after inactivity', () => {
  const html = readFileSync(new URL('../department.html', import.meta.url), 'utf8');
  assert.match(html, /DEPARTMENT_REFRESH_MS=60000,UI_IDLE_TIMEOUT_MS=5\*60\*1000/);
  assert.match(html, /setInterval\(\(\)=>\{if\(backgroundRefreshAllowed\(\)\)void refresh\(\)\}/);
});

test('reward feed coalesces concurrent database reads and caches the result', () => {
  const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  assert.match(server, /const REWARD_FEED_CACHE_MS = 15000/);
  assert.match(server, /rewardFeedRefresh \|\|= \(async \(\) =>/);
  assert.match(server, /rewardFeedCacheExpiresAt = Date\.now\(\) \+ REWARD_FEED_CACHE_MS/);
  assert.match(server, /Cache-Control', 'private, max-age=5'/);
});
