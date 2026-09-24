'use strict';

let backpackPlayerId='';

function backpackPlayer(){return state.players.find(player=>player.id===backpackPlayerId)}
function backpackMiniRewards(player){return state.rewards.filter(reward=>reward.playerId===player?.id&&reward.miniPrize===true&&!reward.cancelled)}
function backpackGroups(player){
  const groups=new Map();
  for(const reward of backpackMiniRewards(player).filter(reward=>reward.exchanged!==true)){
    const key=reward.prizeId||'title:'+reward.title;
    if(!groups.has(key))groups.set(key,{key,prizeId:reward.prizeId,title:reward.title,rewards:[]});
    groups.get(key).rewards.push(reward);
  }
  return [...groups.values()].sort((a,b)=>b.rewards.length-a.rewards.length||a.title.localeCompare(b.title,'ru'));
}
function backpackPrizeIcon(group){return caseCatalog?.miniPrizes?.find(item=>item.id===group.prizeId)?.icon||'🎁'}
function backpackButtonView(player){return `<button type="button" class="backpack-button" title="Открыть рюкзак" aria-label="Открыть рюкзак ${esc(player.name)}" onclick="openBackpackForSelected()">🎒</button>`}
function openBackpackForSelected(){let player=pnow();if(player)openBackpack(player.id)}

function openBackpack(playerId){
  const player=state.players.find(item=>item.id===playerId);if(!player)return;
  backpackPlayerId=player.id;renderBackpack();
  const dialog=document.getElementById('backpackDialog');if(!dialog.open)dialog.showModal();
  if(!caseCatalog?.miniPrizes?.length)void loadCaseCatalog().then(()=>{if(dialog.open&&backpackPlayerId===player.id)renderBackpack()});
}
function closeBackpack(){backpackPlayerId='';const dialog=document.getElementById('backpackDialog');if(dialog?.open)dialog.close()}

function renderBackpack(){
  const player=backpackPlayer(),body=document.getElementById('backpackBody'),title=document.getElementById('backpackTitle');if(!body||!title)return;
  if(!player){title.textContent='Рюкзак';body.innerHTML='<div class="backpack-empty">Участник не найден.</div>';return}
  title.textContent='Рюкзак · '+player.name;
  const groups=backpackGroups(player);
  const items=groups.map((group,index)=>{
    const count=group.rewards.length,ready=count>=3,tag=ready?'button':'article';
    return `<${tag} class="backpack-item ${ready?'exchange-ready':''}" ${ready?`type="button" onclick="exchangeMiniPrizes(${index},event)" aria-label="Обменять три мини-приза ${esc(group.title)} на одну монету"`:''}><span class="backpack-item-art"><span class="backpack-item-icon" aria-hidden="true">${esc(backpackPrizeIcon(group))}</span>${ready?'<span class="backpack-gold-coin" aria-hidden="true">₽</span>':''}</span><strong>${esc(group.title)}</strong><b>×${count}</b><small>${ready?'Нажмите, чтобы обменять 3 на 1 монету':'Нужно ещё '+(3-count)}</small></${tag}>`;
  }).join('');
  const history=backpackMiniRewards(player).slice().sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)).map(reward=>`<li><span>${esc(caseCatalog?.miniPrizes?.find(item=>item.id===reward.prizeId)?.icon||'🎁')}</span><div><strong>${esc(reward.title)}</strong><small>${esc(new Date(reward.at).toLocaleString('ru-RU'))} · ${reward.exchanged?'обменян на монету':'в рюкзаке'}</small></div></li>`).join('');
  body.innerHTML='<p class="backpack-rule"><span aria-hidden="true">🪙</span> Три одинаковых мини-приза можно обменять на одну монету.</p><div class="backpack-grid">'+(items||'<div class="backpack-empty">Мини-призов пока нет.</div>')+'</div><section class="backpack-history"><h3>История мини-призов</h3><ul>'+(history||'<li class="backpack-empty">История пока пуста.</li>')+'</ul></section>';
}

function exchangeMiniPrizes(groupIndex,event){
  if(!writable())return;
  const player=backpackPlayer(),group=backpackGroups(player)[groupIndex];if(!player||!group||group.rewards.length<3)return;
  if(!confirm(`Обменять три мини-приза «${group.title}» на одну монету?`))return;
  const anchor=actionAnchor(event),at=new Date().toISOString(),exchangeId='exchange-'+uid();snapshot();
  for(const reward of group.rewards.slice(0,3)){reward.exchanged=true;reward.exchangedAt=at;reward.exchangeId=exchangeId}
  award(player,1,'exchange',exchangeId,'Обмен 3 мини-призов: '+group.title);
  log(`${player.name}: обменял(а) 3 мини-приза «${group.title}» на 1 монету.`);commit();renderBackpack();showEarnedPop(1,'coin',anchor);toast(`${player.name}: +1 монета за обмен мини-призов`);
}
