'use strict';

const RUNNER_DURATION_MS=30000;
const RUNNER_COUNTDOWN_MS=2400;
const RUNNER_GROUND_SPEED=440;
const RUNNER_BALL_SPEED=155;
const RUNNER_HAZARD_GAP_MS=1350;
const RUNNER_LIVES=2;
let miniRunner=null;

function openRunnerGame(){
  if(!writable())return;
  const player=pnow(),steps=Math.floor(player?.bank||0);
  if(!player)return toast('Выберите игрока');
  if(steps<5)return toast(`Мини-игра доступна от 5 шагов. Сейчас накоплено ${String(player.bank||0).replace('.',',')}.`);
  if(miniRunner?.active)return;
  runnerSessionActive=true;
  const dialog=document.getElementById('runnerDialog'),track=document.getElementById('runnerTrack'),now=performance.now();
  track.querySelectorAll('.runner-object').forEach(node=>node.remove());
  miniRunner={active:true,playerId:player.id,steps,id:'runner-'+uid(),countdownUntil:now+RUNNER_COUNTDOWN_MS,startedAt:0,lastFrame:now,y:0,velocity:0,lives:RUNNER_LIVES,collected:0,objects:[],invulnerableUntil:0,animation:0};
  document.getElementById('runnerTime').textContent='30';
  document.getElementById('runnerCoins').textContent='0';
  document.getElementById('runnerLives').textContent='♥'.repeat(RUNNER_LIVES);
  document.getElementById('runnerResult').hidden=true;
  const countdown=document.getElementById('runnerCountdown');countdown.hidden=false;countdown.textContent='3';
  const robot=document.getElementById('runnerRobot');robot.className='runner-robot';robot.style.bottom='23px';
  if(!dialog.open)dialog.showModal();
  track.focus();
  addEventListener('keydown',runnerKeyDown);
  miniRunner.animation=requestAnimationFrame(runnerFrame);
}

function runnerKeyDown(event){
  if(!miniRunner?.active)return;
  if(['Space','ArrowUp'].includes(event.code))event.preventDefault();
  if(event.code==='Space'||event.code==='ArrowUp')runnerJump();
}
function runnerJump(){if(!miniRunner?.active||miniRunner.startedAt===0||miniRunner.y>1)return;miniRunner.velocity=720}

function createRunnerCourse(){
  const events=[];
  let arrival=2100+Math.random()*400,block=[];
  while(arrival<27100){
    if(!block.length)block=['barrier','barrier','barrier','ball','ball','ball'].sort(()=>Math.random()-.5);
    events.push({kind:block.pop(),arrival});
    arrival+=RUNNER_HAZARD_GAP_MS+Math.random()*250;
  }
  events.push({kind:'finish',arrival:28800},{kind:'finish-coin',arrival:29700});
  return events.sort((a,b)=>a.arrival-b.arrival);
}

function spawnRunnerObject(kind,arrival){
  if(!miniRunner?.active)return;
  const track=document.getElementById('runnerTrack'),element=document.createElement('span');
  const settings=kind==='barrier'?{bottom:23,width:30,height:45,text:'',speed:RUNNER_GROUND_SPEED}:
    kind==='ball'?{bottom:142,width:38,height:38,text:'🏀',speed:RUNNER_BALL_SPEED}:
    kind==='finish'?{bottom:23,width:24,height:215,text:'',speed:RUNNER_GROUND_SPEED}:
    {bottom:48,width:68,height:68,text:'₽',speed:RUNNER_GROUND_SPEED};
  element.className='runner-object '+kind;element.textContent=settings.text;track.append(element);
  const robotLeft=Math.max(36,track.clientWidth*.09),item={kind,element,x:robotLeft+settings.speed*arrival/1000,...settings};
  element.style.bottom=settings.bottom+'px';element.style.left=item.x+'px';
  miniRunner.objects.push(item);
}

function placeRunnerCourse(){for(const event of createRunnerCourse())spawnRunnerObject(event.kind,event.arrival)}

