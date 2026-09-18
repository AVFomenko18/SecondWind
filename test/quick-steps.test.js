import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = html.indexOf('function activityDays(p){');
const end = html.indexOf('function movePlayer(count){', start);
assert.ok(start >= 0 && end > start);

function setup() {
  const player = { name: 'Оля', bank: 0, cash: 0, cross: 0, calls: 0, actionCounts: {} };
  const messages = [], animations = [];
  const context = {
    state: { config: { actions: [] } }, pnow: () => player, writable: () => true,
    esc: value => String(value),
    day: () => '2026-09-18', actionAnchor: () => ({ left: 10, top: 10, width: 50 }),
    snapshot: () => {}, commit: () => {}, log: text => messages.push(text), toast: text => messages.push(text),
    showEarnedPop: (amount, icon) => animations.push({ amount, icon })
  };
  vm.createContext(context);
  vm.runInContext(html.slice(start, end), context);
  return { context, player, messages, animations };
}

test('quick buttons credit half, one, and two steps without inventing cash amounts', () => {
  const { context, player, animations } = setup();
  context.creditQuickStep('cashLow');
  context.creditQuickStep('cashMid');
  context.creditQuickStep('cashHigh');
  assert.equal(player.bank, 3.5);
  assert.equal(player.cash, 0);
  assert.equal(player.actionCounts['payment-low'], 1);
  assert.equal(player.actionCounts['payment-mid'], 1);
  assert.equal(player.actionCounts['payment-high'], 1);
  assert.deepEqual(animations.map(item => item.amount), [0.5, 1, 2]);
});

test('activity is once a day; cross-sale and three calls credit one step each', () => {
  const { context, player, messages } = setup();
  context.creditQuickStep('activity');
  context.creditQuickStep('activity');
  context.creditQuickStep('cross');
  context.creditQuickStep('powerCalls');
  assert.equal(player.bank, 4);
  assert.equal(player.actionCounts['activity-2026-09-18'], 70);
  assert.equal(player.cross, 1);
  assert.equal(player.calls, 3);
  assert.ok(messages.some(text => text.includes('уже учтён')));
});

test('game field shows six direct buttons instead of amount inputs', () => {
  const from = html.indexOf('function quickActionsView(){');
  const to = html.indexOf('function fieldControls(){', from);
  assert.ok(from >= 0 && to > from);
  const { context, player } = setup();
  context.state.players = [player];
  context.state.config.actions = [];
  vm.runInContext(html.slice(from, to), context);
  const view = context.quickActionsView();
  assert.equal((view.match(/class="quick-step-button/g) || []).length, 6);
  assert.match(view, /Три звонка с мощным дожимом/);
  assert.match(view, /💳/);
  assert.match(view, /⚡/);
  assert.match(view, /🤝/);
  assert.match(view, /☎️/);
  assert.match(view, /0,5 шага/);
  assert.doesNotMatch(view, /👟|Всего оплат|учтено дней|Всего кросс-сейлов|Дополнительные действия/);
  assert.doesNotMatch(view, /type="number"/);
});

test('field controls omit the selected player balance and helper captions', () => {
  const from = html.indexOf('function fieldControls(){');
  const to = html.indexOf('function toggleWideField(button){', from);
  const context = { quickActionsView: () => '<div>Кнопки</div>' };
  vm.createContext(context);
  vm.runInContext(html.slice(from, to), context);
  const view = context.fieldControls();
  assert.match(view, /Кнопки/);
  assert.doesNotMatch(view, /в запасе|Накоплено|Дополнительные действия/);
});
