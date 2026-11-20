import type {ChainBase,ChainModel,ChainPlan,ChainPool,ChainStep} from './chain';
import {type CatalogueShip,type TargetOffer} from '../market/model';
import {nominalValue,shipValuesStale} from '../market/ship-values';
import type {PricingSnapshot} from '../pricing/model';
import {estimatePlanningMinor,euroRateIsStale,matchesShopAmount} from '../pricing/money';
import { SHOP_PRICE_MAX_AGE, type ShopAmount } from '../market/shop-prices';
import {purchasePriceReader} from './shopping-list';
export type SearchInput={pool:ChainPool;target:CatalogueShip;offers:readonly TargetOffer[];current:boolean;baseKey?:string;display:PricingSnapshot;
 requiredPurchase?:{key:string;from:ChainModel;to:ChainModel;usdMinor:number}};
type Score=[number,number,number];
export type RankedChain={plan:ChainPlan;score:Score;rankScore:Score;signature:string};
export type SearchResult={plans:RankedChain[];bestProven:boolean;alternativesComplete:boolean;basesChecked:number;ccusChecked:number;modelsChecked:number;unknownModels:number;comparisonCurrency:'EUR'|'USD';comparisonTaxMode:'net'|'gross';fallbackUsd:boolean;rankingCurrency:'EUR'|'USD';reason:'none'|'input'|'limit'|'alternatives-limit'|'draft-limit'};
const compare=(a:Score,b:Score)=>a[0]-b[0]||a[1]-b[1]||a[2]-b[2];
const add=(a:Score,b:Score):Score=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
type PathState={base:ChainBase;cursor:string;steps:ChainStep[];visited:Set<string>;score:Score;previousPurchase:boolean};
type Entry={key:string;score:Score;tie?:number;path?:PathState};
class Heap{
 items:Entry[]=[];
 less(a:Entry,b:Entry){return compare(a.score,b.score)||(a.tie??0)-(b.tie??0)||a.key.localeCompare(b.key);}
 push(v:Entry){const a=this.items;a.push(v);let i=a.length-1;while(i){const p=(i-1)>>1;if(this.less(a[p]!,v)<=0)break;a[i]=a[p]!;i=p;}a[i]=v;}
 pop(){const a=this.items,first=a[0];if(!first)return;const last=a.pop()!;if(a.length){let i=0;while(i*2+1<a.length){let c=i*2+1;if(c+1<a.length&&this.less(a[c+1]!,a[c]!)<0)c++;if(this.less(last,a[c]!)<=0)break;a[i]=a[c]!;i=c;}a[i]=last;}return first;}
}
const stepShape=(s:ChainStep)=>[s.kind,s.from.key,s.to.key,s.kind==='owned'&&!!s.ccu?.warbond,s.purchaseQuote?.key??null];
const baseShape=(b:ChainBase)=>[b.model.key,b.insurance.kind,b.insurance.kind==='months'?b.insurance.months:null,b.protected,b.released,b.multiShip];
/** A* enumerates model-distinct simple routes; reverse shortest paths provide an admissible bound.
 * Standard gaps may not follow standard gaps: a direct gap has the same USD value.
 * Workbench variants rank the sum of priced, rounded cards. The purchase advisor can simulate a nominal USD route.
 */
