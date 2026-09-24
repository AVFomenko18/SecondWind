'use strict';

const RUNNER_DURATION_MS=30000;
const RUNNER_COUNTDOWN_MS=2400;
const RUNNER_MAX_COINS=3;
let miniRunner=null;

function openRunnerGame(){
  if(!writable())return;
  const player=pnow(),steps=Math.floor(player?.bank||0);
  if(!player)return toast('Выберите игрока');
  if(steps<1)return toast(player.bank===.5?'Накоплено 0,5 шага. Для хода нужен 1 целый шаг.':'Сначала заработайте шаги.');
  if(miniRunner?.active)return;
  const dialog=document.getElementById('runnerDialog'),track=document.getElementById('runnerTrack'),now=performance.now();
  track.querySelectorAll('.runner-object').forEach(node=>node.remove());
  miniRunner={active:true,playerId:player.id,steps,id:'runner-'+uid(),countdownUntil:now+RUNNER_COUNTDOWN_MS,startedAt:0,lastFrame:now,nextObstacleAt:0,nextCoinAt:7000,y:0,velocity:0,duck:false,lives:3,collected:0,objects:[],invulnerableUntil:0,animation:0};
  document.getElementById('runnerTime').textContent='30';
  document.getElementById('runnerCoins').textContent='0';
  document.getElementById('runnerLives').textContent='♥♥♥';
  document.getElementById('runnerResult').hidden=true;
  const countdown=document.getElementById('runnerCountdown');countdown.hidden=false;countdown.textContent='3';
  const robot=document.getElementById('runnerRobot');robot.className='runner-robot';robot.style.bottom='23px';
  if(!dialog.open)dialog.showModal();
  track.focus();
  addEventListener('keydown',runnerKeyDown);
  addEventListener('keyup',runnerKeyUp);
  miniRunner.animation=requestAnimationFrame(runnerFrame);
}

function runnerKeyDown(event){
  if(!miniRunner?.active)return;
  if(['Space','ArrowUp','ArrowDown'].includes(event.code))event.preventDefault();
  if(event.code==='Space'||event.code==='ArrowUp')runnerJump();
  if(event.code==='ArrowDown')runnerDuck(true);
}
function runnerKeyUp(event){if(event.code==='ArrowDown')runnerDuck(false)}
function runnerJump(){if(!miniRunner?.active||miniRunner.startedAt===0||miniRunner.y>1)return;miniRunner.velocity=720;runnerDuck(false)}
function runnerDuck(active){if(!miniRunner?.active)return;miniRunner.duck=Boolean(active)&&miniRunner.y<8;document.getElementById('runnerRobot')?.classList.toggle('duck',miniRunner.duck)}

function spawnRunnerObject(kind){
  if(!miniRunner?.active)return;
  const track=document.getElementById('runnerTrack'),element=document.createElement('span');
  const settings=kind==='barrier'?{bottom:23,width:30,height:45,text:''}:kind==='ball'?{bottom:66,width:36,height:36,text:'🏀'}:{bottom:Math.random()<.5?34:88,width:34,height:34,text:'₽'};
  element.className='runner-object '+kind;element.textContent=settings.text;track.append(element);
  const item={kind,element,x:track.clientWidth+30,...settings};
  element.style.bottom=settings.bottom+'px';element.style.transform='translateX('+item.x+'px)';
  miniRunner.objects.push(item);
}

function runnerOverlap(item){
  const robotLeft=Math.max(36,document.getElementById('runnerTrack').clientWidth*.09),robotRight=robotLeft+50;
  if(item.x>robotRight||item.x+item.width<robotLeft)return false;
  const robotBottom=23+miniRunner.y,robotTop=robotBottom+(miniRunner.duck?35:62);
  return item.bottom<robotTop&&item.bottom+item.height>robotBottom;
}

