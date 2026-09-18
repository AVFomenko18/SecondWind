import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, parseRevenue, revenueFromCsv, revenueForPlayer, revenueForTeam } from '../revenue.js';

test('public rating CSV maps monthly revenue to the correct team and manager', () => {
  const csv = '\ufeffРОП,РГ,Менеджер,Грейд,Выручка\r\n'
    + 'Кобзев Александр,Фоменко Александр,Дубровина Ольга,,"1 234 567"\r\n'
    + 'Кобзев Александр,Фоменко Александр,Костюк Матвей,,"45 000"\r\n'
    + 'Кобзев Александр,Клементович Денис,Яловегин Николай,,"200 000"\r\n';
  const groups = revenueFromCsv(csv);
  assert.equal(revenueForTeam(groups, 'fomenko'), 1279567);
  assert.equal(revenueForPlayer(groups, 'fomenko', 'Ольга Дубровина'), 1234567);
  assert.equal(revenueForPlayer(groups, 'fomenko', 'Оля'), 1234567);
  assert.equal(revenueForPlayer(groups, 'fomenko', 'Матвей'), 45000);
  assert.equal(revenueForTeam(groups, 'klimentovich'), 200000);
  assert.equal(revenueForTeam(groups, 'tolstov'), null);
  assert.equal(revenueForPlayer(groups, 'fomenko', 'Николай Яловегин'), null);
});

test('CSV quoting and ambiguous names never assign someone else’s revenue', () => {
  assert.deepEqual(parseCsv('A,B\n"Иванов, Иван",100\n'), [['A', 'B'], ['Иванов, Иван', '100']]);
  assert.equal(parseRevenue('2 061 884'), 2061884);
  assert.equal(parseRevenue('0,29'), 0.29);
  assert.equal(parseRevenue('1 234,56'), 1234.56);
  assert.equal(parseRevenue('нет данных'), null);
  const groups = { 'Фоменко Александр': [{ name: 'Иванова Ольга', revenue: 100 }, { name: 'Петрова Ольга', revenue: 200 }] };
  assert.equal(revenueForPlayer(groups, 'fomenko', 'Ольга'), null);
});
