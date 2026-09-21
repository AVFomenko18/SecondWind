import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = server.indexOf('const DEFAULT_RULES =');
const end = server.indexOf('\napp.use(express.json', start);
assert.ok(start >= 0 && end > start);
const context = {};
vm.createContext(context);
vm.runInContext(server.slice(start, end), context);

test('Fomenko rules overlay each team without replacing team progress or period', () => {
  const fomenko = {
    cashUnit: 60000, crossSteps: 2,
    actions: [{ id: 'action-custom', name: 'Дополнительные звонки', unit: 3, steps: 1, enabled: true }],
    challenges: [{ id: 'challenge-custom', name: 'Командная цель', description: 'Сделать план', medals: 2, enabled: true }]
  };
  const shared = context.sharedRules(fomenko);
  assert.equal(context.validRules(shared), true);
  const local = { players: [{ id: 'other-player' }], ledger: [{ playerId: 'other-player', amount: 2 }],
    config: { period: 'Третий период', cashUnit: 50000, crossSteps: 1, actions: [], challenges: [], milestones: [1, 1, 1, 1, 2], shop: [] } };
  const shop = [{ id: 'prize-1', name: 'Приз' }];
  const result = context.withDepartmentConfig(local, shop, shared);
  assert.equal(result.config.period, 'Третий период');
  assert.deepEqual(result.config.milestones, [1, 1, 1, 1, 2]);
  assert.equal(result.config.cashUnit, 60000);
  assert.equal(result.config.crossSteps, 2);
  assert.equal(result.config.actions[0].name, 'Дополнительные звонки');
  assert.equal(result.config.challenges[0].name, 'Командная цель');
  assert.equal(result.players, local.players);
  assert.equal(result.ledger, local.ledger);
  assert.equal(context.withDepartmentConfig({}, shop, shared).config, undefined);
});

test('invalid shared definitions are rejected and empty teams load the department rules', () => {
  const valid = context.sharedRules({ cashUnit: 50000, crossSteps: 1, actions: [], challenges: [] });
  assert.equal(context.validRules(valid), true);
  assert.equal(context.validRules({ ...valid, actions: [{ id: 'bad', name: 'Без курса', enabled: true }] }), false);
  assert.equal(context.validRules({ ...valid, actions: [null] }), false);
  assert.ok(server.includes('AS config FROM game_state WHERE id = 1'));
  assert.ok(server.includes('INSERT INTO department_rules (id, data) VALUES (1, $1::jsonb) ON CONFLICT DO NOTHING'));
  assert.ok(page.includes("fetch('/api/department-rules'"));
  assert.ok(server.includes('const before = withDepartmentConfig(current.rows[0]?.data ?? {}, catalog, rules)'));
});

test('used challenge and action terms cannot be changed through another team', () => {
  const rules = {
    cashUnit: 50000, crossSteps: 1,
    actions: [{ id: 'action-1', name: 'Встречи', unit: 3, steps: 1, enabled: true }],
    challenges: [{ id: 'challenge-1', name: 'Рывок', description: 'Выполнить план', medals: 2, enabled: true }]
  };
  const usage = context.ruleUsage([
    { ledger: [{ source: 'challenge', ref: 'challenge-1' }], players: [{ cash: 50000, cashBase: 0, calls: 0, cross: 0, actionCounts: {} }] },
    { ledger: [], players: [{ cash: 0, cashBase: 0, calls: 0, cross: 0, actionCounts: { 'action-1': 3 } }] }
  ]);
  assert.equal(usage.economyUsed, true);
  assert.ok(usage.challengeIds.includes('challenge-1'));
  assert.ok(usage.actionIds.includes('action-1'));
  assert.equal(context.changesUsedRules(rules, { ...rules, cashUnit: 60000 }, usage), true);
  assert.equal(context.changesUsedRules(rules, { ...rules, challenges: [{ ...rules.challenges[0], medals: 3 }] }, usage), true);
  assert.equal(context.changesUsedRules(rules, { ...rules, actions: [{ ...rules.actions[0], unit: 4 }] }, usage), true);
  assert.equal(context.changesUsedRules(rules, { ...rules, challenges: [{ ...rules.challenges[0], enabled: false }] }, usage), false);
});

test('repeatable power-call challenge usage maps back to its rule id', () => {
  const usage = context.ruleUsage([{ players: [], ledger: [
    { source: 'challenge', ref: 'challenge-power-calls:first' },
    { source: 'challenge', ref: 'challenge-power-calls:second' }
  ] }]);
  assert.equal(usage.challengeIds.length, 1);
  assert.equal(usage.challengeIds[0], 'challenge-power-calls');
});