function runnerFrame(now){
  const game=miniRunner;if(!game?.active)return;
  const countdown=document.getElementById('runnerCountdown');
  if(!game.startedAt){
    const left=game.countdownUntil-now;
    if(left>0){countdown.textContent=String(Math.max(1,Math.ceil(left/800)));game.lastFrame=now;game.animation=requestAnimationFrame(runnerFrame);return}
    countdown.textContent='БЕГИ!';setTimeout(()=>{if(countdown)countdown.hidden=true},380);game.startedAt=now;game.lastFrame=now;game.nextObstacleAt=900;
  }
  const elapsed=now-game.startedAt,delta=Math.min(.04,(now-game.lastFrame)/1000);game.lastFrame=now;
  document.getElementById('runnerTime').textContent=String(Math.max(0,Math.ceil((RUNNER_DURATION_MS-elapsed)/1000)));
  game.velocity-=1800*delta;game.y=Math.max(0,game.y+game.velocity*delta);if(game.y===0&&game.velocity<0)game.velocity=0;
  if(game.y>8)runnerDuck(false);
  document.getElementById('runnerRobot').style.bottom=(23+game.y)+'px';
  if(elapsed>=game.nextObstacleAt){spawnRunnerObject(Math.random()<.56?'barrier':'ball');game.nextObstacleAt=elapsed+1050+Math.random()*650}
  if(game.collected<RUNNER_MAX_COINS&&elapsed>=game.nextCoinAt){spawnRunnerObject('coin');game.nextCoinAt+=9000}
  const speed=260+elapsed/180;
  for(const item of game.objects){
    if(item.removed)continue;item.x-=speed*delta;item.element.style.transform='translateX('+item.x+'px)';
    if(runnerOverlap(item)){
      if(item.kind==='coin'){
        item.removed=true;game.collected++;document.getElementById('runnerCoins').textContent=String(game.collected);item.element.classList.add('collected');setTimeout(()=>item.element.remove(),300);
      }else if(now>=game.invulnerableUntil){
        item.removed=true;item.element.remove();game.lives--;game.invulnerableUntil=now+1300;document.getElementById('runnerLives').textContent='♥'.repeat(game.lives)+'♡'.repeat(3-game.lives);const robot=document.getElementById('runnerRobot');robot.classList.add('hit');setTimeout(()=>robot?.classList.remove('hit'),950);if(game.lives<=0){finishRunnerGame(false);return}
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
  game.active=false;cancelAnimationFrame(game.animation);removeEventListener('keydown',runnerKeyDown);removeEventListener('keyup',runnerKeyUp);game.duck=false;document.getElementById('runnerRobot')?.classList.remove('duck');
  const total=game.collected+(finished?1:0),result=document.getElementById('runnerResult');
  result.hidden=false;result.innerHTML='<strong>'+(finished?'Финиш! 🏁':'Забег завершён')+'</strong><span>Собрано на трассе: '+game.collected+' мон.<br>'+(finished?'Бонус за финиш: +1 мон.':'Бонус за финиш не получен.')+'</span><button type="button" onclick="completeRunnerGame('+(finished?'true':'false')+')">Продолжить ход · +'+total+' мон.</button>';
}

function completeRunnerGame(finished){
  const game=miniRunner;if(!game)return;
  const player=state.players.find(item=>item.id===game.playerId),dialog=document.getElementById('runnerDialog');
  dialog.close();miniRunner=null;
  if(!player)return toast('Участник больше не найден.');
  selected=player.id;movePlayerWithBonus(game.steps,{id:game.id,collected:game.collected,finished:Boolean(finished)});
}

function skipRunnerGame(){
  const game=miniRunner;if(!game)return document.getElementById('runnerDialog')?.close();
  if(game.active){game.active=false;cancelAnimationFrame(game.animation);removeEventListener('keydown',runnerKeyDown);removeEventListener('keyup',runnerKeyUp)}
  const player=state.players.find(item=>item.id===game.playerId),dialog=document.getElementById('runnerDialog');dialog.close();miniRunner=null;
  if(player){selected=player.id;movePlayer(game.steps)}
}
