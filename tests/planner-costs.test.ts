import test from 'node:test';import assert from 'node:assert/strict';
import {additionalCost,paidCcuCost,chainCosts,chainSavings} from '../src/planner/costs';
import type {ChainStep,ChainBase} from '../src/planner/chain';import type {PricingSnapshot} from '../src/pricing/model';import type {Pledge} from '../src/domain/model';
const at=new Date().toISOString(),day=at.slice(0,10);
const display:PricingSnapshot={settings:{schemaVersion:1,language:'de',currency:'EUR',taxMode:'net',vatBasisPoints:1900},configured:true,settingsError:false,rate:{source:'ECB',sourceDate:day,fetchedAt:at,usdPerEurMicros:1250000},pending:false,rateError:false};
const model=(key:string,value:number|null)=>({key,name:key,nominalUsd:value,catalogueConfirmed:true});
const gap:ChainStep={key:'gap',kind:'purchase',from:model('from',35000),to:model('to',40000)};
const owned:ChainStep={...gap,key:'owned',kind:'owned',ccu:{key:'owned',pledgeId:'p',instanceId:'c',from:gap.from,to:gap.to,warbond:true,applicabilityConfirmed:false,protected:true}};
const pledge:Pledge={pledgeId:'p',name:'synthetic',insurance:{kind:'lti',evidence:'test'},originalDescription:'',ships:[],ccus:[{instanceId:'c',from:'from',to:'to',status:'unused',applicability:'unverified',insurance:{kind:'lti',evidence:'test'}}],protected:true,baseReleased:false,restrictions:[],acquisitionCost:null,unknownCostReason:'test',meltValue:null,sourceValues:{}};
const base:ChainBase={key:'base',pledgeId:'base',childId:'base',model:model('from',1000),pledgeName:'base',insurance:{kind:'lti',evidence:'test'},protected:true,released:false,multiShip:false,identityConfirmed:false};
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

test('unrepresentable totals stay unknown instead of rounding unsafe integer sums',()=>{
 const receipt={minor:Number.MAX_SAFE_INTEGER,currency:'EUR' as const,taxBasis:'net' as const,evidence:'Synthetic boundary invoice'},p={...pledge,acquisitionCost:receipt};
 const b={...pledge,pledgeId:'base',ccus:[],ships:[{childId:'base',modelName:'from',modelId:null,identity:'unresolved' as const,role:'unverified' as const}],acquisitionCost:receipt};
 const sum=chainCosts({base,steps:[owned]},[p,b],display,true);assert.equal(sum.paid.knownMinor,Number.MAX_SAFE_INTEGER);assert.equal(sum.paid.missing,1);assert.equal(sum.investment,null);
 const investment=chainCosts({base,steps:[gap]},[b],display,true);assert.equal(investment.paid.missing,0);assert.equal(investment.investment,null);
});
