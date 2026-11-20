import type {ChainPlan,ChainPool,ChainStep} from './chain';
import {analyseReservations,availableForTarget,blockingPlanResources,type ReservablePlan,type ReservationTarget,type ResourceClaim} from './reservations';
import {searchChains,type SearchResult} from './search';
import type {CatalogueShip,TargetOffer} from '../market/model';
import type {PricingSnapshot} from '../pricing/model';
import {withStartBase} from './bases';

export type AdvisorTarget={slot:number;target:CatalogueShip;existing:ReservablePlan|null;manual:boolean;baseKey?:string|null};
export type AdvisorInput={pool:ChainPool;targets:AdvisorTarget[];offers:readonly TargetOffer[];current:boolean;display:PricingSnapshot};
export type AdvisorRow={slot:number;target:CatalogueShip;before:ReservablePlan|null;plan:ChainPlan|null;status:'preserved'|'alternative'|'no-path'|'limit'|'upstream'|'base-required'|'base-conflict';conflicts:ResourceClaim[];search:SearchResult|null};
export type PortfolioAdvice={rows:AdvisorRow[];complete:boolean;reason:'none'|'input'|'limit'|'no-path'};
type Limits={maxOperations?:number;maxMs?:number;totalMs?:number};
const claim=(row:AdvisorRow):ReservationTarget=>({slot:row.slot,targetId:row.target.id,name:row.target.name,plan:row.plan});
/** Rebuild an existing route from current exact physical resources. Invalid/locked/stale anchors are never reserved as a valid plan. */
export function canonicalPlan(value:ReservablePlan|null,target:CatalogueShip,pool:ChainPool):ChainPlan|null{
 if(!value?.base||value.steps.length>100)return null;
 const base=pool.bases.find(b=>b.key===value.base!.key);if(!base)return null;
 let cursor=base.model;const seen=new Set([cursor.key]),used=new Set<string>(),steps:ChainStep[]=[];
 for(const step of value.steps){
  if(step.from.key!==cursor.key||seen.has(step.to.key)||step.purchaseQuote)return null;
  if(step.kind==='owned'){
   const ccu=pool.ccus.find(c=>c.key===step.ccu?.key);if(!ccu||used.has(ccu.key)||ccu.from.key!==cursor.key||ccu.to.key!==step.to.key)return null;
   steps.push({key:ccu.key,kind:'owned',from:ccu.from,to:ccu.to,ccu});used.add(ccu.key);cursor=ccu.to;
  }else if(step.kind==='purchase'&&step.validity!=='invalid'&&cursor.nominalUsd!==null&&step.to.nominalUsd!==null&&step.to.nominalUsd>cursor.nominalUsd){
   const to=step.to;steps.push({...step,from:cursor,to,validity:'unverified'});cursor=to;
  }else return null;
  seen.add(cursor.key);
 }
 if(cursor.key!=='matrix:'+target.id)return null;
 return {base,target,steps,ownedCount:used.size,gapCount:steps.length-used.size,additionalMinor:steps.length===used.size?0:null,applicabilityConfirmed:base.identityConfirmed&&steps.every(s=>s.kind==='owned'&&s.ccu?.applicabilityConfirmed)};
}
function validTargets(targets:AdvisorTarget[]){return targets.length>0&&targets.length<=3&&new Set(targets.map(t=>t.slot)).size===targets.length&&new Set(targets.map(t=>t.target.id)).size===targets.length&&targets.every(t=>Number.isInteger(t.slot)&&t.slot>=0&&t.slot<3&&Number.isInteger(t.target.id)&&t.target.id>0);}
/** Lexicographic priority: target slot 1 owns resources before 2, then 3. Not a fleet-total minimum. */
export function advisePortfolio(input:AdvisorInput,limits:Limits={}):PortfolioAdvice{
 if(!validTargets(input.targets))return {rows:[],complete:false,reason:'input'};
 const rows:AdvisorRow[]=[],start=Date.now();let upstream=false;
 for(const entry of [...input.targets].sort((a,b)=>a.slot-b.slot)){
  const blocked=analyseReservations(rows.map(claim)).resources,scoped=withStartBase(input.pool,entry.baseKey),free=availableForTarget(scoped,blocked),existing=canonicalPlan(entry.existing,entry.target,scoped),conflicts=blockingPlanResources(entry.existing,blocked);
  const row:AdvisorRow={slot:entry.slot,target:entry.target,before:entry.existing,plan:null,status:'no-path',conflicts,search:null};rows.push(row);
  if(upstream){row.status='upstream';continue;}
  if(!scoped.bases.length){row.status='base-required';upstream=true;continue;}
  if(!free.bases.length){row.status='base-conflict';row.conflicts=blocked.filter(c=>c.kind==='base'&&c.key===entry.baseKey);upstream=true;continue;}
  // A valid manual design is a user constraint; only conflicting/invalid lower designs are replaced in the preview.
  if(entry.manual&&existing&&!conflicts.length){row.plan=existing;row.status='preserved';continue;}
  const remaining=(limits.totalMs??7000)-(Date.now()-start);
  if(remaining<=0){row.status='limit';upstream=true;continue;}
  const result=searchChains({...input,pool:free,target:entry.target},{observedPrices:true,maxVariants:1,maxOperations:limits.maxOperations,maxMs:Math.min(remaining,limits.maxMs??2500)});row.search=result;
  if(result.bestProven&&result.plans[0]){row.plan=result.plans[0].plan;row.status='alternative';}
  else {row.status=result.reason==='none'?'no-path':'limit';upstream=true;}
 }
 const complete=rows.every(r=>r.plan!==null)&&analyseReservations(rows.map(claim)).conflicts.length===0;
 return {rows,complete,reason:complete?'none':rows.some(r=>r.status==='limit')?'limit':'no-path'};
}

