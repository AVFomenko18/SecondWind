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
  assert.equal(defaults.find(item => item.id === 'prize-1')?.name, 'Закончить день на час раньше');
  const stored = context.completeShop([
    { id: 'prize-0', name: 'Начать день на час позже', cost: 2, enabled: true },
    { id: 'prize-1', name: 'Закончить день на час раньше', cost: 2, enabled: true },
    { id: 'custom-bonus', name: 'Своя награда', cost: 3, enabled: true }
  ]);
  assert.equal(stored.some(item => item.id === 'prize-0'), false);
  assert.equal(stored.some(item => item.id === 'custom-bonus'), true);
});

test('new game and imported backup omit the removed prize', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const defaults = html.slice(html.indexOf('const DEFAULT_SHOP='), html.indexOf('function uid(){'));
  const migration = html.slice(html.indexOf('function renameCinemaPrize(s){'), html.indexOf('function addNewShopPrizes(game){'));
  assert.doesNotMatch(defaults, /Начать день на час позже/);
  assert.match(defaults, /id:'prize-'\+\(i\+1\)/);
  assert.match(migration, /prize\.id!=='prize-0'/);
});
