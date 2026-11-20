import {z} from 'zod';
import type {Pledge} from '../domain/model';
import type {ChainPool} from './chain';
export const ccuResourceKeySchema=z.string().min(5).max(1000).refine(value=>{
 try{const pair:unknown=JSON.parse(value);return Array.isArray(pair)&&pair.length===2&&pair.every(v=>typeof v==='string'&&v.length>0&&v.length<=160)&&JSON.stringify(pair)===value;}catch{return false;}
});
export const excludedCcusSchema=z.array(ccuResourceKeySchema).max(50000).refine(keys=>new Set(keys).size===keys.length);
export function ccuKeysIn(pledges:readonly Pledge[]):Set<string>{return new Set(pledges.flatMap(p=>p.ccus.filter(c=>c.status!=='applied'&&c.applicability!=='rejected').map(c=>JSON.stringify([p.pledgeId,c.instanceId]))));}
/** Physical exemplars only: identical endpoints remain separate resources. */
export function withoutExcludedCcus(pool:ChainPool,excluded:readonly string[]):ChainPool{const keys=new Set(excluded);return {...pool,ccus:pool.ccus.filter(c=>!keys.has(c.key))};}
