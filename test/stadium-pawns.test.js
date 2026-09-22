import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('stadium pawns are larger and point to their track cell', () => {
  assert.match(page, /id="stadium-pawn-labels"/);
  assert.match(page, /\.stadium-loop \.field-pawn\{width:76px;height:84px;transform:translate\(-50%,-92%\)/);
  assert.match(page, /\.stadium-loop \.field-pawn \.sport-sprite\{width:72px;height:84px\}/);
  assert.match(page, /class="pawn-pointer" aria-hidden="true"/);
  assert.match(page, /\.pawn-pointer\{[^}]*border-top:14px solid var\(--player-color\)/);
});

test('stadium pawns show the manager name on two lines', () => {
  assert.match(page, /function pawnName\(name\)/);
  assert.match(page, /parts\.length>1\?esc\(parts\[0\]\)\+'<br>'\+esc\(parts\.slice\(1\)\.join\(' '\)\)/);
  assert.match(page, /<span class="pawn-name">\$\{pawnName\(p\.name\)\}<\/span>/);
  assert.match(page, /\.pawn-name\{[^}]*bottom:calc\(100% \+ 5px\)[^}]*text-align:center/);
});
