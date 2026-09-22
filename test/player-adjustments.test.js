import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8');

test('manager settings show exact saved steps and pending activity credits', () => {
  assert.match(page, /id="managerBank\$\{index\}"[^>]*step="0\.5"[^>]*value="\$\{p\.bank\}"/);
  assert.match(page, /id="managerActivity\$\{index\}"[^>]*step="1"[^>]*value="\$\{salesCreditCount\(p,'activity'\)\}"/);
  assert.ok(page.includes('Сохранить шаги и активность'));
});

test('player adjustment endpoint is manager-only, conflict-safe and audits changes', () => {
  const start = server.indexOf("app.post('/api/admin/player-adjustments'");
  const end = server.indexOf("\napp.get('/api/department-rules'", start);
  assert.ok(start >= 0 && end > start);
  const endpoint = server.slice(start, end);
  assert.match(endpoint, /!sameOrigin\(req\)/);
  assert.match(endpoint, /!isAdmin\(req\)/);
  assert.match(endpoint, /req\.get\('if-match'\) !== stateETag\(before\)/);
  assert.match(endpoint, /player\.bank = adjustment\.bank/);
  assert.match(endpoint, /action_kind = 'activity' AND status = 'pending'/);
  assert.match(endpoint, /status = 'consumed'/);
  assert.match(endpoint, /'activity',70/);
  assert.match(endpoint, /Ручная корректировка руководителя/);
  assert.match(endpoint, /state: next/);
});
