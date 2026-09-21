import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSalesNotification, startsNewPeriod } from '../telegram-actions.js';

test('parses different payment event wording and ignores revenue footer', () => {
  for (const phrase of ['занёс доплату', 'занес оплату', 'внесла предоплату', 'провела полную оплату']) {
    const parsed = parseSalesNotification(`💰 Шеханова Лилия ${phrase} за курс «ИИ-сметчик» за 30 650 рублей из канала hh.\n\n🏆 Выручка за сегодня: 2 571 348 руб.`);
    assert.equal(parsed?.kind, 'cashLow');
    assert.equal(parsed?.managerName, 'Шеханова Лилия');
    assert.equal(parsed?.amount, 30650);
  }
});

test('cross-sale remains a separate event regardless of its amount', () => {
  const parsed = parseSalesNotification('💰 Качетова Даяна занёс кросс-сейл за курс «Нейросети: тариф PRO» за 30 000 рублей из канала yandex.\n\n🏆 Выручка за сегодня: 1 872 530 руб.');
  assert.equal(parsed?.kind, 'cross');
  assert.equal(parsed?.type, 'cross');
  assert.equal(parsed?.amount, 30000);
});

test('unknown events do not unlock actions', () => {
  assert.equal(parseSalesNotification('Иванова Анна отменила договор за 70 000 рублей.'), null);
  assert.equal(parseSalesNotification('Иванова Анна занесла возврат за курс за 70 000 рублей.'), null);
});

test('new event labels are treated as payments without parser changes', () => {
  const parsed = parseSalesNotification('Иванова Анна внесла первый взнос за курс за 70 000 рублей.');
  assert.equal(parsed?.eventType, 'первый взнос');
  assert.equal(parsed?.kind, 'cashMid');
});

test('pending Telegram actions reset only when a saved team starts a new period', () => {
  assert.equal(startsNewPeriod({ id: 'period-1' }, { id: 'period-2' }), true);
  assert.equal(startsNewPeriod({ id: 'period-1' }, { id: 'period-1' }), false);
  assert.equal(startsNewPeriod({}, { id: 'period-1' }), false);
});

test('period reset and deployment cleanup invalidate payment credits without removing cross-sales', () => {
  const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  assert.match(server, /reset-pending-payment-credits/);
  assert.match(server, /action_kind IN \('cashLow','cashMid','cashHigh'\)/);
  assert.doesNotMatch(server, /SET status = 'expired'/);
});
