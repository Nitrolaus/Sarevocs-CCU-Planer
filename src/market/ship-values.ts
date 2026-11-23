import {z} from 'zod';import type {CatalogueShip,TargetOffer} from './model';
export const SHIP_VALUES_URL='https://robertsspaceindustries.com/pledge-store/api/upgrade/v2/graphql';
export const SHIP_VALUES_QUERY='query filterShips { app { pricing { currencyCode exchangeRate taxRate isTaxInclusive } } from { ships { id name msrp } } }';
export const SHIP_VALUES_BODY=JSON.stringify([{operationName:'filterShips',variables:{},query:SHIP_VALUES_QUERY}]);
const row=z.object({id:z.number().int().positive().max(1_000_000_000),name:z.string().trim().min(1).max(240),minor:z.number().int().nonnegative().max(100_000_000)}).strict();
export const shipValuesSchema=z.object({schemaVersion:z.literal(1),source:z.literal('rsi-from-ships'),fetchedAt:z.iso.datetime({offset:true}),currency:z.literal('USD'),taxBasis:z.literal('net'),items:z.array(row).min(1).max(2000)}).strict().refine(v=>new Set(v.items.map(r=>r.id)).size===v.items.length);
export type ShipValues=z.infer<typeof shipValuesSchema>;
export function parseShipValues(raw:unknown,fetchedAt:string):ShipValues{
 const response=z.array(z.object({data:z.object({app:z.object({pricing:z.object({currencyCode:z.literal('USD'),exchangeRate:z.literal(1),taxRate:z.literal(0),isTaxInclusive:z.literal(false)})}),from:z.object({ships:z.array(z.object({id:row.shape.id,name:row.shape.name,msrp:row.shape.minor})).min(1).max(2000)})}),errors:z.array(z.unknown()).max(0).optional()})).length(1).parse(raw)[0]!;
 return shipValuesSchema.parse({schemaVersion:1,source:'rsi-from-ships',fetchedAt,currency:'USD',taxBasis:'net',items:response.data.from.ships.map(s=>({id:s.id,name:s.name,minor:s.msrp}))});
}
export function shipValuesStale(values?:ShipValues|null,now=Date.now()){const at=values?Date.parse(values.fetchedAt):NaN;return !Number.isFinite(at)||now-at>6*60*60*1000||at>now+5*60*1000;}
const normalized=(s:string)=>s.normalize('NFC').trim().replace(/\s+/g,' ').toLocaleLowerCase('en-US');
// Explicit legacy names require a fixed RSI ID and canonical variant. Never a fuzzy match.
const aliases:Record<string,{id:number;name:string}>={};
for(const [variant,id]of [['C2',162],['M2',163],['A2',164]] as const)for(const name of ['Hercules Starlifter '+variant,variant+' Hercules Starlifter'])aliases[normalized(name)]={id,name:variant+' Hercules'};
aliases[normalized('ROC DS')]={id:219,name:'ROC-DS'};
// RSI Hangar labels for the same models in the public ship matrix.
aliases[normalized('350r Racer')]={id:10,name:'350r'};
aliases[normalized('Nova Tank')]={id:154,name:'Nova'};
export function catalogueIdentity(name:string,catalogue:readonly CatalogueShip[]):CatalogueShip|undefined{
 const exact=catalogue.filter(s=>normalized(s.name)===normalized(name));if(exact.length)return exact.length===1?exact[0]:undefined;
 const alias=aliases[normalized(name)];if(!alias)return;const matches=catalogue.filter(s=>s.id===alias.id&&normalized(s.name)===normalized(alias.name));return matches.length===1?matches[0]:undefined;
}
export function sameModelName(a:string,b:string,catalogue:readonly CatalogueShip[]){if(normalized(a)===normalized(b))return true;const left=catalogueIdentity(a,catalogue),right=catalogueIdentity(b,catalogue);return !!left&&!!right&&left.id===right.id;}
export function nominalValue(ship:CatalogueShip,offers:readonly TargetOffer[],current:boolean,values?:ShipValues|null):number|null{
 if(!shipValuesStale(values)){const found=values!.items.find(v=>v.id===ship.id&&normalized(v.name)===normalized(ship.name));if(found)return found.minor>0?found.minor:null;}
 return current?offers.find(o=>o.change!=='missing'&&o.toShipId===ship.id&&o.targetName===ship.name)?.regularMinor??null:null;
}