function runnerOverlap(item){
  const robotLeft=Math.max(36,document.getElementById('runnerTrack').clientWidth*.09),robotRight=robotLeft+58;
  if(item.x>robotRight||item.x+item.width<robotLeft)return false;
  const robotBottom=23+miniRunner.y,robotTop=robotBottom+88;
  return item.bottom<robotTop&&item.bottom+item.height>robotBottom;
}

function runnerFrame(now){
  const game=miniRunner;if(!game?.active)return;
  const countdown=document.getElementById('runnerCountdown');
  if(!game.startedAt){
    const left=game.countdownUntil-now;
    if(left>0){countdown.textContent=String(Math.max(1,Math.ceil(left/800)));game.lastFrame=now;game.animation=requestAnimationFrame(runnerFrame);return}
    countdown.textContent='БЕГИ!';setTimeout(()=>{if(countdown)countdown.hidden=true},380);game.startedAt=now;game.lastFrame=now;placeRunnerCourse();
  }
  const elapsed=now-game.startedAt,delta=Math.min(.04,(now-game.lastFrame)/1000);game.lastFrame=now;
  document.getElementById('runnerTime').textContent=String(Math.max(0,Math.ceil((RUNNER_DURATION_MS-elapsed)/1000)));
  game.velocity-=1800*delta;game.y=Math.max(0,game.y+game.velocity*delta);if(game.y===0&&game.velocity<0)game.velocity=0;
  document.getElementById('runnerRobot').style.bottom=(23+game.y)+'px';
  for(const item of game.objects){
    if(item.removed)continue;item.x-=item.speed*delta;item.element.style.left=item.x+'px';
    if(runnerOverlap(item)){
      if(item.kind==='finish-coin'){
        item.removed=true;document.getElementById('runnerCoins').textContent=String(game.collected+1);item.element.classList.add('collected');setTimeout(()=>item.element.remove(),300);
      }else if((item.kind==='barrier'||item.kind==='ball')&&now>=game.invulnerableUntil){
        item.removed=true;item.element.remove();game.lives--;game.invulnerableUntil=now+1100;document.getElementById('runnerLives').textContent='♥'.repeat(game.lives)+'♡'.repeat(RUNNER_LIVES-game.lives);const robot=document.getElementById('runnerRobot');robot.classList.add('hit');setTimeout(()=>robot?.classList.remove('hit'),850);if(game.lives<=0){finishRunnerGame(false);return}
      }
    }
    if(item.x+item.width<0){item.removed=true;item.element.remove()}
  }
  game.objects=game.objects.filter(item=>!item.removed);
  if(elapsed>=RUNNER_DURATION_MS){finishRunnerGame(true);return}
  game.animation=requestAnimationFrame(runnerFrame);
}

function finishRunnerGame(finished){
  const game=miniRunner;if(!game?.active)return;
  game.active=false;cancelAnimationFrame(game.animation);removeEventListener('keydown',runnerKeyDown);
  const total=game.collected+(finished?1:0),result=document.getElementById('runnerResult');
  result.hidden=false;result.innerHTML='<strong>'+(finished?'Финиш! 🏁':'Забег завершён')+'</strong><span>'+(finished?'Большая монета за финишем: +1 мон.':'До большой монеты за финишем добежать не удалось.')+'</span><button type="button" onclick="completeRunnerGame('+(finished?'true':'false')+')">Продолжить ход · +'+total+' мон.</button>';
}

function completeRunnerGame(finished){
  const game=miniRunner;if(!game)return;
  const player=state.players.find(item=>item.id===game.playerId),dialog=document.getElementById('runnerDialog');
  dialog.close();miniRunner=null;runnerSessionActive=false;
  if(!player)return toast('Участник больше не найден.');
  selected=player.id;movePlayerWithBonus(game.steps,{id:game.id,collected:game.collected,finished:Boolean(finished)});
}

function skipRunnerGame(){
  const game=miniRunner;if(!game){runnerSessionActive=false;return document.getElementById('runnerDialog')?.close()}
  if(game.active){game.active=false;cancelAnimationFrame(game.animation);removeEventListener('keydown',runnerKeyDown)}
  const player=state.players.find(item=>item.id===game.playerId),dialog=document.getElementById('runnerDialog');dialog.close();miniRunner=null;runnerSessionActive=false;
  if(player){selected=player.id;movePlayer(game.steps)}
}
