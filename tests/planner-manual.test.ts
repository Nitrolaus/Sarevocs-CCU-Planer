import test from 'node:test';import assert from 'node:assert/strict';
import {prepareChains} from '../src/planner/chain';import {manualChain,chainVariants} from '../src/planner/manual';
import {anchorFromStep,emptyDraft,type PlannerDraft} from '../src/planner/draft';
import type {Pledge} from '../src/domain/model';import type {CatalogueShip,TargetOffer} from '../src/market/model';
const at=new Date().toISOString();
const ships:CatalogueShip[]=['Starter','A','B','Alternative','Target'].map((name,i)=>({id:i+1,name,chassisId:null,manufacturer:'Test',manufacturerCode:'TEST',status:'unknown',focus:'',length:null}));
const offers:TargetOffer[]=ships.map((s,i)=>({key:'test:'+i,name:'Upgrade to '+s.name,targetName:s.name,toShipId:s.id,toSkuId:100+i,regularMinor:[1000,2000,4000,3500,10000][i]!,warbondMinor:null,warbond:false,currency:'USD',taxBasis:'net',verification:'target-observation',firstSeenAt:at,lastSeenAt:at,change:'current',previousRegularMinor:null,previousWarbondMinor:null}));
function pledge(id:string):Pledge{return {pledgeId:id,name:id,insurance:{kind:'lti',evidence:'Synthetic'},originalDescription:'',ships:[],ccus:[],protected:true,baseReleased:false,restrictions:[],acquisitionCost:null,unknownCostReason:'unknown',meltValue:null,sourceValues:{}};}
const base={...pledge('base'),ships:[{childId:'ship',modelName:'Starter',modelId:null,identity:'unresolved' as const,role:'unverified' as const}]};
function ccu(id:string,from:string,to:string):Pledge{return {...pledge(id),ccus:[{instanceId:id,from,to,status:'unused',applicability:'unverified',insurance:{kind:'unknown',reason:'Synthetic'}}]};}
function setup(values=[base,ccu('one','A','B'),ccu('alt','A','Alternative'),ccu('last','B','Target')]){const pool=prepareChains(values,ships,offers,true);return {pool,baseKey:pool.bases[0]!.key};}
function draft(keys:string[],pool:ReturnType<typeof setup>['pool'],baseKey:string):PlannerDraft{return {...emptyDraft(),mode:'manual',initialized:true,baseKey,anchors:keys.map(id=>{const c=pool.ccus.find(c=>c.pledgeId===id)!;return {kind:'owned',key:c.key,fromName:c.from.name,toName:c.to.name};})};}
test('manual order creates honest gaps, preserves source state and cannot double-use an exemplar',()=>{
 const {pool,baseKey}=setup(),before=JSON.stringify(pool),d=draft(['one','last'],pool,baseKey),p=manualChain(pool,ships[4]!,ships,offers,true,d);
 assert.deepEqual(p.steps.map(s=>s.kind),['purchase','owned','owned']);assert.equal(p.ownedCount,2);assert.equal(p.gapCount,1);assert.equal(p.additionalMinor,null);assert.equal(p.invalid,false);
 const duplicate=manualChain(pool,ships[4]!,ships,offers,true,{...d,anchors:[...d.anchors,d.anchors[0]!]});
 assert.ok(duplicate.invalid);assert.ok(duplicate.issues.includes('missing-ccu'));assert.equal(duplicate.steps.filter(s=>s.ccu?.pledgeId==='one').length,1);assert.equal(JSON.stringify(pool),before);
});
test('reordering marks backward gaps invalid rather than silently sorting; restore and removal are deterministic',()=>{
 const {pool,baseKey}=setup(),d=draft(['one','last'],pool,baseKey),reversed=manualChain(pool,ships[4]!,ships,offers,true,{...d,anchors:[...d.anchors].reverse()});
 assert.equal(reversed.invalid,true);assert.ok(reversed.steps.some(s=>s.validity==='invalid'));assert.deepEqual(reversed.steps.filter(s=>s.kind==='owned').map(s=>s.ccu!.pledgeId),['last','one']);
 assert.equal(manualChain(pool,ships[4]!,ships,offers,true,d).invalid,false);
 assert.equal(manualChain(pool,ships[4]!,ships,offers,true,{...d,anchors:[d.anchors[1]!]}).ownedCount,1);
});
test('unknown values remain explicit unverified links; removed CCUs and bases never become usable resources',()=>{
 const {pool,baseKey}=setup(),d=draft(['one','last'],pool,baseKey);
 const unknown=prepareChains([base,ccu('one','A','B'),ccu('last','B','Target')],ships,offers,false),p=manualChain(unknown,ships[4]!,ships,offers,false,d);
 assert.equal(p.ownedCount,2);assert.ok(p.steps.some(s=>s.validity==='unverified'));assert.equal(p.additionalMinor,null);
 const removed=manualChain({...pool,ccus:pool.ccus.filter(c=>c.pledgeId!=='one')},ships[4]!,ships,offers,true,d);
 assert.equal(removed.ownedCount,1);assert.equal(removed.steps.filter(s=>s.kind==='missing').length,1);assert.equal(removed.invalid,true);
 assert.ok(manualChain({...pool,bases:[]},ships[4]!,ships,offers,true,d).issues.includes('missing-base'));
 const changed={...pool,ccus:pool.ccus.map(c=>c.pledgeId==='one'?{...c,to:{...c.to,name:'Different variant'}}:c)};
 assert.ok(manualChain(changed,ships[4]!,ships,offers,true,d).issues.includes('missing-ccu'));
 assert.deepEqual(manualChain({...pool,limited:true},ships[4]!,ships,offers,true,d).issues,['limit']);
});
test('newly read exact CCUs fill proposed connections while explicit exemplar choices remain reserved',()=>{
 const {pool,baseKey}=setup(),d=draft(['one','last'],pool,baseKey),initial=manualChain(pool,ships[4]!,ships,offers,true,d);
 const gap=initial.steps[0]!,withGap={...d,anchors:[anchorFromStep(gap),...d.anchors]};
 const later=prepareChains([base,ccu('one','A','B'),ccu('alt','A','Alternative'),ccu('last','B','Target'),ccu('new','Starter','A')],ships,offers,true);
 const plan=manualChain(later,ships[4]!,ships,offers,true,withGap);assert.equal(plan.ownedCount,3);assert.equal(plan.gapCount,0);assert.equal(plan.additionalMinor,0);
 assert.equal(new Set(plan.steps.map(s=>s.ccu?.key)).size,3);assert.equal(withGap.anchors[0]!.kind,'purchase');
});
test('bounded variants share the chosen base and keep alternate model identities distinct',()=>{
 const {pool,baseKey}=setup(),variants=chainVariants(pool,ships[4]!,offers,true,baseKey);
 assert.ok(variants.length>=2);assert.ok(variants.length<=5);assert.ok(variants.every(v=>v.base.key===baseKey));
 assert.ok(variants.some(v=>v.steps.some(s=>s.to.name==='Alternative')));
 for(const v of variants)assert.equal(new Set(v.steps.filter(s=>s.kind==='owned').map(s=>s.key)).size,v.ownedCount);
});

