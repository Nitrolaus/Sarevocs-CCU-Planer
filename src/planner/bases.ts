import type {ChainBase,ChainPool} from './chain';import type {PlannerDraft} from './draft';import {draftSchema} from './draft';
import type {PricingSnapshot} from '../pricing/model';import {estimatePlanningMinor,euroRateIsStale} from '../pricing/money';

/** Older drafts have no consent marker. A numeric advantage never grants permission to use a ship. */
export function selectedStartBase(pool:ChainPool,draft:PlannerDraft):ChainBase|null{
 if(!draft.baseKey||draft.baseApprovedKey!==draft.baseKey)return null;
 return pool.bases.find(b=>b.key===draft.baseKey&&b.insurance.kind==='lti')??null;
}
export function withStartBase(pool:ChainPool,key:string|null|undefined):ChainPool{return {...pool,bases:key?pool.bases.filter(b=>b.key===key&&b.insurance.kind==='lti'):[]};}
export function approveStartBase(pool:ChainPool,draft:PlannerDraft,key:string):PlannerDraft{
 if(!pool.bases.some(b=>b.key===key&&b.insurance.kind==='lti'))throw Error('LTI_START_REQUIRED');
 return draftSchema.parse({...draft,baseKey:key,baseApprovedKey:key});
}
/** Cheap is a current EUR estimate before VAT. Unknown/stale FX is never classified as cheap. */
export function inexpensiveStartBase(base:ChainBase,display:PricingSnapshot):boolean{
 if(base.insurance.kind!=='lti'||base.model.nominalUsd===null)return false;
 const rate=display.rate&&!euroRateIsStale(display.rate)?display.rate:null;
 const euro=estimatePlanningMinor(base.model.nominalUsd,{...display.settings,currency:'EUR',taxMode:'net'},rate);
 return euro!==null&&euro>0&&euro<=5000;
}
export function startBaseChoices(pool:ChainPool,display:PricingSnapshot,includeHigher:boolean,selectedKey?:string):ChainBase[]{
 return pool.bases.filter(b=>b.insurance.kind==='lti'&&(includeHigher||b.key===selectedKey||inexpensiveStartBase(b,display))).sort((a,b)=>(a.model.nominalUsd??Infinity)-(b.model.nominalUsd??Infinity)||a.model.name.localeCompare(b.model.name)||a.key.localeCompare(b.key));
}
