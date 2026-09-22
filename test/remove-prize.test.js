import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('removed prize is absent from new and previously saved department catalogs', () => {
  const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  const start = server.indexOf('const NEW_SHOP_PRIZES =');
  const end = server.indexOf('const DEFAULT_RULES =', start);
  assert.ok(start >= 0 && end > start);
  const context = {};
  vm.createContext(context);
  vm.runInContext(`${server.slice(start, end)}\nthis.completeShop = completeShop;`, context);
  const defaults = context.completeShop();
  assert.equal(defaults.some(item => item.id === 'prize-0'), false);
  assert.equal(defaults.some(item => item.id === 'prize-20'), false);
  assert.equal(defaults.find(item => item.id === 'prize-1')?.name, 'Закончить день на 30 минут раньше');
  assert.equal(defaults.find(item => item.id === 'prize-6')?.name, 'Отказаться от двух лидов');
  assert.equal(defaults.find(item => item.id === 'prize-7')?.name, '+1 курс в распределение');
  assert.equal(defaults.find(item => item.id === 'prize-24')?.name, 'Индивидуальная плашка в чате продаж');
  assert.equal(defaults.find(item => item.id === 'prize-25')?.name, 'Индивидуальная отбивка при продажах');
  assert.equal(defaults.find(item => item.id === 'prize-25')?.cost, 2);
  const stored = context.completeShop([
    { id: 'prize-0', name: 'Начать день на час позже', cost: 2, enabled: true },
    { id: 'prize-1', name: 'Закончить день на час раньше', cost: 2, enabled: true },
    { id: 'custom-bonus', name: 'Своя награда', cost: 3, enabled: true }
  ]);
  assert.equal(stored.some(item => item.id === 'prize-0'), false);
  assert.equal(stored.some(item => item.id === 'custom-bonus'), true);
  assert.equal(stored.find(item => item.id === 'prize-1')?.name, 'Закончить день на 30 минут раньше');
  const food = stored.find(item => item.id === 'prize-23');
  assert.equal(food?.name, 'Доставка еды от босса');
  assert.equal(food?.cost, 7);
  assert.equal(food?.superPrize, true);
  assert.equal(food?.stockLimit, 10);
  assert.equal(defaults.find(item => item.id === 'prize-8')?.stockLimit, 10);
  assert.equal(defaults.find(item => item.id === 'prize-9')?.stockLimit, 10);
  assert.equal(defaults.find(item => item.id === 'prize-21')?.stockLimit, 6);
});

test('new game and imported backup omit the removed prize', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const defaults = html.slice(html.indexOf('const DEFAULT_SHOP='), html.indexOf('function uid(){'));
  const migration = html.slice(html.indexOf('function renameCinemaPrize(s){'), html.indexOf('function addNewShopPrizes(game){'));
  assert.doesNotMatch(defaults, /Начать день на час позже/);
  assert.doesNotMatch(defaults, /Дополнительный выходной/);
  assert.match(defaults, /id:'prize-'\+\(i\+1\)/);
  assert.match(defaults, /Закончить день на 30 минут раньше/);
  assert.match(defaults, /Отказаться от двух лидов/);
  assert.match(defaults, /\+1 курс в распределение/);
  assert.match(html, /Индивидуальная плашка в чате продаж/);
  assert.match(html, /Индивидуальная отбивка при продажах/);
  assert.match(migration, /prize\.id!=='prize-0'/);
  assert.match(migration, /prize\.id!=='prize-20'/);
  assert.match(migration, /Закончить день на 30 минут раньше/);
  assert.match(migration, /Отказаться от двух лидов/);
  assert.match(migration, /\+1 курс в распределение/);
  assert.match(migration, /Индивидуальная плашка в чате продаж/);
});
