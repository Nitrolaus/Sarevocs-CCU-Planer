import {z} from 'zod';import type {ChainBase,ChainStep,ChainPool} from './chain';
export const priorityOrderSchema=z.tuple([z.number().int().min(0).max(2),z.number().int().min(0).max(2),z.number().int().min(0).max(2)]).refine(v=>new Set(v).size===3);
export type PriorityOrder=z.infer<typeof priorityOrderSchema>;export const DEFAULT_PRIORITIES:PriorityOrder=[0,1,2];
export type ReservablePlan={base:ChainBase|null;steps:readonly ChainStep[]};
export type ReservationTarget={slot:number;targetId:number;name:string;plan:ReservablePlan|null;noPricedRoute?:boolean};
export type ResourceOwner={slot:number;targetId:number;name:string;rank:number};
export type ResourceClaim={kind:'base'|'ccu';key:string;label:string;owners:ResourceOwner[];winner:ResourceOwner};
export type Reservations={targets:ResourceOwner[];resources:ResourceClaim[];conflicts:ResourceClaim[]};
/** Each physical exemplar is a resource. Equal endpoints or equal ship models are not identity. */
export function analyseReservations(targets:readonly ReservationTarget[],priority:PriorityOrder=DEFAULT_PRIORITIES):Reservations{
 const order=priorityOrderSchema.parse(priority);if(targets.length>3||new Set(targets.map(t=>t.targetId)).size!==targets.length||new Set(targets.map(t=>t.slot)).size!==targets.length||targets.some(t=>!Number.isInteger(t.slot)||t.slot<0||t.slot>2||!Number.isInteger(t.targetId)||t.targetId<=0))throw Error('RESERVATION_TARGETS');
 const owners=targets.map(t=>({slot:t.slot,targetId:t.targetId,name:t.name,rank:order.indexOf(t.slot)+1})),resources=new Map<string,Omit<ResourceClaim,'winner'>>();
 function claim(kind:ResourceClaim['kind'],key:string,label:string,owner:ResourceOwner){const id=kind+':'+key,existing=resources.get(id);if(existing){if(!existing.owners.some(o=>o.targetId===owner.targetId))existing.owners.push(owner);}else resources.set(id,{kind,key,label,owners:[owner]});}
 targets.forEach((target,i)=>{const p=target.plan,owner=owners[i]!;if(p?.base)claim('base',p.base.key,p.base.model.name,owner);for(const s of p?.steps??[])if(s.kind==='owned'&&s.ccu)claim('ccu',s.ccu.key,s.from.name+' → '+s.to.name,owner);});
 const claims=[...resources.values()].map(r=>{const sorted=[...r.owners].sort((a,b)=>a.rank-b.rank);return {...r,owners:sorted,winner:sorted[0]!};});return {targets:owners,resources:claims,conflicts:claims.filter(r=>r.owners.length>1)};
}
export function blockedForTarget(reservations:Reservations,targetId:number){const owner=reservations.targets.find(t=>t.targetId===targetId);return owner?reservations.resources.filter(r=>r.winner.targetId!==targetId&&r.winner.rank<owner.rank):[];}
export function conflictsForTarget(reservations:Reservations,targetId:number){return reservations.conflicts.filter(r=>r.owners.some(o=>o.targetId===targetId));}
/** Filter physical resources for a new search only. Full stock and existing drafts stay unchanged. */
export function availableForTarget(pool:ChainPool,blocked:readonly ResourceClaim[]):ChainPool{const bases=new Set(blocked.filter(r=>r.kind==='base').map(r=>r.key)),ccus=new Set(blocked.filter(r=>r.kind==='ccu').map(r=>r.key));return {...pool,bases:pool.bases.filter(b=>!bases.has(b.key)),ccus:pool.ccus.filter(c=>!ccus.has(c.key))};}
export function blockingPlanResources(plan:ReservablePlan|null|undefined,blocked:readonly ResourceClaim[]):ResourceClaim[]{if(!plan)return [];const ccus=new Set(plan.steps.filter(s=>s.kind==='owned'&&s.ccu).map(s=>s.ccu!.key));return blocked.filter(r=>r.kind==='base'?r.key===plan.base?.key:ccus.has(r.key));}
export function movePriority(order:PriorityOrder,slot:number,rank:number):PriorityOrder{const before=priorityOrderSchema.parse(order);if(!Number.isInteger(slot)||slot<0||slot>2||!Number.isInteger(rank)||rank<1||rank>3)throw Error('PRIORITY_RANGE');const next=before.filter(s=>s!==slot);next.splice(rank-1,0,slot);return priorityOrderSchema.parse(next);}
