import test from 'node:test';import assert from 'node:assert/strict';
import {additionalCost,ccuPriceAdvantageReader,paidBaseCost,paidCcuCost,chainCosts,chainSavings} from '../src/planner/costs';
import {SHOP_PRICE_MAX_AGE,type ShopPrice} from '../src/market/shop-prices';
import {packageBasis} from '../src/planner/package-shares';
import type {ChainStep,ChainBase} from '../src/planner/chain';import type {PricingSnapshot} from '../src/pricing/model';import type {Pledge} from '../src/domain/model';
const at=new Date().toISOString(),day=at.slice(0,10);
const display:PricingSnapshot={settings:{schemaVersion:1,language:'de',currency:'EUR',taxMode:'net',vatBasisPoints:1900},configured:true,settingsError:false,rate:{source:'ECB',sourceDate:day,fetchedAt:at,usdPerEurMicros:1250000},pending:false,rateError:false};
const model=(key:string,value:number|null)=>({key,name:key,nominalUsd:value,catalogueConfirmed:true});
const gap:ChainStep={key:'gap',kind:'purchase',from:model('from',35000),to:model('to',40000)};
const owned:ChainStep={...gap,key:'owned',kind:'owned',ccu:{key:'owned',pledgeId:'p',instanceId:'c',from:gap.from,to:gap.to,warbond:true,applicabilityConfirmed:false,protected:true}};
const pledge:Pledge={pledgeId:'p',name:'synthetic',insurance:{kind:'lti',evidence:'test'},originalDescription:'',ships:[],ccus:[{instanceId:'c',from:'from',to:'to',status:'unused',applicability:'unverified',insurance:{kind:'lti',evidence:'test'}}],protected:true,baseReleased:false,restrictions:[],acquisitionCost:null,unknownCostReason:'test',meltValue:null,sourceValues:{}};
const base:ChainBase={key:'base',pledgeId:'base',childId:'base',model:model('from',1000),pledgeName:'base',insurance:{kind:'lti',evidence:'test'},protected:true,released:false,multiShip:false,identityConfirmed:false};

test('a Warbond discount requires fresh, comparable prices for the exact selected pair',()=>{
 const now=Date.now();
 const step={...gap,from:model('matrix:1',35000),to:model('matrix:2',40000)};
 const quote=(edition:ShopPrice['edition'],minor:number):ShopPrice=>({
   edition,fromId:1,toId:2,checkedAt:now,amount:{minor,currency:'EUR',taxMode:'net',vatBasisPoints:0},
 });
 const standard=quote('standard',1500),warbond=quote('warbond',1000);
 const cost={minor:1000,usdMinor:1250,approximate:false};
 const read=(shopPrices:ShopPrice[])=>ccuPriceAdvantageReader({...display,shopPrices},now);
 assert.deepEqual(read([standard,warbond])(step,cost,true),{minor:500,approximate:false});
 assert.equal(read([standard,warbond])(step,cost),null);
 assert.equal(read([standard,warbond])(step,{...cost,minor:999},true),null);
 assert.equal(read([warbond])(step,cost,true),null);
 assert.equal(read([standard,{...warbond,fromId:3}])(step,cost,true),null);
 assert.equal(read([standard,{...warbond,checkedAt:now-SHOP_PRICE_MAX_AGE}])(step,cost,true),null);
 assert.equal(read([standard,{...warbond,amount:{...warbond.amount,taxMode:'gross'}}])(step,cost,true),null);
 const usd=(q:ShopPrice,minor:number):ShopPrice=>({...q,amount:{...q.amount,minor,currency:'USD'}});
 assert.deepEqual(read([usd(standard,1900),usd(warbond,1250)])(step,{...cost,approximate:true},true),
   {minor:520,approximate:true});
});

