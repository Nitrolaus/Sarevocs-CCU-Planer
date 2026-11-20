import {z} from 'zod';
import type {ChainStep} from './chain';
const label=z.string().trim().min(1).max(500),modelKey=z.string().min(1).max(550);
const resourceKey=z.string().max(650).refine(value=>{try{const a=JSON.parse(value);return Array.isArray(a)&&a.length===2&&a.every(x=>typeof x==='string'&&x.length>0&&x.length<=160)&&JSON.stringify(a)===value;}catch{return false;}});
export const draftAnchorSchema=z.discriminatedUnion('kind',[
  z.object({kind:z.literal('owned'),key:resourceKey,fromName:label,toName:label}).strict(),
  z.object({kind:z.literal('purchase'),fromKey:modelKey,toKey:modelKey,fromName:label,toName:label}).strict()
    .refine(a=>a.fromKey!==a.toKey),
]);
export const draftSchema=z.object({mode:z.enum(['auto','manual']),initialized:z.boolean(),baseKey:z.union([z.literal(''),resourceKey]),
  baseApprovedKey:resourceKey.optional(),anchors:z.array(draftAnchorSchema).max(100)}).strict().refine(d=>{const keys=d.anchors.filter(a=>a.kind==='owned').map(a=>a.key);return new Set(keys).size===keys.length;});
export type DraftAnchor=z.infer<typeof draftAnchorSchema>;
export type PlannerDraft=z.infer<typeof draftSchema>;
export const emptyDraft=():PlannerDraft=>({mode:'auto',initialized:false,baseKey:'',anchors:[]});
export const targetIdSchema=z.number().int().positive().max(1_000_000_000);
export const draftBatchSchema=z.array(z.object({targetId:targetIdSchema,draft:draftSchema,expected:draftSchema}).strict()).min(1).max(3).refine(rows=>new Set(rows.map(r=>r.targetId)).size===rows.length);
export const draftFileSchema=z.object({schemaVersion:z.literal(1),accountId:z.uuid(),targets:z.array(z.object({targetId:targetIdSchema,
  draft:draftSchema,updatedAt:z.iso.datetime({offset:true})}).strict()).max(30)}).strict()
  .refine(f=>new Set(f.targets.map(t=>t.targetId)).size===f.targets.length);
export function anchorFromStep(step:ChainStep):DraftAnchor{
  if(step.kind==='conflict'||step.purchaseQuote)throw new Error('A conflict or hypothetical purchase cannot be saved as a stock anchor.');
  return step.kind==='owned'||step.kind==='missing'
    ? {kind:'owned',key:step.ccu?.key??step.referenceKey!,fromName:step.from.name,toName:step.to.name}
    : {kind:'purchase',fromKey:step.from.key,toKey:step.to.key,fromName:step.from.name,toName:step.to.name};
}
