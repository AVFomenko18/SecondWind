import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { miniPrizeExchangeUpdateValid } from '../game-integrity.js';

const page=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const script=readFileSync(new URL('../backpack.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../backpack.css',import.meta.url),'utf8');

function exchangeStates(){
  const at='2026-09-24T14:00:00.000Z',reward=index=>({id:'mini-'+index,playerId:'p1',prizeId:'mini-garlic',title:'Чеснок',cost:2,source:'shop',case:true,miniPrize:true,souvenir:true,claimed:false,cancelled:false,at});
  const before={version:3,id:'game',updated:at,undo:null,config:{},players:[{id:'p1',name:'Оля'}],rewards:[reward(1),reward(2),reward(3)],ledger:[],logs:[]};
  const after=structuredClone(before),exchangeAt='2026-09-24T15:00:00.000Z',exchangeId='exchange-abc-123';after.updated=exchangeAt;
  for(const item of after.rewards){item.exchanged=true;item.exchangedAt=exchangeAt;item.exchangeId=exchangeId}
  after.ledger.push({id:'ledger-1',playerId:'p1',amount:1,source:'exchange',ref:exchangeId,title:'Обмен 3 мини-призов: Чеснок',at:exchangeAt});
  const ops=[];for(let index=0;index<3;index++)for(const key of ['exchanged','exchangedAt','exchangeId'])ops.push({kind:'delete',path:['rewards',index,key]});ops.push({kind:'length',path:['ledger'],length:0});
  after.logs.unshift({id:'log-1',at:exchangeAt,text:'Оля: обменяла три чеснока',reverse:{kind:'patch',ops}});
  return {before,after};
}

test('athlete card opens a backpack with accumulated mini-prize history',()=>{
  assert.match(page,/backpack\.css/);assert.match(page,/backpack\.js/);assert.match(page,/id="backpackDialog"/);
  assert.match(page,/backpackButtonView\(p\)/);assert.match(script,/История мини-призов/);
  assert.match(script,/Три одинаковых мини-приза можно обменять на одну монету/);
  assert.match(css,/\.backpack-gold-coin/);
});

test('backpack groups old mini-prize history and hides already exchanged copies',()=>{
  const context={state:{rewards:[
    {id:'1',playerId:'p1',prizeId:'mini-garlic',title:'Чеснок',miniPrize:true,cancelled:false},
    {id:'2',playerId:'p1',prizeId:'mini-garlic',title:'Чеснок',miniPrize:true,cancelled:false},
    {id:'3',playerId:'p1',prizeId:'mini-garlic',title:'Чеснок',miniPrize:true,cancelled:false},
    {id:'4',playerId:'p1',prizeId:'mini-garlic',title:'Чеснок',miniPrize:true,cancelled:false,exchanged:true},
    {id:'5',playerId:'p2',prizeId:'mini-garlic',title:'Чеснок',miniPrize:true,cancelled:false}
  ]}};
  vm.createContext(context);vm.runInContext(script,context);
  const groups=context.backpackGroups({id:'p1'});
  assert.equal(groups.length,1);assert.equal(groups[0].rewards.length,3);
});

test('exactly three matching mini-prizes can be exchanged for one coin',()=>{
  const {before,after}=exchangeStates();assert.equal(miniPrizeExchangeUpdateValid(before,after),true);
  const wrongAmount=structuredClone(after);wrongAmount.ledger.at(-1).amount=2;assert.equal(miniPrizeExchangeUpdateValid(before,wrongAmount),false);
  const mixed=structuredClone(after);mixed.rewards[2].prizeId='mini-other';assert.equal(miniPrizeExchangeUpdateValid(before,mixed),false);
  const changedPlayer=structuredClone(after);changedPlayer.players[0].name='Подмена';assert.equal(miniPrizeExchangeUpdateValid(before,changedPlayer),false);
});