test('owned savings use the documented cost and a standard comparison, never a fresh Warbond',()=>{
 const now=Date.now();
 const step={...owned,from:model('matrix:1',35000),to:model('matrix:2',40000)};
 const paid={minor:700,usdMinor:null,approximate:false};
 const standard:ShopPrice={edition:'standard',fromId:1,toId:2,checkedAt:now,
   amount:{minor:3000,currency:'EUR',taxMode:'net',vatBasisPoints:0}};
 const read=ccuPriceAdvantageReader({...display,shopPrices:[standard,{...standard,edition:'warbond',amount:{...standard.amount,minor:800}}]},now);
 assert.deepEqual(read(step,paid),{minor:2300,approximate:false});
 assert.deepEqual(read(step,{...paid,rsiOrder:true}),{minor:2300,approximate:true});
 assert.equal(read(step,{...paid,minor:null}),null);
 assert.equal(read(step,{...paid,minor:3000}),null);
 assert.equal(read({...step,validity:'invalid'},paid),null);
 assert.deepEqual(ccuPriceAdvantageReader(display,now)(step,paid),{minor:3300,approximate:true});
 assert.equal(ccuPriceAdvantageReader(display,now)({...step,to:{...step.to,nominalUsd:null}},paid),null);
 assert.equal(ccuPriceAdvantageReader({...display,rate:null},now)(step,paid),null);
});
test('standard gap estimate converts the value difference, with configured VAT exactly once',()=>{
 assert.deepEqual(additionalCost(gap,display,true),{minor:4000,usdMinor:5000,approximate:true});
 assert.equal(additionalCost(gap,{...display,settings:{...display.settings,taxMode:'gross'}},true).minor,4760);
 assert.equal(additionalCost(gap,{...display,settings:{...display.settings,currency:'USD',taxMode:'gross'}},true).minor,5950);
});
test('owned CCUs cost zero additionally even without FX; historical acquisition is not fabricated',()=>{
 assert.equal(additionalCost(owned,{...display,rate:null},false).minor,0);
 assert.equal(paidCcuCost(owned,[pledge],display).minor,null);
 const p={...pledge,acquisitionCost:{minor:500,currency:'EUR' as const,taxBasis:'net' as const,evidence:'synthetic invoice'}};
 assert.equal(paidCcuCost(owned,[p],display).minor,500);
 assert.equal(paidCcuCost(owned,[{...p,ccus:[...p.ccus,{...p.ccus[0]!,instanceId:'other'}]}],display).minor,null);
});
test('unknown, stale and backward gaps have no numeric estimate or fake zero',()=>{
 for(const s of [{...gap,from:model('from',null)},{...gap,from:model('from',45000)},{...gap,kind:'conflict' as const},{...gap,kind:'missing' as const}])assert.equal(additionalCost(s,display,true).minor,null);
 assert.equal(additionalCost(gap,display,false).minor,null);
 assert.equal(additionalCost(gap,{...display,rate:null},true).minor,null);
 assert.equal(additionalCost(gap,{...display,rate:{...display.rate!,sourceDate:'2000-01-01'}},true).minor,null);
});
test('historical gross payments are not taxed twice and unknown tax bases stay unknown',()=>{
 const gross={...display,settings:{...display.settings,taxMode:'gross' as const}};
 const p={...pledge,acquisitionCost:{minor:625,currency:'USD' as const,taxBasis:'gross' as const,evidence:'synthetic invoice'}};
 assert.equal(paidCcuCost(owned,[p],gross).minor,500);
 assert.equal(paidCcuCost(owned,[p],display).minor,null);
 assert.equal(paidCcuCost(owned,[{...p,acquisitionCost:{...p.acquisitionCost,taxBasis:'unknown'}}],gross).minor,null);
});
test('partial totals report missing positions and never expose an invalid complete investment',()=>{
 const p=chainCosts({base,steps:[owned,gap,{...gap,key:'unknown',from:model('unknown',null)}]},[pledge],display,true);
 assert.equal(p.additional.knownMinor,4000);assert.equal(p.additional.missing,1);assert.equal(p.paid.missing,2);assert.equal(p.investment,null);
 const invalid=chainCosts({base,steps:[owned,{...gap,kind:'conflict'}]},[pledge],display,true);assert.equal(invalid.invalid,true);assert.equal(invalid.additional.missing,0);assert.equal(invalid.investment,null);
});

