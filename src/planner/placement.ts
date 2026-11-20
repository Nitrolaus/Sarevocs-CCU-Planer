import type {ChainModel,ChainPool} from './chain';
import {draftSchema,type DraftAnchor,type PlannerDraft} from './draft';
import {matchingOffer,type CatalogueShip,type TargetOffer} from '../market/model';
import {catalogueIdentity,sameModelName,nominalValue} from '../market/ship-values';

export type Placement={status:'direct'|'gap'|'unverified'|'blocked';draft?:PlannerDraft;reason?:'duplicate'|'changed'|'order'|'limit'};
/** Check the two new boundaries only. Existing unrelated draft errors remain editable. */
export function previewPlacement(pool:ChainPool,target:CatalogueShip,catalogue:readonly CatalogueShip[],offers:readonly TargetOffer[],current:boolean,
  draft:PlannerDraft,anchor:DraftAnchor,index:number,replace=false,sourceIndex?:number):Placement{
  const blocked=(reason:Placement['reason']):Placement=>({status:'blocked',reason});
  if(pool.limited||!Number.isInteger(index)||index<0||index>draft.anchors.length)return blocked('limit');
  const model=(key:string,name:string):ChainModel=>{
    const held=pool.bases.map(b=>b.model).concat(pool.ccus.flatMap(c=>[c.from,c.to])).find(m=>m.key===key);if(held)return held;
    const ship=catalogue.find(s=>'matrix:'+s.id===key)??(key.startsWith('observed:')?catalogueIdentity(name,catalogue):undefined);return {key:ship?'matrix:'+ship.id:key,name:ship?.name??name,catalogueConfirmed:!!ship,nominalUsd:ship?nominalValue(ship,offers,current,pool.values):null};
  };
  const endpoints=(a:DraftAnchor)=>{
    if(a.kind==='purchase')return {from:model(a.fromKey,a.fromName),to:model(a.toKey,a.toName)};
    const c=pool.ccus.find(c=>c.key===a.key&&sameModelName(c.from.name,a.fromName,catalogue)&&sameModelName(c.to.name,a.toName,catalogue));return c?{from:c.from,to:c.to}:null;
  };
  const item=endpoints(anchor);if(!item||item.from.key===item.to.key)return blocked('changed');
  if(anchor.kind==='purchase'&&item.from.nominalUsd!==null&&item.to.nominalUsd!==null&&item.from.nominalUsd>=item.to.nominalUsd)return blocked('order');
  const anchors=[...draft.anchors];let to=index;
  if(sourceIndex!==undefined){
    if(!Number.isInteger(sourceIndex)||sourceIndex<0||sourceIndex>=anchors.length)return blocked('changed');
    const original=anchors[sourceIndex]!,origin=endpoints(original);if(original.kind!==anchor.kind||!origin||origin.from.key!==item.from.key||origin.to.key!==item.to.key||original.kind==='owned'&&anchor.kind==='owned'&&original.key!==anchor.key)return blocked('changed');
    anchors.splice(sourceIndex,1);if(sourceIndex<to)to--;replace=false;
  }
  if(replace&&to<anchors.length)anchors.splice(to,1);
  if(anchor.kind==='owned'&&anchors.some(a=>a.kind==='owned'&&a.key===anchor.key))return blocked('duplicate');
  const left=to?endpoints(anchors[to-1]!)?.to:pool.bases.find(b=>b.key===draft.baseKey)?.model;
  const right=to<anchors.length?endpoints(anchors[to]!)?.from:model('matrix:'+target.id,target.name);
  const boundary=(a:ChainModel|undefined,b:ChainModel|undefined)=>{
    if(!a||!b)return 'unverified';if(a.key===b.key)return 'direct';
    return a.nominalUsd===null||b.nominalUsd===null?'unverified':a.nominalUsd<b.nominalUsd?'gap':'blocked';
  };
  const states=[boundary(left,item.from),boundary(item.to,right)];
  if(states.includes('blocked'))return blocked('order');
  anchors.splice(to,0,anchor);const next={...draft,mode:'manual' as const,initialized:true,anchors};
  if(!draftSchema.safeParse(next).success)return blocked('limit');
  return {status:states.includes('unverified')?'unverified':states.includes('gap')?'gap':'direct',draft:next};
}
