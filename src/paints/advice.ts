import type {Pledge} from '../domain/model';import {gameAccessEvidence} from '../domain/game-access';import {hasProtectedGameAccess} from '../domain/game-access-assignment';
import {pledgeDate} from '../domain/pledge-date';import {parseRsiPledgeValue} from '../pricing/inventory-values';
import {paintCatalogueStale,type PaintCatalogue,type PaintRule,type PaintSku} from './model';

export type PaintInventoryRow={pledge:Pledge;source:string};
export type PaintAdviceRow={pledgeId:string;name:string;paintCount:number;paintNames:string[];protection:'ship-package'|'mixed-contents'|null;state:'ready'|'unverified'|'excluded'|'no-benefit';reason:string;oldMinor:number|null;replacementMinor:number|null;freeMinor:number|null;replacement:string[];approximate:boolean};
export type PaintBasketLine={skuId:string;quantity:number};
export type PaintAdvice={rows:PaintAdviceRow[];ready:number;unverified:number;excluded:number;totalOldMinor:number|null;totalReplacementMinor:number|null;totalFreeMinor:number|null;approximate:boolean;quantity:number;percent:number;knownVariants:number;basket:PaintBasketLine[]};
type Piece={sku:PaintSku;quantity:number};type Option={pieces:Piece[];label:string[]};
type Candidate={row:PaintAdviceRow;options:Option[]};
const normalized=(s:string)=>s.normalize('NFC').trim().replace(/\s+/g,' ').toLocaleLowerCase('en-US');
const multiset=(names:string[])=>JSON.stringify(names.map(normalized).sort());
function items(raw:unknown):{title:string;kind?:string}[]|null {
 if(typeof raw!=='string'||raw.length>4000)return null;try{const v=JSON.parse(raw);return Array.isArray(v)&&v.length<=100&&v.every(x=>x&&typeof x.title==='string'&&x.title.length<=500&&(x.kind===undefined||typeof x.kind==='string'))?v:null;}catch{return null;}
}
const pure=(s:PaintSku)=>s.allowCredit&&s.available&&s.regularMinor>0&&(s.discountedMinor??s.regularMinor)>0&&!s.vip&&!s.warbond&&!s.hasShips&&s.contents.every(c=>c.kind==='SKIN'&&!c.hasGamePurchase);
const basePrice=(s:PaintSku)=>s.discountedMinor!==null&&s.discountedMinor<=s.regularMinor?s.discountedMinor:s.regularMinor;
const ruleFor=(rule:PaintRule,s:PaintSku)=>rule.products.includes(s.productId)&&(rule.skus.length===0||rule.skus.includes(s.id))&&rule.amountOff===null&&rule.maximum===null&&Number.isInteger(rule.percent*100);
function bestRule(data:PaintCatalogue,pieces:Piece[]):{rule:PaintRule|null;quantity:number}{
 let best:PaintRule|null=null,count=0;for(const rule of data.rules){const quantity=new Set(pieces.filter(p=>ruleFor(rule,p.sku)).map(p=>p.sku.id)).size;
  // Count distinct eligible SKUs only: duplicate copies and a pack's child paints do not inflate a tier.
  if(quantity>=rule.from&&(rule.to===null||quantity<=rule.to)&&rule.percent>(best?.percent??0)){best=rule;count=quantity;}
 }return {rule:best,quantity:count};
}
function pieceCost(piece:Piece,rule:PaintRule|null):number {
 const base=basePrice(piece.sku)*piece.quantity;if(!rule||!ruleFor(rule,piece.sku))return base;
 const discounted=Number((BigInt(piece.sku.regularMinor)*BigInt(piece.quantity)*BigInt(10000-Math.round(rule.percent*100))+5000n)/10000n);
 // Never assume that a baked-in pack discount stacks with a quantity discount.
 return piece.sku.discountedMinor===null?discounted:Math.max(base,discounted);
}
const optionCost=(option:Option,rule:PaintRule|null)=>option.pieces.reduce((sum,p)=>sum+pieceCost(p,rule),0);
export {pure as eligiblePaintSku,ruleFor as paintRuleApplies,bestRule as bestPaintRule,pieceCost as paintPieceCost};
export type {Piece as PaintPiece};
function knownPlan(candidates:Candidate[],data:PaintCatalogue){
 let best:{options:Option[];costs:number[];total:number;rule:PaintRule|null;quantity:number;approximate:boolean}|null=null,variants=0;
 const consider=(options:Option[],bulk:boolean)=>{const all=options.flatMap(o=>o.pieces),quantities=new Map<string,Piece>();for(const piece of all){const before=quantities.get(piece.sku.id);quantities.set(piece.sku.id,{sku:piece.sku,quantity:(before?.quantity??0)+piece.quantity});}if([...quantities.values()].some(p=>p.quantity<Math.max(1,p.sku.minQty)||p.quantity>(p.sku.maxQty||1)))return;const quote=bulk?bestRule(data,all):{rule:null,quantity:0},costs=options.map(o=>optionCost(o,quote.rule)),total=costs.reduce((a,b)=>a+b,0);variants++;if(!best||total<best.total)best={options,costs,total,rule:quote.rule,quantity:quote.quantity,approximate:!!quote.rule};};
 for(const assumed of [null,...data.rules]){
  const choices=candidates.map(c=>[...c.options].sort((a,b)=>optionCost(a,assumed)-optionCost(b,assumed))[0]!);consider(choices,false);consider(choices,true);
 }
 for(const preferSingles of [false,true]){const choices=candidates.map(c=>[...c.options].sort((a,b)=>(preferSingles?b.pieces.length-a.pieces.length:a.pieces.length-b.pieces.length)||optionCost(a,null)-optionCost(b,null))[0]!);consider(choices,false);consider(choices,true);}
 return {best:best as {options:Option[];costs:number[];total:number;rule:PaintRule|null;quantity:number;approximate:boolean}|null,variants};
}
export function paintAdvice(inventory:readonly PaintInventoryRow[],data:PaintCatalogue|null,now=Date.now()):PaintAdvice {
 const rows:PaintAdviceRow[]=[],candidates:Candidate[]=[],usable=!!data&&!paintCatalogueStale(data,now),offers=usable?data!.skus.filter(pure):[];
 const codes=new Map<string,Set<string>>();for(const offer of offers)for(const c of offer.contents){const key=normalized(c.name);if(!codes.has(key))codes.set(key,new Set());codes.get(key)!.add(c.code);}
 const byContent=new Map<string,PaintSku[]>();for(const offer of offers){const key=multiset(offer.contents.map(c=>c.name));if(!byContent.has(key))byContent.set(key,[]);byContent.get(key)!.push(offer);}
 for(const {pledge:p,source} of inventory){
  const content=items(p.sourceValues.items);if(!content?.some(i=>/^(skin|paint)$/i.test(i.kind?.trim()??'')))continue;
  const skins=content.filter(i=>/^(skin|paint)$/i.test(i.kind?.trim()??'')),copies=gameAccessEvidence(p);
  const old=source==='rsi-dom-probe/1'?parseRsiPledgeValue(p.sourceValues.pledgeValue):p.meltValue?.currency==='USD'&&p.meltValue.taxBasis==='net'?p.meltValue:null;
  const row:PaintAdviceRow={pledgeId:p.pledgeId,name:p.name,paintCount:skins.length,paintNames:skins.map(s=>s.title),protection:null,state:'unverified',reason:'Preise noch nicht geprüft.',oldMinor:old?.minor??null,replacementMinor:null,freeMinor:null,replacement:[],approximate:false};rows.push(row);
  if(p.ships.length||p.ccus.length||p.sourceValues.upgradeState==='unresolved'||copies.starCitizen||copies.squadron42||hasProtectedGameAccess(p,source)){row.protection=p.ships.length?'ship-package':'mixed-contents';row.state='excluded';row.reason='Schiff, Upgrade oder Spielzugang im selben Pledge.';continue;}
  const extra=items(p.sourceValues.alsoContains??'[]');if(content.length!==skins.length||!extra||extra.some(i=>!skins.some(s=>normalized(s.title)===normalized(i.title)))){row.protection='mixed-contents';row.state='excluded';row.reason='Weitere Inhalte im Pledge; kein reiner Paint-Kauf.';continue;}
  if(old?.minor===0||p.sourceValues.meltable==='false'){row.state='excluded';row.reason='Kein bestätigter Einschmelzwert oder nicht einschmelzbar.';continue;}
  if(!usable){row.reason=data?'Preisdaten sind veraltet.':'Paint-Preise noch nicht gelesen.';continue;}
  if(skins.some(i=>(codes.get(normalized(i.title))?.size??0)>1)){row.reason='Gleichnamige Paint-Varianten sind nicht eindeutig zugeordnet.';continue;}
  const direct=(byContent.get(multiset(skins.map(i=>i.title)))??[]).map(s=>({pieces:[{sku:s,quantity:1}],label:[s.title]}));
  const singles=new Map<string,Piece>();let complete=true;
  for(const paint of skins){const match=[...(byContent.get(multiset([paint.title]))??[])].sort((a,b)=>basePrice(a)-basePrice(b))[0];if(!match){complete=false;break;}const prior=singles.get(match.id);singles.set(match.id,{sku:match,quantity:(prior?.quantity??0)+1});}
  const options:Option[]=[...direct];if(complete&&singles.size)options.push({pieces:[...singles.values()],label:[...singles.values()].map(s=>s.quantity+' × '+s.sku.title)});
  if(!options.length){row.state='excluded';row.reason='Kein identischer vollständiger Ersatz öffentlich belegt.';continue;}
  const baseline=[...options].sort((a,b)=>optionCost(a,null)-optionCost(b,null))[0]!;row.replacementMinor=optionCost(baseline,null);row.replacement=baseline.label;
  if(!old){row.reason='Einschmelzbasis in USD nicht belegt.';continue;}
  if(source!=='rsi-dom-probe/1'||p.sourceValues.meltable!=='true'){row.reason='RSI-Reclaim-Berechtigung noch nicht gelesen.';continue;}
  const date=pledgeDate(p);if(!date||now-Date.parse(date+'T00:00:00Z')<72*3600000){row.reason='24-Stunden-Frist anhand des Quelldatums noch nicht sicher erfüllt.';continue;}
  candidates.push({row,options});
 }
 let active=[...candidates],plan:ReturnType<typeof knownPlan>={best:null,variants:0},knownVariants=0;
 while(active.length){plan=knownPlan(active,data!);knownVariants+=plan.variants;if(!plan.best)break;const negative=active.filter((c,i)=>c.row.oldMinor!<=plan.best!.costs[i]!);if(!negative.length)break;for(const c of negative){c.row.state='no-benefit';c.row.reason='Kein Vorteil in den geprüften Ersatzvarianten.';c.row.replacementMinor=plan.best.costs[active.indexOf(c)]!;}const remove=new Set(negative);active=active.filter(c=>!remove.has(c));}
 const best=active.length?plan.best:null;if(best)active.forEach((c,i)=>{c.row.state='ready';c.row.reason=best.approximate?'Mengenrabatt-Vorprüfung; finalen Warenkorb bei RSI prüfen.':'Einzelkauf-Preise ohne Mengenrabatt; vor Reclaim bei RSI prüfen.';c.row.replacementMinor=best.costs[i]!;c.row.replacement=best.options[i]!.label;c.row.freeMinor=c.row.oldMinor!-c.row.replacementMinor;c.row.approximate=best.approximate;});else for(const c of active)c.row.reason='Ersatzmenge im Shop nicht bestätigt oder begrenzt.';
 const ready=rows.filter(r=>r.state==='ready'),oldTotal=ready.reduce((n,r)=>n+r.oldMinor!,0),newTotal=ready.reduce((n,r)=>n+r.replacementMinor!,0);
 return {rows,ready:ready.length,unverified:rows.filter(r=>r.state==='unverified').length,excluded:rows.filter(r=>r.state==='excluded'||r.state==='no-benefit').length,totalOldMinor:ready.length?oldTotal:null,totalReplacementMinor:ready.length?newTotal:null,totalFreeMinor:ready.length?oldTotal-newTotal:null,approximate:best?.approximate??false,quantity:best?.quantity??0,percent:best?.rule?.percent??0,knownVariants,basket:best?best.options.flatMap(o=>o.pieces.map(p=>({skuId:p.sku.id,quantity:p.quantity}))):[]};
}