test('complete investment includes recorded base and CCU cost once plus the gap estimate',()=>{
 const receipt={minor:500,currency:'EUR' as const,taxBasis:'net' as const,evidence:'synthetic invoice'};
 const p={...pledge,acquisitionCost:receipt},b={...pledge,pledgeId:'base',ccus:[],ships:[{childId:'base',modelName:'from',modelId:null,identity:'unresolved' as const,role:'unverified' as const}],acquisitionCost:{...receipt,minor:1000}};
 const costs=chainCosts({base,steps:[owned,gap]},[p,b],display,true);
 assert.equal(costs.paid.knownMinor,1500);assert.equal(costs.paid.missing,0);assert.equal(costs.additional.knownMinor,4000);assert.equal(costs.investment,5500);assert.equal(costs.invalid,false);
});

test('CCU savings compare total cost with the standard price in the selected tax basis and currency',()=>{
 assert.equal(chainSavings(5500,10000,display),2500);
 assert.equal(chainSavings(9000,10000,display),-1000);
 assert.equal(chainSavings(7000,10000,{...display,settings:{...display.settings,taxMode:'gross'}}),2520);
 assert.equal(chainSavings(null,10000,display),null);
 assert.equal(chainSavings(5500,null,display),null);
 assert.equal(chainSavings(5500,10000,{...display,rate:null}),null);
});

test('verified RSI order amounts are used once without adding VAT to past purchases',()=>{
 const gross={...display,settings:{...display.settings,taxMode:'gross' as const}};
 const observation={kind:'rsi-hangar' as const,observedAt:at};
 const receipt={status:'documented' as const,source:'order' as const,currency:'EUR' as const,minor:725};
 const proof={resolution:'structured-unique',sourceCandidates:1,targetCandidates:1};
 const singleCcu={...pledge.ccus[0]!,instanceId:'p:ccu',status:'unverified' as const};
 const upgrade={...owned,ccu:{...owned.ccu!,instanceId:singleCcu.instanceId}};
 const p={...pledge,ccus:[singleCcu],rsiPurchase:receipt,sourceValues:{upgrade:JSON.stringify({from:singleCcu.from,to:singleCcu.to}),upgradeEvidence:JSON.stringify(proof)}};
 const b={...pledge,pledgeId:'base',name:'Standalone Ships - from',ccus:[],ships:[{childId:base.childId,modelName:'from',modelId:null,identity:'unresolved' as const,role:'unverified' as const}],rsiPurchase:{...receipt,minor:2500}};
 assert.deepEqual(paidCcuCost(upgrade,[p],gross,observation),{minor:725,approximate:false,usdMinor:null,rsiOrder:true});
 assert.equal(paidBaseCost(base,[b],gross,observation).minor,2500);
 const plan={base,steps:[upgrade,gap]};
 const complete=chainCosts(plan,[b,p],gross,true,undefined,observation);
 assert.deepEqual(complete.paid,{knownMinor:3225,missing:0,approximate:true});
 assert.equal(complete.additional.knownMinor,4760);
 assert.equal(complete.investment,7985);
 assert.equal(chainSavings(complete.investment,10000,gross),1535);
 const partial=chainCosts(plan,[{...b,rsiPurchase:undefined},p],gross,true,undefined,observation);
 assert.deepEqual(partial.paid,{knownMinor:725,missing:1,approximate:true});
 assert.equal(partial.additional.knownMinor,4760);
 assert.equal(partial.investment,null);
 assert.equal(chainSavings(partial.investment,10000,gross),null);
 assert.equal(paidCcuCost(upgrade,[p],display,observation).minor,null);
 assert.equal(paidCcuCost(upgrade,[p],gross).minor,null);
 const imported={kind:'rsi-imports' as const,observations:{[b.pledgeId]:at}};
 assert.equal(paidCcuCost(upgrade,[p],gross,imported).minor,null);
 assert.equal(paidBaseCost(base,[b],gross,imported).minor,2500);
 assert.equal(paidCcuCost(upgrade,[{...p,rsiPurchase:{...receipt,source:'log'}}],gross,observation).minor,null);
 assert.equal(paidCcuCost(upgrade,[{...p,rsiPurchase:{...receipt,currency:'USD'}}],{...gross,rate:null},observation).minor,null);
 const recorded={minor:0,currency:'EUR' as const,taxBasis:'gross' as const,evidence:'Synthetic receipt'};
 assert.equal(paidCcuCost(upgrade,[{...p,acquisitionCost:recorded}],gross,observation).minor,0);
 assert.equal(paidBaseCost(base,[{...b,name:'Package - from'}],gross,observation).minor,null);
 const withPaint={...b,name:'Standalone Ships - from plus Icefront Camo Paint',sourceValues:{pledgeConfigurationValue:'$0.00 USD'}};
 assert.equal(paidBaseCost(base,[withPaint],gross,observation).minor,2500);
 assert.equal(paidBaseCost(base,[{...withPaint,ships:[...b.ships,{...b.ships[0]!,childId:'second'}]}],gross,observation).minor,null);
 assert.equal(paidBaseCost(base,[{...withPaint,name:'Standalone Ships - Other Model plus Icefront Camo Paint'}],gross,observation).minor,null);
 assert.equal(paidBaseCost(base,[{...withPaint,sourceValues:{pledgeConfigurationValue:'$25.00 USD'}}],gross,observation).minor,null);
 assert.equal(paidBaseCost(base,[{...b,sourceValues:{pledgeConfigurationValue:'$25.00 USD'}}],gross,observation).minor,null);
 assert.equal(paidBaseCost(base,[{...b,ships:[{...b.ships[0]!,modelName:'Upgraded model'}]}],gross,observation).minor,null);
});