test('a backward connection is a conflict, never a purchasable reverse CCU or a saved purchase anchor',()=>{
 const {pool,baseKey}=setup(),d=draft(['last','one'],pool,baseKey),p=manualChain(pool,ships[4]!,ships,offers,true,d);
 const conflicts=p.steps.filter(s=>s.kind==='conflict');assert.ok(conflicts.length>0);
 assert.ok(conflicts.every(s=>s.validity==='invalid'));assert.equal(p.gapCount,p.steps.filter(s=>s.kind==='purchase').length);
 for(const c of conflicts)assert.throws(()=>anchorFromStep(c),/conflict/);
 assert.deepEqual(p.steps.filter(s=>s.kind==='owned').map(s=>s.ccu!.pledgeId),['last','one']);
 assert.equal(p.steps.some(s=>s.kind==='purchase'&&s.from.nominalUsd!==null&&s.to.nominalUsd!==null&&s.from.nominalUsd>=s.to.nominalUsd),false);
});
test('a priority-reserved CCU never silently replaces a proposed purchase after apply; explicit own anchors remain visible',()=>{
 const {pool,baseKey}=setup(),d=draft(['one','last'],pool,baseKey),one=pool.ccus.find(c=>c.pledgeId==='one')!,reserved=[{kind:'ccu' as const,key:one.key}],bought={kind:'purchase' as const,fromKey:one.from.key,toKey:one.to.key,fromName:one.from.name,toName:one.to.name};
 const applied=manualChain(pool,ships[4]!,ships,offers,true,{...d,anchors:[bought,d.anchors[1]!] },reserved);
 assert.equal(applied.steps.some(s=>s.ccu?.key===one.key),false);assert.equal(applied.steps.filter(s=>s.kind==='purchase').length,2);assert.equal(applied.invalid,false);
 const explicit=manualChain(pool,ships[4]!,ships,offers,true,d,reserved);assert.equal(explicit.steps.some(s=>s.ccu?.key===one.key),true);assert.deepEqual(d.anchors.map(a=>a.kind),['owned','owned']);
});
