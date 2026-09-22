import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = html.indexOf('function activityDays(p){');
const end = html.indexOf('function movePlayer(count){', start);
assert.ok(start >= 0 && end > start);

function setup() {
  const player = { id: 'p1', name: 'Оля', bank: 0, cash: 0, cross: 0, calls: 0, actionCounts: {} };
  const messages = [], animations = [];
  const confirmFields = { label: { textContent: '' }, gain: { textContent: '' } };
  const confirmButton = {
    hidden: true, style: {}, offsetWidth: 100,
    classList: { add() {}, remove() {} }, focus() {},
    querySelector: selector => selector.includes('label') ? confirmFields.label : confirmFields.gain
  };
  const context = {
    state: { config: { actions: [] } }, pnow: () => player, writable: () => true,
    esc: value => String(value),
    day: () => '2026-09-18', actionAnchor: () => ({ left: 10, top: 10, width: 50 }),
    snapshot: () => {}, commit: () => {}, log: text => messages.push(text), toast: text => messages.push(text),
    showEarnedPop: (amount, icon) => animations.push({ amount, icon }),
    salesActionLocked: () => false, salesCreditsConfigured: false, salesCredits: {},
    salesCreditCount: () => 0,
    document: { getElementById: id => id === 'quickConfirm' ? confirmButton : null },
    setTimeout: () => 1, clearTimeout: () => {}, innerWidth: 1200, innerHeight: 800
  };
  vm.createContext(context);
  vm.runInContext(html.slice(start, end), context);
  return { context, player, messages, animations, confirmButton, confirmFields };
}

test('quick action requires a second click before steps are credited', () => {
  const { context, player, confirmButton, confirmFields } = setup();
  context.requestQuickStep('cashMid');
  assert.equal(player.bank, 0);
  assert.equal(confirmButton.hidden, false);
  assert.equal(confirmFields.label.textContent, 'Оплата от 50 000 до 99 999 ₽');
  assert.match(confirmFields.gain.textContent, /\+2 шаг/);
  context.confirmQuickStep();
  assert.equal(player.bank, 2);
  assert.equal(player.actionCounts['payment-mid'], 1);
  assert.equal(confirmButton.hidden, true);
});

test('quick buttons credit calibrated steps without inventing cash amounts or direct coins', () => {
  const { context, player, animations } = setup();
  context.creditQuickStep('cashLow');
  context.creditQuickStep('cashMid');
  context.creditQuickStep('cashHigh');
  assert.equal(player.bank, 7);
  assert.equal(player.cash, 0);
  assert.equal(player.actionCounts['payment-low'], 1);
  assert.equal(player.actionCounts['payment-mid'], 1);
  assert.equal(player.actionCounts['payment-high'], 1);
  assert.deepEqual(animations.map(item => item.amount), [1, 2, 4]);
});

test('one activity credit unlocks one confirmed activity action', () => {
  const { context, player } = setup();
  context.salesCredits = { p1: { activity: 1 } };
  context.salesCreditCount = (current, kind) => context.salesCredits[current.id]?.[kind] || 0;
  context.salesActionLocked = (current, kind) => kind === 'activity' && context.salesCreditCount(current, kind) < 1;
  context.requestQuickStep('activity');
  context.confirmQuickStep();
  context.creditQuickStep('cross');
  context.creditQuickStep('powerCalls');
  assert.equal(player.bank, 7);
  assert.equal(player.actionCounts['activity-2026-09-18'], 70);
  assert.equal(context.salesCredits.p1.activity, 0);
  assert.equal(player.cross, 1);
  assert.equal(player.calls, 0);
});

test('game field shows payment, activity and cross-sale buttons without power calls', () => {
  const from = html.indexOf('function quickActionsView(){');
  const to = html.indexOf('function fieldControls(){', from);
  assert.ok(from >= 0 && to > from);
  const { context, player } = setup();
  context.state.players = [player];
  context.state.config.actions = [];
  vm.runInContext(html.slice(from, to), context);
  const view = context.quickActionsView();
  assert.equal((view.match(/class="quick-step-button/g) || []).length, 5);
  assert.doesNotMatch(view, /Три звонка с мощным дожимом/);
  assert.match(view, /💳/);
  assert.match(view, /⚡/);
  assert.match(view, /🤝/);
  assert.match(view, /1 шаг/);
  assert.match(view, /4 шага/);
  assert.match(view, /5 шагов/);
  assert.match(view, /Активность пока недоступна/);
  assert.doesNotMatch(view, /👟|Всего оплат|учтено дней|Всего кросс-сейлов|Дополнительные действия/);
  assert.doesNotMatch(view, /type="number"/);
  assert.equal((view.match(/onclick="requestQuickStep/g) || []).length, 5);
  assert.doesNotMatch(view, /onclick="creditQuickStep/);
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

test('confirmation button keeps its centered transform on hover', () => {
  assert.match(html, /\.quick-confirm:hover:not\(:disabled\)\{transform:translate\(-50%,-50%\)/);
});
