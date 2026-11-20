import {buildChain,type ChainPool,type ChainPlan,type ChainModel,type ChainStep,type ChainBase} from './chain';
import {matchingOffer,type CatalogueShip,type TargetOffer} from '../market/model';
import type { PricingSnapshot } from '../pricing/model';
import type {PlannerDraft} from './draft';
import {catalogueIdentity,sameModelName,nominalValue} from '../market/ship-values';
export type ManualPlan={base:ChainBase|null;target:CatalogueShip;steps:ChainStep[];ownedCount:number;gapCount:number;additionalMinor:0|null;
  applicabilityConfirmed:false;invalid:boolean;issues:('missing-base'|'missing-ccu'|'invalid-order'|'unknown-link'|'limit')[]};
export function manualChain(pool:ChainPool,target:CatalogueShip,catalogue:readonly CatalogueShip[],offers:readonly TargetOffer[],current:boolean,draft:PlannerDraft,unavailable:readonly {kind:'base'|'ccu';key:string}[]=[]):ManualPlan{
  if(pool.limited)return {base:null,target,steps:[],ownedCount:0,gapCount:0,additionalMinor:null,applicabilityConfirmed:false,invalid:true,issues:['limit']};
  const models=new Map<string,ChainModel>();for(const b of pool.bases)models.set(b.model.key,b.model);for(const c of pool.ccus){models.set(c.from.key,c.from);models.set(c.to.key,c.to);}
  const resolve=(key:string,name:string):ChainModel=>{const held=models.get(key);if(held)return held;const ship=catalogue.find(s=>'matrix:'+s.id===key)??(key.startsWith('observed:')?catalogueIdentity(name,catalogue):undefined),resolvedKey=ship?'matrix:'+ship.id:key;
    return models.get(resolvedKey)??{key:resolvedKey,name:ship?.name??name,catalogueConfirmed:!!ship,nominalUsd:ship?nominalValue(ship,offers,current,pool.values):null};};
  const blockedBases=new Set(unavailable.filter(r=>r.kind==='base').map(r=>r.key)),blockedCcus=new Set(unavailable.filter(r=>r.kind==='ccu').map(r=>r.key));
  const goal=resolve('matrix:'+target.id,target.name),base=pool.bases.find(b=>b.key===draft.baseKey)??(!draft.baseKey?buildChain({...pool,bases:pool.bases.filter(b=>!blockedBases.has(b.key)),ccus:pool.ccus.filter(c=>!blockedCcus.has(c.key))},target,offers,current)?.base:null)??null;
  const issues:ManualPlan['issues']=base?[]:['missing-base'],steps:ChainStep[]=[],used=new Set<string>();
  const explicit=new Set(draft.anchors.filter(a=>a.kind==='owned').map(a=>a.key));let cursor=base?.model;
  function connection(from:ChainModel,to:ChainModel,anchorIndex?:number){
    if(from.key===to.key)return;
    const ccu=pool.ccus.find(c=>c.from.key===from.key&&c.to.key===to.key&&!blockedCcus.has(c.key)&&!used.has(c.key)&&!explicit.has(c.key));
    if(ccu){used.add(ccu.key);steps.push({key:ccu.key,kind:'owned',from,to,ccu,...(anchorIndex!==undefined?{anchorIndex}:{})});return;}
    const invalid=from.nominalUsd!==null&&to.nominalUsd!==null&&from.nominalUsd>=to.nominalUsd;
    const unknown=from.nominalUsd===null||to.nominalUsd===null;
    if(invalid)issues.push('invalid-order');else if(unknown)issues.push('unknown-link');
    steps.push({key:'manual-gap:'+steps.length+':'+from.key+':'+to.key,kind:invalid?'conflict':'purchase',from,to,
      ...(anchorIndex!==undefined?{anchorIndex}:{}),...(invalid?{validity:'invalid' as const}:unknown?{validity:'unverified' as const}:{})});
  }
  draft.anchors.forEach((a,index)=>{
    if(a.kind==='owned'){
      const ccu=pool.ccus.find(c=>c.key===a.key&&!used.has(c.key)&&sameModelName(c.from.name,a.fromName,catalogue)&&sameModelName(c.to.name,a.toName,catalogue));
      const from=ccu?.from??resolve('missing-from:'+index,a.fromName),to=ccu?.to??resolve('missing-to:'+index,a.toName);
      if(cursor)connection(cursor,from);
      if(ccu){used.add(ccu.key);steps.push({key:ccu.key,kind:'owned',from,to,ccu,anchorIndex:index});}
      else{issues.push('missing-ccu');steps.push({key:'missing:'+index,kind:'missing',from,to,anchorIndex:index,referenceKey:a.key,validity:'invalid'});}
      cursor=to;
    }else{const from=resolve(a.fromKey,a.fromName),to=resolve(a.toKey,a.toName);if(cursor)connection(cursor,from);connection(from,to,index);cursor=to;}
  });
  if(cursor)connection(cursor,goal);
  const invalid=issues.some(i=>i!=='unknown-link'),gapCount=steps.filter(s=>s.kind==='purchase').length;
  return {base,target,steps,ownedCount:steps.filter(s=>s.kind==='owned').length,gapCount,additionalMinor:!invalid&&!gapCount?0:null,
    applicabilityConfirmed:false,invalid,issues:[...new Set(issues)]};
}
/** A bounded set of alternatives for the same base, not an exhaustive purchase optimizer. */
export function chainVariants(pool:ChainPool,target:CatalogueShip,offers:readonly TargetOffer[],current:boolean,baseKey?:string,display?:PricingSnapshot):ChainPlan[]{
  const first=buildChain(pool,target,offers,current,baseKey,display);if(!first)return [];
  const result=[first],signature=(p:ChainPlan)=>JSON.stringify(p.steps.map(s=>[s.kind,s.from.key,s.to.key]));const seen=new Set([signature(first)]);
  for(const step of first.steps.filter(s=>s.kind==='owned').slice(0,8)){
    const alternative=buildChain({...pool,ccus:pool.ccus.filter(c=>!(c.from.key===step.from.key&&c.to.key===step.to.key))},target,offers,current,first.base.key,display);
    if(alternative&&alternative.ownedCount>0&&!seen.has(signature(alternative))){seen.add(signature(alternative));result.push(alternative);if(result.length===5)break;}
  }
  return result;
}
