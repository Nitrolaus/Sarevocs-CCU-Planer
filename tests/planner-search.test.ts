import test from 'node:test';import assert from 'node:assert/strict';
import {searchChains,type SearchInput} from '../src/planner/search';import {buildChain,type ChainBase,type ChainModel,type ChainPool,type OwnedCcu} from '../src/planner/chain';
import {chainCosts} from '../src/planner/costs';
import {purchasePriceReader} from '../src/planner/shopping-list';
import type {CatalogueShip,TargetOffer} from '../src/market/model';import type {PricingSnapshot} from '../src/pricing/model';
const at=new Date().toISOString(),model=(id:number,value:number|null=id*1000):ChainModel=>({key:'matrix:'+id,name:'TEST '+id,catalogueConfirmed:true,nominalUsd:value});
const ship=(id:number):CatalogueShip=>({id,name:'TEST '+id,chassisId:null,manufacturer:'TEST',manufacturerCode:'T',status:'unknown',focus:'',length:null});
const base=(id:number,lti=false):ChainBase=>({key:JSON.stringify(['base',String(id)]),pledgeId:'base'+id,childId:String(id),model:model(id),pledgeName:'SYNTHETIC',insurance:lti?{kind:'lti',evidence:'Synthetic'}:{kind:'months',months:6,evidence:'Synthetic'},protected:true,released:false,multiShip:false,identityConfirmed:false});
const ccu=(id:number,from:number,to:number):OwnedCcu=>({key:JSON.stringify(['ccu',String(id)]),pledgeId:'ccu'+id,instanceId:String(id),from:model(from),to:model(to),warbond:true,applicabilityConfirmed:false,protected:true});
const display:PricingSnapshot={settings:{schemaVersion:1,language:'de',currency:'USD',taxMode:'net',vatBasisPoints:0},configured:true,settingsError:false,rate:null,pending:false,rateError:false};
const offer=(id:number):TargetOffer=>({key:'offer'+id,name:'Upgrade to TEST '+id,targetName:'TEST '+id,toShipId:id,toSkuId:id,regularMinor:id*1000,warbondMinor:null,warbond:false,currency:'USD',taxBasis:'net',verification:'target-observation',firstSeenAt:at,lastSeenAt:at,change:'current',previousRegularMinor:null,previousWarbondMinor:null});
const input=(ccus:OwnedCcu[]=[],bases:ChainBase[]=[base(1)]):SearchInput=>({pool:{bases,ccus,ignored:0,limited:false},target:ship(6),offers:[offer(6)],current:true,display});
test('workbench chooses the route with the lowest displayed total when a Warbond reverses the nominal ranking',()=>{
 const i=input([ccu(1,1,3),ccu(2,1,4)]);
 i.offers=[{...offer(6),warbond:true,warbondMinor:3500}];
 i.pool.values={schemaVersion:1,source:'rsi-from-ships',fetchedAt:at,currency:'USD',taxBasis:'net',
   items:[1,3,4,6].map(id=>({id,name:ship(id).name,minor:id*1000}))};
 i.display={...display,settings:{...display.settings,currency:'EUR',taxMode:'gross',vatBasisPoints:1900},
   rate:{source:'ECB',sourceDate:at.slice(0,10),usdPerEurMicros:1136364,fetchedAt:at}};
 const r=searchChains(i,{observedPrices:true});
 assert.equal(r.bestProven,true);assert.equal(r.rankingCurrency,'EUR');
 assert.equal(r.plans[0]!.plan.steps[0]!.ccu?.key,i.pool.ccus[0]!.key);
 assert.deepEqual(r.plans.map(p=>p.score[0]),[524,2094,5236]);
 const reader=purchasePriceReader(i.offers,i.pool.values,i.current);
 for(const p of r.plans)assert.deepEqual(chainCosts(p.plan,[],i.display,true,reader).additional,
   {knownMinor:p.score[0],approximate:true,missing:0});
 // A standard feeder can precede a real Warbond even with no matching owned CCU.
 i.pool.ccus=[ccu(3,4,3)]; i.offers=[...i.offers,offer(3)];
 assert.deepEqual(searchChains(i,{observedPrices:true}).plans[0]!.plan.steps.map(s=>s.to.key),['matrix:3','matrix:6']);
 i.offers=[];assert.equal(searchChains(i,{observedPrices:true}).plans.length,0);
});
test('the default and best known routes rank a verified shop amount as displayed', () => {
 const i = input([ccu(1,1,3), ccu(2,1,4)]);
 i.pool.values = {schemaVersion:1,source:'rsi-from-ships',fetchedAt:at,currency:'USD',taxBasis:'net',
   items:[1,3,4,6].map(id => ({id,name:ship(id).name,minor:id*1000}))};
 i.display = {...display, settings:{...display.settings,currency:'EUR',taxMode:'gross',vatBasisPoints:1900},
   rate:{source:'ECB',sourceDate:at.slice(0,10),usdPerEurMicros:1136364,fetchedAt:at},
   shopPrices:[{fromId:3,toId:6,edition:'standard',checkedAt:Date.now(),amount:{minor:1800,currency:'EUR',taxMode:'gross',vatBasisPoints:1900}}]};
 const baseKey = i.pool.bases[0]!.key;
 assert.equal(buildChain(i.pool,i.target,i.offers,true,baseKey)?.steps[0]?.to.key,'matrix:4');
 assert.equal(buildChain(i.pool,i.target,i.offers,true,baseKey,i.display)?.steps[0]?.to.key,'matrix:3');
 assert.equal(searchChains(i,{observedPrices:true}).plans[0]?.score[0],1800);
});
test('global remaining outlay wins before LTI and nominal base value; fixed base is respected',()=>{const i=input([ccu(1,1,4)],[base(1,true),base(5)]),before=JSON.stringify(i),r=searchChains(i);assert.equal(r.bestProven,true);assert.equal(r.plans[0]!.score[0],1000);assert.equal(r.plans[0]!.plan.base.model.key,'matrix:5');assert.equal(searchChains({...i,baseKey:i.pool.bases[0]!.key}).plans[0]!.score[0],2000);assert.equal(JSON.stringify(i),before);});
test('all inventory edges participate, including savings outside the former eight-edge heuristic',()=>{const list=Array.from({length:12},(_,n)=>ccu(n,1,2));list.push(ccu(50,2,5));const r=searchChains(input(list));assert.equal(r.plans[0]!.score[0],1000);assert.equal(r.plans[0]!.plan.ownedCount,2);assert.equal(r.ccusChecked,13);});
test('zero-cost historical cycles cannot create duplicate consumption or loops',()=>{const i=input([ccu(1,1,3),ccu(2,3,1),ccu(3,3,6)]),r=searchChains(i);assert.equal(r.plans[0]!.score[0],0);for(const p of r.plans){const keys=p.plan.steps.filter(s=>s.kind==='owned').map(s=>s.ccu!.key),nodes=[p.plan.base.model.key,...p.plan.steps.map(s=>s.to.key)];assert.equal(new Set(keys).size,keys.length);assert.equal(new Set(nodes).size,nodes.length);}});
test('unknown prices never become zero-price purchase edges; exact all-owned paths remain possible',()=>{const i=input([ccu(1,1,6)]);i.pool.bases[0]!.model.nominalUsd=null;i.pool.ccus[0]!.from.nominalUsd=null;assert.equal(searchChains({...i,current:false}).plans[0]!.score[0],0);const noPath=input();noPath.pool.bases[0]!.model.nominalUsd=null;const r=searchChains(noPath);assert.equal(r.plans.length,0);assert.ok(r.unknownModels>0);});
test('ranking uses nominal USD; display uses configured FX and VAT, without invented rounding buys',()=>{const i=input([ccu(1,2,4)]);const eur={...display,settings:{...display.settings,currency:'EUR' as const,taxMode:'gross' as const,vatBasisPoints:1900},rate:{source:'ECB' as const,sourceDate:at.slice(0,10),usdPerEurMicros:1100000,fetchedAt:at}};const r=searchChains({...i,display:eur});assert.equal(r.comparisonCurrency,'EUR');assert.equal(r.comparisonTaxMode,'gross');assert.equal(r.plans[0]!.score[0],1082+2164);assert.equal(r.plans[0]!.rankScore[0],3000);const fallback=searchChains({...i,display:{...eur,rate:null}});assert.equal(fallback.fallbackUsd,true);assert.equal(fallback.comparisonCurrency,'USD');assert.equal(fallback.plans[0]!.score[0],3000);});
test('limits are reported without claiming an optimum, and invalid or oversized input is rejected',()=>{assert.equal(searchChains(input(),{maxOperations:1}).bestProven,false);assert.equal(searchChains({...input(),pool:{...input().pool,limited:true}}).reason,'limit');const i=input([ccu(1,1,3)]);i.pool.ccus.push({...i.pool.ccus[0]!});assert.equal(searchChains(i).reason,'input');});
test('a limit during alternative enumeration preserves only the independently proven best route',()=>{const i=input([ccu(1,2,4)]);const r=Array.from({length:100},(_,n)=>searchChains(i,{maxOperations:n+1})).find(r=>r.bestProven&&r.reason==='alternatives-limit');assert.ok(r);assert.equal(r.alternativesComplete,false);assert.equal(r.plans[0]!.score[0],3000);});
test('a proof for an overlong optimum is not exposed as an applicable draft',()=>{const i=input(Array.from({length:101},(_,n)=>ccu(n,n+1,n+2)));i.target=ship(102);i.offers=[offer(102)];const r=searchChains(i,{maxVariants:1});assert.equal(r.reason,'draft-limit');assert.equal(r.bestProven,false);assert.equal(r.plans.length,0);});
test('five model-distinct canonical alternatives agree with exhaustive enumeration on small generated graphs',()=>{
 let seed=32032;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
 const cmp=(a:number[],b:number[])=>a[0]!-b[0]!||a[1]!-b[1]!||a[2]!-b[2]!;
 for(let round=0;round<32;round++){
  const owned:OwnedCcu[]=[];let n=0;for(let a=1;a<=6;a++)for(let b=1;b<=6;b++)if(a!==b&&random()<.16)owned.push(ccu(n++,a,b));
  const i=input(owned,[base(1),base(2,true)]),nodes=new Map<string,ChainModel>([[model(6).key,model(6)]]);for(const b of i.pool.bases)nodes.set(b.model.key,b.model);for(const c of owned){nodes.set(c.from.key,c.from);nodes.set(c.to.key,c.to);}
  const all:number[][]=[];
  function walk(key:string,seen:Set<string>,score:number[],previousPurchase=false){if(key==='matrix:6'){all.push(score);return;}const from=nodes.get(key)!;
   const edges=[...owned.filter(c=>c.from.key===key).map(c=>({to:c.to,amount:0,gaps:0})),...(!previousPurchase?[...nodes.values()].filter(to=>from.nominalUsd!<to.nominalUsd!).map(to=>({to,amount:to.nominalUsd!-from.nominalUsd!,gaps:1})):[])];
   for(const e of edges)if(!seen.has(e.to.key))walk(e.to.key,new Set([...seen,e.to.key]),[score[0]!+e.amount,score[1]!+e.gaps,score[2]!+1],!!e.gaps);
  }
  for(const b of i.pool.bases)walk(b.model.key,new Set([b.model.key]),[0,0,0]);all.sort(cmp);
  const r=searchChains(i,{maxMs:10000,maxOperations:10_000_000});assert.equal(r.bestProven,true);assert.equal(r.alternativesComplete,true);assert.deepEqual(r.plans.map(p=>p.score),all.slice(0,5),'round '+round);assert.equal(new Set(r.plans.map(p=>p.signature)).size,r.plans.length);
 }
});
test('identical physical CCU copies do not occupy multiple variant slots',()=>{const r=searchChains(input([ccu(1,1,4),ccu(2,1,4),ccu(3,1,4)]));assert.equal(r.plans.length,2);assert.deepEqual(r.plans.map(p=>p.plan.ownedCount),[1,0]);});
test('rounding cannot produce consecutive standard purchases or reward smaller gaps',()=>{const i=input([ccu(1,3,4),ccu(2,5,6)]);i.pool.bases[0]!.model.nominalUsd=4000;for(const c of i.pool.ccus){c.from.nominalUsd=c.from.nominalUsd!*10;c.to.nominalUsd=c.to.nominalUsd!*10;}i.offers[0]!.regularMinor=60000;
 const r=searchChains({...i,display:{...display,settings:{...display.settings,currency:'EUR',taxMode:'gross',vatBasisPoints:1900},rate:{source:'ECB',sourceDate:at.slice(0,10),usdPerEurMicros:1101400,fetchedAt:at}}});for(const p of r.plans)for(let n=1;n<p.plan.steps.length;n++)assert.ok(!(p.plan.steps[n-1]!.kind==='purchase'&&p.plan.steps[n]!.kind==='purchase'));assert.equal(r.plans[0]!.rankScore[0],36000);assert.equal(r.plans[0]!.plan.gapCount,2);
});