export { purchaseCandidates, type PurchaseCandidate } from './warbond-tier';
import { purchaseCandidates, type PurchaseCandidate } from './warbond-tier';
export type PurchasePath={slot:number;target:CatalogueShip;plan:ChainPlan|null;withoutPlan:ChainPlan|null;withoutUsd:number|null;withUsd:number|null;benefitUsd:number|null;proven:boolean;reason:'none'|'limit'|'no-path'|'priority'|'basis';reservedFor:string[]};
export type PurchaseRow={candidate:PurchaseCandidate;paths:PurchasePath[];best:PurchasePath|null;status:'useful'|'equal'|'covered'|'unhelpful'|'unproven'};
export type PurchaseAdvice={rows:PurchaseRow[];complete:boolean;reason:'none'|'stale'|'identity'|'input'|'limit'|'no-candidates';tierUsd:number|null;discountUsd:number|null;offerKey:string;sourceAt:string|null};
/** Compare the full remaining cost WITH the offered CCU against an independent route WITHOUT buying it. */
export function advisePurchase(input:AdvisorInput,offer:TargetOffer,limits:Limits={}):PurchaseAdvice{
 const candidates=purchaseCandidates(input,offer),result:PurchaseAdvice={rows:[],complete:false,reason:candidates.reason,tierUsd:candidates.tier,discountUsd:offer.warbondMinor===null?null:offer.regularMinor-offer.warbondMinor,offerKey:offer.key,sourceAt:input.pool.values?.fetchedAt??null};
 if(candidates.reason!=='none')return result;if(!validTargets(input.targets)){result.reason='input';return result;}
 const start=Date.now(),claims:ReservationTarget[]=[];let upstream=false,limited=false;
 const budgets=()=>({maxVariants:1,maxOperations:limits.maxOperations,maxMs:Math.max(1,Math.min(limits.maxMs??1800,(limits.totalMs??16000)-(Date.now()-start)))});
 const reference=new Map<number,{pool:ChainPool;baseline:SearchResult|null;reservedFor:string[];priorityBlocked:boolean;baseMissing:boolean}>();
 for(const entry of [...input.targets].sort((a,b)=>a.slot-b.slot)){
  const blocked=analyseReservations(claims).resources,free=availableForTarget(withStartBase(input.pool,entry.baseKey),blocked),remaining=(limits.totalMs??16000)-(Date.now()-start);
  const baseline=!upstream&&remaining>0?searchChains({...input,pool:free,target:entry.target},budgets()):null;
  reference.set(entry.slot,{pool:free,baseline,reservedFor:[...new Set(blocked.map(c=>c.winner.name))],priorityBlocked:upstream,baseMissing:!free.bases.length});
  const manual=entry.manual?canonicalPlan(entry.existing,entry.target,free):null,plan=manual??(baseline?.bestProven?baseline.plans[0]?.plan:null);
  if(plan)claims.push({slot:entry.slot,targetId:entry.target.id,name:entry.target.name,plan});else upstream=true;
 }
 for(const candidate of candidates.rows){const paths:PurchasePath[]=[];
  for(const entry of [...input.targets].sort((a,b)=>a.slot-b.slot)){
   const ref=reference.get(entry.slot)!,key=offer.key+':'+candidate.ship.id;
   if(ref.priorityBlocked||ref.baseMissing){paths.push({slot:entry.slot,target:entry.target,plan:null,withoutPlan:null,withoutUsd:null,withUsd:null,benefitUsd:null,proven:false,reason:ref.baseMissing?'basis':'priority',reservedFor:ref.reservedFor});continue;}
   const remaining=(limits.totalMs??16000)-(Date.now()-start),search=remaining>0?searchChains({...input,pool:ref.pool,target:entry.target,requiredPurchase:{key,from:candidate.from,to:candidate.to,usdMinor:candidate.usdMinor}},budgets()):null;
   const best=search?.bestProven?search.plans[0]:undefined,baseline=ref.baseline?.bestProven?ref.baseline.plans[0]:undefined;
   const exhausted=!search||search.reason!=='none'&&!search.bestProven||!ref.baseline||!ref.baseline.bestProven&&ref.baseline.reason!=='none';limited ||= exhausted;
   const withoutUsd=baseline?.rankScore[0]??null,withUsd=best?.rankScore[0]??null;
   paths.push({slot:entry.slot,target:entry.target,plan:best?.plan??null,withoutPlan:baseline?.plan??null,withoutUsd,withUsd,benefitUsd:withoutUsd!==null&&withUsd!==null?withoutUsd-withUsd:null,proven:!!best&&!!baseline,reason:exhausted?'limit':best?'none':'no-path',reservedFor:ref.reservedFor});
  }
  const viable=paths.filter(p=>p.proven&&p.benefitUsd!==null).sort((a,b)=>b.benefitUsd!-a.benefitUsd!||a.slot-b.slot);
  // A useful new CCU also goes to the first benefiting target, even if a later target could save more.
  const firstBenefiting=viable.filter(p=>p.benefitUsd!>0).sort((a,b)=>a.slot-b.slot)[0],best=firstBenefiting??viable[0]??null;
  const unknown=paths.some(p=>p.reason==='limit'||p.reason==='priority'||p.reason==='basis'||p.withUsd!==null&&!p.proven);
  result.rows.push({candidate,paths,best,status:best&&best.benefitUsd!>0?'useful':unknown?'unproven':best?.benefitUsd===0?'equal':paths.some(p=>p.withoutUsd===0)?'covered':'unhelpful'});
 }
 result.complete=!limited&&!upstream;result.reason=limited?'limit':'none';
 result.rows.sort((a,b)=>(a.best&&a.best.benefitUsd!>0?a.best.slot:4)-(b.best&&b.best.benefitUsd!>0?b.best.slot:4)||(b.best?.benefitUsd??-Infinity)-(a.best?.benefitUsd??-Infinity)||a.candidate.ship.name.localeCompare(b.candidate.ship.name));return result;
}
