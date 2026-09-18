import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = html.indexOf('function sportIndex(p){');
const end = html.indexOf('function choosePlayer(i){', start);
assert.ok(start >= 0 && end > start);

function setup() {
  const player = { id: 'one', name: 'Оля', sport: 1 };
  const calls = [];
  const context = {
    state: { players: [player] }, SPORTS: Array.from({ length: 10 }, (_, i) => `Спорт ${i}`),
    num: (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max,
    pnow: () => player, writable: () => true, snapshot: () => calls.push('snapshot'),
    log: value => calls.push(value), commit: () => calls.push('commit'), toast: value => calls.push(value),
    createImageBitmap: async () => ({ width: 800, height: 600, close: () => calls.push('closed') }),
    document: { createElement: () => ({
      getContext: () => ({ clearRect() {}, drawImage() {} }),
      toDataURL: () => `data:image/webp;base64,${'A'.repeat(200)}`
    }) }
  };
  vm.createContext(context);
  vm.runInContext(html.slice(start, end), context);
  return { context, player, calls };
}

test('upload uses the selected image on the player and restores the built-in character on selection', async () => {
  const { context, player, calls } = setup();
  await context.uploadCharacterImage({ target: { files: [{ type: 'image/png', size: 200000 }] } });
  assert.match(player.avatar, /^data:image\/webp;base64,/);
  assert.match(context.playerAvatar(player, 'large'), /custom-avatar large/);
  assert.match(context.playerAvatar(player, 'large'), /data:image\/webp;base64/);
  assert.ok(calls.includes('commit'));
  context.changeSport(2);
  assert.equal(player.avatar, undefined);
  assert.equal(player.sport, 2);
  assert.match(context.playerAvatar(player), /sport-sprite/);
  assert.doesNotMatch(context.playerAvatar(player), /custom-avatar/);
});

test('unsupported and oversized files are rejected before saving', async () => {
  const { context, player, calls } = setup();
  await context.uploadCharacterImage({ target: { files: [{ type: 'image/svg+xml', size: 100 }] } });
  await context.uploadCharacterImage({ target: { files: [{ type: 'image/png', size: 11000000 }] } });
  assert.equal(player.avatar, undefined);
  assert.ok(!calls.includes('commit'));
});

test('character editor contains a file upload control', () => {
  const from = html.indexOf('function characterEditorView(p){');
  const to = html.indexOf('function teamView(){', from);
  assert.ok(from >= 0 && to > from);
  const context = { SPORTS: ['Бег'], sportIndex: () => 0, sprite: () => '<span></span>', esc: value => value };
  vm.createContext(context);
  vm.runInContext(html.slice(from, to), context);
  assert.match(context.characterEditorView({}), /type="file"/);
  assert.match(context.characterEditorView({}), /Добавить свою картинку/);
  assert.match(context.characterEditorView({ avatar: 'data:image/webp;base64,AAAA' }), /Вернуть стандартного персонажа/);
});
