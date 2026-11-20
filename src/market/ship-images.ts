import {z} from 'zod';import type {CatalogueShip} from './model';
/** Only public, fixed-size slideshow pictures. No user URLs, queries, credentials or arbitrary RSI routes. */
export function safeRsiShipImageUrl(raw:unknown):string|null{
 if(typeof raw!=='string'||raw.length>240)return null;try{const u=new URL(raw);return u.protocol==='https:'&&u.hostname==='media.robertsspaceindustries.com'&&!u.port&&!u.username&&!u.password&&!u.search&&!u.hash&&/^\/[A-Za-z0-9_-]{6,80}\/slideshow\.(?:jpg|png|webp)$/.test(u.pathname)&&u.href===raw?raw:null;}catch{return null;}
}
export const shipImagesSchema=z.object({schemaVersion:z.literal(1),source:z.literal('rsi-ship-matrix'),fetchedAt:z.iso.datetime({offset:true}),items:z.array(z.object({shipId:z.number().int().positive(),name:z.string().trim().min(1).max(240),url:z.string().refine(s=>safeRsiShipImageUrl(s)===s)}).strict()).max(2000)}).strict().refine(v=>new Set(v.items.map(i=>i.shipId)).size===v.items.length);
export type ShipImages=z.infer<typeof shipImagesSchema>;
export function parseShipImages(raw:unknown,ships:readonly CatalogueShip[],fetchedAt:string):ShipImages{
 const items:ShipImages['items']=[];if(raw&&typeof raw==='object'&&'data'in raw&&Array.isArray(raw.data)&&raw.data.length<=2000)for(const row of raw.data){if(!row||typeof row!=='object')continue;const ship=ships.find(s=>String(s.id)===String(row.id)&&typeof row.name==='string'&&s.name===row.name.trim());if(!ship||!Array.isArray(row.media))continue;const urls=row.media.slice(0,100).map((m:unknown)=>m&&typeof m==='object'&&'images'in m&&m.images&&typeof m.images==='object'&&'slideshow'in m.images?safeRsiShipImageUrl(m.images.slideshow):null),url=urls.find((u:unknown):u is string=>typeof u==='string');if(url)items.push({shipId:ship.id,name:ship.name,url});}
 return shipImagesSchema.parse({schemaVersion:1,source:'rsi-ship-matrix',fetchedAt,items});
}
export function imageForShip(ship:CatalogueShip|undefined,images?:ShipImages|null):string|null{if(!ship)return null;const found=images?.items.find(i=>i.shipId===ship.id&&i.name===ship.name);return safeRsiShipImageUrl(found?.url);}