export function searchChains(input:SearchInput,options:{observedPrices?:boolean;maxVariants?:number;maxOperations?:number;maxMs?:number;maxFrontier?:number}={}):SearchResult{
 const {pool,target,offers,current,display}=input,start=Date.now(),maxOps=options.maxOperations??8_000_000,maxMs=options.maxMs??3000,k=Math.max(1,Math.min(5,options.maxVariants??5));
 const result:SearchResult={plans:[],bestProven:false,alternativesComplete:false,basesChecked:0,ccusChecked:pool.ccus.length,modelsChecked:0,unknownModels:0,comparisonCurrency:display.settings.currency,comparisonTaxMode:display.settings.taxMode,fallbackUsd:false,rankingCurrency:'USD',reason:'none'};
 if(pool.limited||pool.ccus.length>500||pool.bases.length>300){result.reason='limit';return result;}
 if(!Number.isInteger(target.id)||target.id<=0||new Set(pool.ccus.map(c=>c.key)).size!==pool.ccus.length||new Set(pool.bases.map(b=>b.key)).size!==pool.bases.length){result.reason='input';return result;}
 const nodes=new Map<string,ChainModel>(),incoming=new Map<string,ChainStep[]>(),outgoing=new Map<string,ChainStep[]>();
 const valid=(m:ChainModel)=>typeof m.key==='string'&&m.key.length>0&&m.key.length<=550&&(m.nominalUsd===null||Number.isSafeInteger(m.nominalUsd)&&m.nominalUsd>=0&&m.nominalUsd<=100_000_000);
 for(const b of pool.bases){if(!valid(b.model)){result.reason='input';return result;}nodes.set(b.model.key,b.model);}
 for(const c of [...pool.ccus].sort((a,b)=>Number(b.applicabilityConfirmed)-Number(a.applicabilityConfirmed)||a.key.localeCompare(b.key))){
  if(!valid(c.from)||!valid(c.to)||c.from.key===c.to.key){result.reason='input';return result;}nodes.set(c.from.key,c.from);nodes.set(c.to.key,c.to);
  const step:ChainStep={key:c.key,kind:'owned',from:c.from,to:c.to,ccu:c};incoming.set(c.to.key,[...(incoming.get(c.to.key)??[]),step]);outgoing.set(c.from.key,[...(outgoing.get(c.from.key)??[]),step]);
 }
 const quote=input.requiredPurchase;
 if(quote){
  if(!current||!valid(quote.from)||!valid(quote.to)||quote.from.nominalUsd===null||quote.to.nominalUsd===null||quote.to.nominalUsd<=quote.from.nominalUsd||!Number.isSafeInteger(quote.usdMinor)||quote.usdMinor<=0||quote.usdMinor>quote.to.nominalUsd-quote.from.nominalUsd||!quote.key||quote.key.length>550){result.reason='input';return result;}
  for(const m of [quote.from,quote.to]){const prior=nodes.get(m.key);if(prior&&(prior.nominalUsd!==m.nominalUsd||prior.name!==m.name)){result.reason='input';return result;}nodes.set(m.key,m);}
  const step:ChainStep={key:'quote:'+quote.key,kind:'purchase',from:quote.from,to:quote.to,validity:'unverified',purchaseQuote:{key:quote.key,usdMinor:quote.usdMinor}};
  incoming.set(step.to.key,[...(incoming.get(step.to.key)??[]),step]);outgoing.set(step.from.key,[...(outgoing.get(step.from.key)??[]),step]);
 }
 if (options.observedPrices) for (const model of pool.marketModels ?? []) {
   if (!valid(model)) { result.reason = 'input'; return result; }
   if (!nodes.has(model.key)) nodes.set(model.key, model);
 }
 const goal:ChainModel={key:'matrix:'+target.id,name:target.name,catalogueConfirmed:true,nominalUsd:nominalValue(target,offers,current,pool.values)};nodes.set(goal.key,goal);
 if(!current&&shipValuesStale(pool.values))for(const [key,m]of nodes)nodes.set(key,{...m,nominalUsd:null});
 const models=[...nodes.values()].sort((a,b)=>a.key.localeCompare(b.key));result.modelsChecked=nodes.size;result.unknownModels=models.filter(m=>m.nominalUsd===null).length;
 if(nodes.size>1200){result.reason='limit';return result;}
 const bases=pool.bases.filter(b=>!input.baseKey||b.key===input.baseKey).sort((a,b)=>a.key.localeCompare(b.key));result.basesChecked=bases.length;
 const rate=display.rate&&!euroRateIsStale(display.rate)?display.rate:null;
 const hasNative=options.observedPrices&&display.shopPrices?.some(quote=>start>=quote.checkedAt&&start-quote.checkedAt<SHOP_PRICE_MAX_AGE&&matchesShopAmount(display.settings,quote.amount));
 if(!hasNative&&estimatePlanningMinor(1,display.settings,rate)===null){result.fallbackUsd=true;result.comparisonCurrency='USD';result.comparisonTaxMode='net';}
 const priceFor=options.observedPrices?purchasePriceReader(offers,pool.values,current,start,display.shopPrices):null;
 if(priceFor)result.rankingCurrency=result.comparisonCurrency;
 const displayAmounts=new Map<number,number|null>();
 function shown(usd:number, shop?:ShopAmount){
   if(result.fallbackUsd)return usd;
   if(shop) return estimatePlanningMinor(usd,display.settings,rate,shop);
   let amount=displayAmounts.get(usd);
   if(amount===undefined){amount=estimatePlanningMinor(usd,display.settings,rate);displayAmounts.set(usd,amount);}
   return amount;
 }
 function edge(s:ChainStep):{score:Score;standard:boolean}|null{
   if(s.kind==='owned')return {score:[0,0,1],standard:false};
   if(priceFor){
     const price=priceFor(s);
     if(price.kind==='open')return null;
     const amount=shown(price.usdMinor,price.shop);
     return amount===null?null:{score:[amount,1,1],standard:price.kind==='standard'};
   }
   return {score:[s.purchaseQuote?.usdMinor??s.to.nominalUsd!-s.from.nominalUsd!,1,1],standard:!s.purchaseQuote};
 }
 let operations=0,draftLimited=false;const guard=()=>{if(++operations>maxOps||operations%2048===0&&Date.now()-start>maxMs)throw Error('SEARCH_LIMIT');};
 const gap=(from:ChainModel,to:ChainModel):ChainStep=>({key:'gap:'+JSON.stringify([from.key,to.key]),kind:'purchase',from,to,validity:'unverified'});
 const distance=new Map<string,Score>([[goal.key,[0,0,0]]]),settled=new Set<string>(),bounds=new Heap();bounds.push({key:goal.key,score:[0,0,0]});
 try{
  // Relaxed reverse graph remains an admissible bound when a route forbids repeats/two buys.
  function relax(s:ChainStep,tail:Score){guard();if(settled.has(s.from.key))return;const value=edge(s);if(!value)return;const score=add(value.score,tail);if(!distance.has(s.from.key)||compare(score,distance.get(s.from.key)!)<0){distance.set(s.from.key,score);bounds.push({key:s.from.key,score});}}
  while(true){guard();const entry=bounds.pop();if(!entry)break;if(settled.has(entry.key)||compare(entry.score,distance.get(entry.key)!)!==0)continue;settled.add(entry.key);const to=nodes.get(entry.key)!;
   for(const s of incoming.get(entry.key)??[])relax(s,entry.score);
   if(to.nominalUsd!==null)for(const from of models){guard();if(from.nominalUsd!==null&&from.nominalUsd<to.nominalUsd)relax(gap(from,to),entry.score);}
  }
  const frontier=new Heap(),prefixes=new Set<string>(),routes=new Set<string>();
  function enqueue(p:PathState){guard();const bound=distance.get(p.cursor);if(!bound)return;const key=JSON.stringify([p.base.key,p.steps.map(stepShape)]);if(prefixes.has(key))return;prefixes.add(key);
   if(frontier.items.length>=(options.maxFrontier??20000))throw Error('SEARCH_LIMIT');frontier.push({key,score:add(p.score,bound),tie:p.base.insurance.kind==='lti'?0:1,path:p});
  }
  for(const base of bases)enqueue({base,cursor:base.model.key,steps:[],visited:new Set([base.model.key]),score:[0,0,0],previousPurchase:false});
  while(frontier.items.length&&result.plans.length<k){guard();const p=frontier.pop()!.path!;
   if(p.cursor===goal.key){if(quote&&!p.steps.some(s=>s.purchaseQuote?.key===quote.key))continue;const signature=JSON.stringify([baseShape(p.base),p.steps.map(stepShape)]);if(routes.has(signature))continue;routes.add(signature);
    const amount=priceFor?p.score[0]:p.steps.reduce((sum,s)=>sum+(s.kind==='owned'?0:shown(edge(s)!.score[0])!),0),gapCount=p.score[1];
    result.plans.push({plan:{base:p.base,target,steps:p.steps,ownedCount:p.steps.length-gapCount,gapCount,additionalMinor:gapCount?null:0,applicabilityConfirmed:p.base.identityConfirmed&&p.steps.every(s=>s.kind==='owned'&&s.ccu!.applicabilityConfirmed)},rankScore:p.score,score:[amount,gapCount,p.steps.length],signature});result.bestProven=true;continue;
   }
   if(p.steps.length>=100){draftLimited=true;throw Error('DRAFT_LIMIT');}
   const next=[...(outgoing.get(p.cursor)??[])],from=nodes.get(p.cursor)!;
   if((!p.previousPurchase||priceFor)&&from.nominalUsd!==null)for(const to of models){guard();if(to.nominalUsd!==null&&from.nominalUsd<to.nominalUsd)next.push(gap(from,to));}
   for(const step of next){guard();if(p.visited.has(step.to.key))continue;const value=edge(step);if(!value||p.previousPurchase&&value.standard)continue;enqueue({...p,cursor:step.to.key,steps:[...p.steps,step],visited:new Set([...p.visited,step.to.key]),score:add(p.score,value.score),previousPurchase:value.standard});}
  }
  result.alternativesComplete=true;if(!result.plans.length&&draftLimited)result.reason='draft-limit';
 }catch(error){if(!(error instanceof Error)||!['SEARCH_LIMIT','DRAFT_LIMIT'].includes(error.message))throw error;result.reason=result.bestProven?'alternatives-limit':draftLimited?'draft-limit':'limit';}
 return result;
}
