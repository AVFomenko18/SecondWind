import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import vm from 'node:vm';

const source = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const context = { isDeepStrictEqual, INITIAL_SUPER_PRIZE_LIMITS: { 'prize-super': 5 } };
vm.createContext(context);
const guardStart = source.indexOf('function protectedChange(before, after) {');
const guardEnd = source.indexOf('\nfunction canonicalJson(', guardStart);
const stockStart = source.indexOf('function countedReward(reward) {');
const stockEnd = source.indexOf('\nconst pool =', stockStart);
assert.ok(guardStart >= 0 && guardEnd > guardStart && stockStart >= 0 && stockEnd > stockStart);
vm.runInContext(source.slice(guardStart, guardEnd) + '\n' + source.slice(stockStart, stockEnd), context);

test('delete controls are in the manager roster, not the public team list', () => {
  const publicTeam = page.slice(page.indexOf('function teamView(){'), page.indexOf('function ', page.indexOf('function teamView(){') + 1));
  assert.ok(!publicTeam.includes('deletePlayer('));
  assert.ok(page.includes("['roster','Состав команды']"));
  assert.ok(page.includes('function settingsRosterView(){'));
  assert.ok(page.includes("if(!settingsOpen||settingsSection!=='roster'||!adminWrite())return;"));
});

test('settings open above the current page and the cross ends the manager session', () => {
  assert.ok(page.includes('<dialog id="settingsDialog"'));
  assert.ok(page.includes('body.innerHTML=settingsView();if(!dialog.open)dialog.showModal()'));
  assert.ok(page.includes("if(id==='settings'){if(settingsOpen)return;settingsOpen=true;renderSettingsModal();void checkAdmin();void loadActionCredits();return}"));
  const closeSettings = page.slice(page.indexOf('async function closeSettings(){'), page.indexOf('\nasync function openGameTab('));
  assert.ok(closeSettings.includes('if(await adminLogout(false)===false)return false;'));
  assert.ok(closeSettings.includes('await clearRewardAccess();settingsOpen=false;'));
  assert.ok(page.includes('oncancel="event.preventDefault();closeSettings()"'));
});

test('each player deletion requires the manager session, including consecutive deletions', () => {
  const alice = { id: 'alice' }, boris = { id: 'boris' };
  const oldLog = { text: 'Старая запись' };
  const firstLog = { text: 'Удалена Алиса' };
  const before = { id: 'period', config: {}, players: [alice, boris], logs: [oldLog], ledger: [
    { playerId: 'alice', source: 'challenge', amount: 2 },
    { playerId: 'boris', source: 'manual', amount: 1 }
  ] };
  const afterFirst = { ...before, players: [boris], logs: [firstLog, oldLog], ledger: [before.ledger[1]] };
  const afterSecond = { ...afterFirst, players: [], logs: [{ text: 'Удалён Борис' }, firstLog, oldLog], ledger: [] };
  assert.equal(context.protectedChange(before, afterFirst), true);
  assert.equal(context.protectedChange(afterFirst, afterSecond), true);
});

test('awards of a remaining player stay protected', () => {
  const before = { id: 'period', config: {}, players: [{ id: 'alice' }, { id: 'boris' }], logs: [], ledger: [
    { playerId: 'alice', source: 'challenge', amount: 2 },
    { playerId: 'boris', source: 'manual', amount: 1 }
  ] };
  const after = { ...before, players: [{ id: 'boris' }], ledger: [{ playerId: 'boris', source: 'manual', amount: 99 }] };
  assert.equal(context.protectedChange(before, after), true);
});

test('deleting a manager does not return an opened case super prize to stock', () => {
  const reward = { id: 'case-1', prizeId: 'prize-super', playerId: 'alice', superPrize: true, case: true, cancelled: false };
  assert.equal(context.inventoryChanges({ id: 'period', rewards: [reward] }, { id: 'period', rewards: [] }, ['prize-super'])['prize-super'], 0);
  const oldPurchase = { ...reward, id: 'old-1', case: false };
  assert.equal(context.inventoryChanges({ id: 'period', rewards: [oldPurchase] }, { id: 'period', rewards: [] }, ['prize-super'])['prize-super'], -1);
});
