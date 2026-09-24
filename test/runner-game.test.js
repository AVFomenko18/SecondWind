import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { publicUpdateValid } from '../game-integrity.js';

const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const game = readFileSync(new URL('../runner-game.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../runner-game.css', import.meta.url), 'utf8');

test('run button opens the 30-second full-body robot runner with jump-only controls', () => {
  assert.match(page, /onclick="openRunnerGame\(\)"[^>]*>▶ Бежать/);
  assert.match(page, /id="runnerDialog"/);
  assert.doesNotMatch(page, /МИНИ-ИГРА · 30 СЕКУНД/);
  assert.doesNotMatch(page, /Робот на максимуме/);
  assert.match(page, /script src="runner-game\.js"/);
  assert.match(page, /href="runner-game\.css"/);
  assert.match(game, /RUNNER_DURATION_MS=30000/);
  assert.match(game, /'barrier':'ball'/);
  assert.match(game, /text:'🏀'/);
  assert.match(game, /RUNNER_GROUND_SPEED=380/);
  assert.match(game, /RUNNER_BALL_SPEED=145/);
  assert.match(game, /bottom:142/);
  assert.match(css, /\.runner-object\.barrier/);
  assert.match(css, /\.runner-robot-head[^}]+#a8eff7/);
  assert.match(page, /runner-robot-torso/);
  assert.match(page, /runner-robot-leg left/);
  assert.doesNotMatch(page, /runnerDuck/);
  assert.doesNotMatch(page, /Пригнуться/);
  assert.doesNotMatch(page, /стрелка вниз/);
  assert.doesNotMatch(game, /ArrowDown/);
  assert.match(game, /runnerSessionActive=true/);
  assert.match(game, /miniRunner=null;runnerSessionActive=false/);
});

test('runner has no track coins and one large bonus coin after the finish', () => {
  assert.doesNotMatch(game, /RUNNER_MAX_COINS/);
  assert.doesNotMatch(game, /kind:'coin'/);
  assert.match(game, /kind:'finish',arrival:28800/);
  assert.match(game, /kind:'finish-coin',arrival:29700/);
  assert.match(css, /\.runner-object\.finish\{/);
  assert.match(css, /\.runner-object\.finish-coin\{/);
  assert.match(game, /finishRunnerGame\(true\)/);
  assert.match(page, /source==='runner'/);
  assert.match(page, /'Финиш мини-игры'/);
  assert.match(page, /Math\.min\(1,Number\.isSafeInteger\(runnerResult\.collected\)/);
  assert.match(page, /\(\?:coin-\[1-3\]\|finish\)/);
  assert.match(page, /Большая монета ждёт сразу за финишем/);
  assert.match(css, /runner-track-rush\{to\{transform:translateX\(-92px\)\}/);
});

test('procedural hazards are fixed before the run and always leave a fair jump gap', () => {
  const start=game.indexOf('function createRunnerCourse(){'),end=game.indexOf('\nfunction spawnRunnerObject(',start);
  const context={Math};vm.createContext(context);
  vm.runInContext('const RUNNER_HAZARD_GAP_MS=3000;'+game.slice(start,end),context);
  for(let run=0;run<100;run++){
    const course=context.createRunnerCourse(),hazards=course.filter(item=>item.kind==='barrier'||item.kind==='ball');
    assert.equal(course.filter(item=>item.kind==='coin').length,0);
    assert.equal(course.filter(item=>item.kind==='finish').length,1);
    assert.equal(course.filter(item=>item.kind==='finish-coin').length,1);
    for(let i=1;i<hazards.length;i++)assert.ok(hazards[i].arrival-hazards[i-1].arrival>=3000);
  }
  assert.match(game, /placeRunnerCourse\(\)/);
  assert.doesNotMatch(game, /nextObstacleAt/);
});

test('a public run may append bounded runner rewards only together with movement', () => {
  const player = { id: 'p1', name: 'Оля', salesName: 'Оля', color: '#286653', sport: 0, pos: 0, high: 0,
    bank: 5, cash: 0, cashBase: 0, calls: 0, cross: 0, shields: 0, used: [], actionCounts: {} };
  const before = { version: 3, id: 'game', updated: '2026-09-24T10:00:00.000Z', config: { actions: [] },
    players: [player], ledger: [], rewards: [], logs: [], undo: null };
  const moved = { ...player, pos: 5, high: 5, bank: 0 };
  const at = '2026-09-24T10:01:00.000Z';
  const entry = suffix => ({ id: 'entry-'+suffix, playerId: 'p1', amount: 1, source: 'runner', ref: 'runner-abc-'+suffix, title: 'Мини-игра', at });
  const after = structuredClone(before);after.updated=at;after.players=[moved];after.ledger=[entry('coin-1'),entry('finish')];
  after.logs=[{ id:'log-1', at, text:'Оля: мини-игра', reverse:{kind:'patch',ops:[
    {kind:'set',path:['players',0,'pos'],value:0},{kind:'set',path:['players',0,'high'],value:0},
    {kind:'set',path:['players',0,'bank'],value:5},{kind:'length',path:['ledger'],length:0}
  ]}}];
  assert.equal(publicUpdateValid(before, after), true);
  const forged = structuredClone(after);forged.players=[player];
  assert.equal(publicUpdateValid(before, forged), false);
  const tooMany = structuredClone(after);tooMany.ledger.push(entry('coin-2'));
  assert.equal(publicUpdateValid(before, tooMany), false);
  const twoRuns = structuredClone(after);twoRuns.ledger[1]={...twoRuns.ledger[1],ref:'runner-other-finish'};
  assert.equal(publicUpdateValid(before, twoRuns), false);
});