test('an allocated package share is paid cost for that exact base and leaves remaining CCU costs unchanged',()=>{
 const gross={...display,settings:{...display.settings,taxMode:'gross' as const}};
 const observation={kind:'rsi-hangar' as const,observedAt:at};
 const bundle: Pledge={...pledge,pledgeId:base.pledgeId,ccus:[],
   ships:[{childId:base.childId,modelName:'from',modelId:null,identity:'unresolved',role:'unverified'},
     {childId:'another',modelName:'another',modelId:null,identity:'unresolved',role:'unverified'}],
   rsiPurchase:{status:'documented',source:'order',minor:7000,currency:'EUR'}};
 const selected={...base,multiShip:true};
 const basis=packageBasis(bundle,selected.childId,observation);
 assert.ok(basis);
 const allocation={...basis,minor:3200};
 const plan={base:selected,steps:[gap]};
 const before=chainCosts(plan,[bundle],gross,true,undefined,observation);
 const after=chainCosts(plan,[bundle],gross,true,undefined,observation,[allocation]);
 assert.equal(before.investment,null);
 assert.deepEqual(after.additional,before.additional);
 assert.equal(after.investment,7960);
 assert.equal(chainSavings(after.investment,10000,gross),1560);
 assert.equal(paidBaseCost(selected,[bundle],gross,observation,[allocation]).packageShare,true);
 assert.equal(paidBaseCost(selected,[bundle],display,observation,[allocation]).minor,null);
 assert.equal(paidBaseCost(selected,[bundle],gross,observation,[{...allocation,totalMinor:7100}]).minor,null);
 assert.equal(paidBaseCost(selected,[bundle],gross,observation,[{...allocation,modelName:'other model'}]).minor,null);
 assert.equal(paidBaseCost(selected,[bundle],gross,undefined,[allocation]).minor,null);
 assert.equal(paidBaseCost({...selected,childId:'another'},[bundle],gross,observation,[allocation]).minor,null);
});

test('unrepresentable totals stay unknown instead of rounding unsafe integer sums',()=>{
 const receipt={minor:Number.MAX_SAFE_INTEGER,currency:'EUR' as const,taxBasis:'net' as const,evidence:'Synthetic boundary invoice'},p={...pledge,acquisitionCost:receipt};
 const b={...pledge,pledgeId:'base',ccus:[],ships:[{childId:'base',modelName:'from',modelId:null,identity:'unresolved' as const,role:'unverified' as const}],acquisitionCost:receipt};
 const sum=chainCosts({base,steps:[owned]},[p,b],display,true);assert.equal(sum.paid.knownMinor,Number.MAX_SAFE_INTEGER);assert.equal(sum.paid.missing,1);assert.equal(sum.investment,null);
 const investment=chainCosts({base,steps:[gap]},[b],display,true);assert.equal(investment.paid.missing,0);assert.equal(investment.investment,null);
});
