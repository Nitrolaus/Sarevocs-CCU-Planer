import { z } from 'zod';
import type { DerivedLoaner } from './derive';

export const loanerReviewKeySchema=z.string().regex(/^[a-f0-9]{64}$/);
export const loanerDecisionSchema=z.enum(['present','absent','unconfirmed']);
export type LoanerDecision=z.infer<typeof loanerDecisionSchema>;
const entrySchema=z.object({state:z.enum(['present','absent']),updatedAt:z.iso.datetime({offset:true})}).strict();
export const loanerReviewFileSchema=z.object({schemaVersion:z.literal(1),accountId:z.uuid(),
  entries:z.record(loanerReviewKeySchema,entrySchema).refine(value=>Object.keys(value).length<=1500)}).strict();
export type LoanerReviewFile=z.infer<typeof loanerReviewFileSchema>;
export type LoanerReviewsSnapshot={accountId:string;readable:boolean;entries:LoanerReviewFile['entries']};
/** The meaning of the mapping matters; source fetch times and array order do not. */
export function loanerReviewBasis(row:DerivedLoaner):string {
  return JSON.stringify([row.key,[...new Set(row.origins.map(o=>JSON.stringify([o.pledgeId,o.childId,o.parent,o.publishedParent,o.kind,o.source,o.replaces])))].sort()]);
}
export async function loanerReviewKey(basis:string):Promise<string>{
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(basis));
  return Array.from(new Uint8Array(bytes),n=>n.toString(16).padStart(2,'0')).join('');
}
