import {eligiblePaintSku,paintRuleApplies,bestPaintRule,paintPieceCost,type PaintAdvice,type PaintInventoryRow,type PaintPiece} from './advice';
import {paintCatalogueStale,type PaintCatalogue,type PaintRule,type PaintSku} from './model';

export type PaintTierStep={percent:number;required:number;qualifying:number;missing:number;complete:boolean;extra:{skuId:string;title:string;minor:number}[];extraCostMinor:number|null;existingCostMinor:number|null;totalCostMinor:number|null;freeMinor:number|null;changeMinor:number|null};
export type PaintTierAdvice={state:'unavailable'|'no-rules'|'maximum'|'higher';distinctPositions:number;currentPercent:number;maximumPercent:number|null;next:PaintTierStep|null;maximum:PaintTierStep|null};
const normalized=(name:string)=>name.normalize('NFC').trim().replace(/\s+/g,' ').toLocaleLowerCase('en-US');
const distinct=(pieces:readonly PaintPiece[],rule:PaintRule)=>new Set(pieces.filter(p=>paintRuleApplies(rule,p.sku)).map(p=>p.sku.id)).size;
function ownedNames(inventory:readonly PaintInventoryRow[]){
 const names=new Set<string>();for(const {pledge} of inventory){const raw=pledge.sourceValues.items;if(typeof raw!=='string'||raw.length>4000)continue;
  try{const entries:unknown=JSON.parse(raw);if(Array.isArray(entries)&&entries.length<=100)for(const item of entries)if(item&&typeof item.title==='string'&&item.title.length<=500&&/^(skin|paint)$/i.test(item.kind?.trim()??''))names.add(normalized(item.title));}catch{/* Unknown own content is never added to the current replacement plan. */}
 }return names;
}
/** Optional, costed additions to the existing known replacement basket; not a global cart optimizer. */
export function paintTierAdvice(advice:PaintAdvice,data:PaintCatalogue|null,inventory:readonly PaintInventoryRow[],now=Date.now()):PaintTierAdvice {
 const empty:PaintTierAdvice={state:'unavailable',distinctPositions:0,currentPercent:advice.percent,maximumPercent:null,next:null,maximum:null};
 if(!data||paintCatalogueStale(data,now)||!advice.ready||advice.totalOldMinor===null||advice.totalFreeMinor===null||!advice.basket.length)return empty;
 const lookup=new Map(data.skus.map(s=>[s.id,s])),pieces:PaintPiece[]=[];for(const line of advice.basket){const sku=lookup.get(line.skuId);if(!sku||!eligiblePaintSku(sku)||!Number.isSafeInteger(line.quantity)||line.quantity<1)return empty;pieces.push({sku,quantity:line.quantity});}
 const quantities=new Map<string,number>();for(const p of pieces)quantities.set(p.sku.id,(quantities.get(p.sku.id)??0)+p.quantity);
 if(pieces.some(p=>quantities.get(p.sku.id)!<Math.max(1,p.sku.minQty)||quantities.get(p.sku.id)!>(p.sku.maxQty||1)))return empty;
 const positions=new Set(pieces.map(p=>p.sku.id));
 const rules=data.rules.filter(r=>r.percent>0&&r.percent<100&&r.amountOff===null&&r.maximum===null&&Number.isInteger(r.percent*100)&&data.skus.some(s=>eligiblePaintSku(s)&&paintRuleApplies(r,s)));
 if(!rules.length)return {...empty,state:'no-rules',distinctPositions:positions.size};
 const maximumPercent=Math.max(...rules.map(r=>r.percent));
 if(advice.percent>=maximumPercent)return {...empty,state:'maximum',distinctPositions:positions.size,maximumPercent};
 const names=ownedNames(inventory);for(const p of pieces)for(const c of p.sku.contents)names.add(normalized(c.name));
 const choose=(rule:PaintRule):PaintTierStep=>{
  const qualifying=distinct(pieces,rule),missing=Math.max(0,rule.from-qualifying),step:PaintTierStep={percent:rule.percent,required:rule.from,qualifying,missing,complete:false,extra:[],extraCostMinor:null,existingCostMinor:null,totalCostMinor:null,freeMinor:null,changeMinor:null};
  if(rule.to!==null&&qualifying+missing>rule.to)return step;
  const extras:PaintPiece[]=[],seenNames=new Set(names),seenCodes=new Set(pieces.flatMap(p=>p.sku.contents.map(c=>c.code)));
  const available=data.skus.filter(s=>eligiblePaintSku(s)&&s.contents.length===1&&!positions.has(s.id)&&Math.max(1,s.minQty)===1&&s.maxQty>=1&&paintRuleApplies(rule,s))
   .sort((a,b)=>paintPieceCost({sku:a,quantity:1},rule)-paintPieceCost({sku:b,quantity:1},rule)||a.id.localeCompare(b.id,'en',{numeric:true}));
  for(const sku of available){if(extras.length===missing)break;const content=sku.contents[0]!;if(seenNames.has(normalized(content.name))||seenCodes.has(content.code))continue;extras.push({sku,quantity:1});seenNames.add(normalized(content.name));seenCodes.add(content.code);}
  if(extras.length!==missing)return step;
  const actual=bestPaintRule(data,[...pieces,...extras]).rule;if(!actual||actual.percent<rule.percent)return step;
  const existingCostMinor=pieces.reduce((sum,p)=>sum+paintPieceCost(p,actual),0),extra=extras.map(p=>({skuId:p.sku.id,title:p.sku.title,minor:paintPieceCost(p,actual)})),extraCostMinor=extra.reduce((sum,p)=>sum+p.minor,0),totalCostMinor=existingCostMinor+extraCostMinor,freeMinor=advice.totalOldMinor!-totalCostMinor;
  return {...step,complete:true,extra,extraCostMinor,existingCostMinor,totalCostMinor,freeMinor,changeMinor:freeMinor-advice.totalFreeMinor!};
 };
 const compare=(a:PaintTierStep,b:PaintTierStep)=>Number(b.complete)-Number(a.complete)||(b.changeMinor??-Infinity)-(a.changeMinor??-Infinity)||a.missing-b.missing;
 const higher=rules.filter(r=>r.percent>advice.percent).map(choose),nextPercent=Math.min(...higher.map(r=>r.percent));
 return {state:'higher',distinctPositions:positions.size,currentPercent:advice.percent,maximumPercent,next:higher.filter(r=>r.percent===nextPercent).sort(compare)[0]??null,maximum:higher.filter(r=>r.percent===maximumPercent).sort(compare)[0]??null};
}
