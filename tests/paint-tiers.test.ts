import {test} from 'node:test';import assert from 'node:assert/strict';import {paintAdvice,type PaintInventoryRow} from '../src/paints/advice';import {paintTierAdvice} from '../src/paints/tier-advice';import type {PaintCatalogue,PaintSku} from '../src/paints/model';import {basePledge} from './fixtures';
const at='2026-11-18T00:00:00Z',now=Date.parse(at);
const sku=(n:number,minor=1000,extra:Partial<PaintSku>={}):PaintSku=>({id:String(n),productId:'268',title:'Synthetic paint '+n,minQty:1,maxQty:5,regularMinor:minor,discountedMinor:null,allowCredit:true,available:true,vip:false,warbond:false,hasShips:false,isPackage:false,contents:[{code:'Paint_'+n,name:'Paint '+n,kind:'SKIN',hasGamePurchase:false}],...extra});
const owned=(n:number,name='Paint '+n):PaintInventoryRow=>{const pledge=basePledge('owned-'+n);pledge.ships=[];pledge.sourceValues={date:'Created: November 1, 2025',items:JSON.stringify([{title:name,kind:'Skin'}]),alsoContains:'[]',pledgeValue:'$20.00 USD',meltable:'true'};return {pledge,source:'rsi-dom-probe/1'};};
const catalogue=(skus:PaintSku[]):PaintCatalogue=>({schemaVersion:1,source:'rsi-public-paints',fetchedAt:at,currency:'USD',taxBasis:'net',skus,rules:[{id:1,from:5,to:9,percent:25,amountOff:null,maximum:null,products:['268'],skus:[]},{id:2,from:10,to:null,percent:35,amountOff:null,maximum:null,products:['268'],skus:[]}]});
test('Two missing distinct paints are costed against the current plan, including the extra purchases',()=>{
 const rows=Array.from({length:8},(_,i)=>owned(i+1)),data=catalogue([...Array.from({length:8},(_,i)=>sku(i+1)),sku(9,100),sku(10,100)]),base=paintAdvice(rows,data,now),before=JSON.stringify({rows,data,base});const tier=paintTierAdvice(base,data,rows,now);
 assert.equal(base.percent,25);assert.equal(tier.next?.missing,2);assert.equal(tier.maximum?.percent,35);assert.equal(tier.maximum?.extraCostMinor,130);assert.equal(tier.maximum?.existingCostMinor,5200);assert.equal(tier.maximum?.totalCostMinor,5330);assert.equal(tier.maximum?.freeMinor,10670);assert.equal(tier.maximum?.changeMinor,670);assert.equal(JSON.stringify({rows,data,base}),before);
});
test('A larger discount does not claim a financial gain when the additional paints cost more',()=>{
 const rows=Array.from({length:8},(_,i)=>owned(i+1)),data=catalogue([...Array.from({length:8},(_,i)=>sku(i+1)),sku(9,4000),sku(10,4000)]),tier=paintTierAdvice(paintAdvice(rows,data,now),data,rows,now);assert.equal(tier.maximum?.missing,2);assert.equal(tier.maximum?.extraCostMinor,5200);assert.equal(tier.maximum?.changeMinor,-4400);assert.ok(tier.maximum!.freeMinor!<10000);
});
test('Duplicate copies count as one shop position and incomplete filler availability leaves all money values unknown',()=>{
 const rows=Array.from({length:17},(_,i)=>owned(i+1,'Paint 1')),data=catalogue([sku(1,1000,{maxQty:30}),sku(2),sku(3)]),tier=paintTierAdvice(paintAdvice(rows,data,now),data,rows,now);assert.equal(tier.distinctPositions,1);assert.equal(tier.maximum?.missing,9);assert.equal(tier.maximum?.complete,false);assert.equal(tier.maximum?.extraCostMinor,null);assert.equal(tier.maximum?.freeMinor,null);assert.deepEqual(tier.maximum?.extra,[]);
});
test('Maximum tier already used never suggests additional purchases',()=>{
 const rows=Array.from({length:10},(_,i)=>owned(i+1)),data=catalogue(Array.from({length:12},(_,i)=>sku(i+1))),tier=paintTierAdvice(paintAdvice(rows,data,now),data,rows,now);assert.equal(tier.state,'maximum');assert.equal(tier.maximumPercent,35);assert.equal(tier.currentPercent,35);assert.equal(tier.next,null);assert.equal(tier.maximum,null);
});
test('Cash-only, VIP, warbond, missing stock, minimum quantities and same-color variants cannot inflate the filler plan',()=>{
 const rows=Array.from({length:8},(_,i)=>owned(i+1)),data=catalogue([...Array.from({length:8},(_,i)=>sku(i+1)),sku(9,1,{allowCredit:false}),sku(10,1,{vip:true}),sku(11,1,{warbond:true}),sku(12,1,{available:false}),sku(13,1,{minQty:2}),sku(14,1,{contents:sku(1).contents}),sku(15,100),sku(16,100)]),tier=paintTierAdvice(paintAdvice(rows,data,now),data,rows,now);assert.deepEqual(tier.maximum?.extra.map(p=>p.skuId),['15','16']);assert.equal(tier.maximum?.extraCostMinor,130);
});
test('Owned colors in protected packages are not proposed as allegedly new colors',()=>{
 const rows=Array.from({length:8},(_,i)=>owned(i+1)),protectedPaint=owned(100,'Paint 9');protectedPaint.pledge.ships=basePledge().ships;rows.push(protectedPaint);const data=catalogue([...Array.from({length:8},(_,i)=>sku(i+1)),sku(9,1),sku(10,100),sku(11,100)]),tier=paintTierAdvice(paintAdvice(rows,data,now),data,rows,now);assert.deepEqual(tier.maximum?.extra.map(p=>p.skuId),['10','11']);
});
test('Stale data, unknown permission, absent tiers and tampered quantities never produce a spending forecast',()=>{
 const rows=[owned(1)],data=catalogue([sku(1),sku(2)]),base=paintAdvice(rows,data,now);assert.equal(paintTierAdvice(base,null,rows,now).state,'unavailable');assert.equal(paintTierAdvice(base,data,rows,now+48*3600000).state,'unavailable');
 delete rows[0]!.pledge.sourceValues.meltable;assert.equal(paintTierAdvice(paintAdvice(rows,data,now),data,rows,now).state,'unavailable');const noRules={...data,rules:[]};assert.equal(paintTierAdvice(base,noRules,rows,now).state,'no-rules');assert.equal(paintTierAdvice({...base,basket:[{skuId:'1',quantity:999}]},data,rows,now).state,'unavailable');
});
test('Pack children do not count as multiple qualifying positions and pack discounts are not stacked',()=>{
 const row=owned(1);row.pledge.sourceValues.items=JSON.stringify([{title:'A',kind:'Skin'},{title:'B',kind:'Skin'}]);row.pledge.sourceValues.pledgeValue='$50.00 USD';const pack=sku(1,2000,{isPackage:true,discountedMinor:1000,contents:[{code:'A',name:'A',kind:'SKIN',hasGamePurchase:false},{code:'B',name:'B',kind:'SKIN',hasGamePurchase:false}]}),data=catalogue([pack,...Array.from({length:9},(_,i)=>sku(i+2,100))]),base=paintAdvice([row],data,now),tier=paintTierAdvice(base,data,[row],now);assert.equal(tier.distinctPositions,1);assert.equal(tier.maximum?.missing,9);assert.equal(tier.maximum?.existingCostMinor,1300);assert.equal(tier.maximum?.extraCostMinor,585);
});
