import type {Pledge} from '../domain/model';
import type {ChainBase,ChainStep} from './chain';
import type {PricingSnapshot} from '../pricing/model';
import {convertPurchaseValue,parseRsiPledgeValue,RSI_ORDER_PRICE,sameStandaloneShip} from '../pricing/inventory-values';
import {estimatePlanningMinor,euroRateIsStale,matchesShopAmount} from '../pricing/money';
import type {PurchasePriceReader} from './shopping-list';
import {ccuObservationTime,observedStandaloneCcu,type ChainObservation} from './observation';
import {packageBasis,samePackageBasis,type PackageShare} from './package-shares';
import {SHOP_PRICE_MAX_AGE,shopPairForStep,shopPairKey,type ShopPrice} from '../market/shop-prices';

export type CostPosition={minor:number|null;approximate:boolean;usdMinor:number|null;rsiOrder?:true;packageShare?:true};
export type CostTotal={knownMinor:number;missing:number;approximate:boolean};
export type CcuPriceAdvantage={minor:number;approximate:boolean};
const unknown=():CostPosition=>({minor:null,approximate:false,usdMinor:null});
function rate(display:PricingSnapshot){return display.rate&&!euroRateIsStale(display.rate)?display.rate:null;}
/** A current standard ship-value difference is an estimate, never a verified shop edge. */
export function additionalCost(step:ChainStep,display:PricingSnapshot,current:boolean,priceFor?:PurchasePriceReader):CostPosition{
  if(step.kind==='owned')return {minor:0,approximate:false,usdMinor:0};
  if(step.kind!=='purchase'||step.validity==='invalid'||!current||step.from.nominalUsd===null||step.to.nominalUsd===null)return unknown();
  const price=priceFor?.(step);
  if(price?.kind==='open')return unknown();
  const usd=price?.usdMinor??step.purchaseQuote?.usdMinor??step.to.nominalUsd-step.from.nominalUsd;
  if(!Number.isSafeInteger(usd)||usd<=0||usd>100_000_000)return unknown();
  return {minor:estimatePlanningMinor(usd,display.settings,rate(display),price?.shop),approximate:!matchesShopAmount(display.settings,price?.shop),usdMinor:usd};
}
function recordedCost(pledge:Pledge,display:PricingSnapshot,observation?:ChainObservation):CostPosition{
  const recorded=pledge.acquisitionCost;
  const receipt=pledge.rsiPurchase;
  const observedAt=ccuObservationTime(pledge,observation);
  let payment: NonNullable<Pledge['acquisitionCost']>;
  if(recorded){
    if(recorded.taxBasis!==display.settings.taxMode)return unknown();
    payment=recorded;
  }else if(display.settings.taxMode==='gross'&&receipt?.status==='documented'&&receipt.source==='order'&&
      typeof observedAt==='string'&&Number.isFinite(Date.parse(observedAt))){
    // Use the booked line amount as paid. Today's VAT applies only to future estimates.
    payment={minor:receipt.minor,currency:receipt.currency,taxBasis:'unknown',evidence:RSI_ORDER_PRICE};
  }else return unknown();
  const converted=convertPurchaseValue(payment,display);
  if(converted.minor===null)return unknown();
  return {...converted,usdMinor:payment.currency==='USD'?payment.minor:null,...(!recorded?{rsiOrder:true as const}:{})};
}
export function paidBaseCost(base:ChainBase|null,pledges:readonly Pledge[],display:PricingSnapshot,observation?:ChainObservation,shares?:readonly PackageShare[]):CostPosition{
  const pledge=base?pledges.find(p=>p.pledgeId===base.pledgeId):undefined;
  if(base?.multiShip&&shares?.length&&display.settings.taxMode==='gross'){
    const basis=packageBasis(pledge,base.childId,observation);
    const share=basis&&shares.find(item=>samePackageBasis(item,basis));
    if(share){
      const cost=convertPurchaseValue({minor:share.minor,currency:share.currency,taxBasis:'unknown',evidence:'Eigene Angabe'},display);
      if(cost.minor!==null)return {...cost,approximate:true,usdMinor:share.currency==='USD'?share.minor:null,packageShare:true};
    }
  }
  if(pledge?.ships.length!==1||pledge.ccus.length||pledge.ships[0]!.childId!==base?.childId)return unknown();
  // An RSI order for the original pledge does not include any applied CCUs.
  const configuration=pledge.sourceValues.pledgeConfigurationValue;
  if(!pledge.acquisitionCost){
    // A single ship sold together with a paint uses the full price of that order line.
    const name=pledge.name.replace(/\s+plus\s+[^+\r\n]+\s+Paint$/i,'');
    if(!sameStandaloneShip({...pledge,name})||(configuration&&parseRsiPledgeValue(configuration)?.minor!==0))return unknown();
  }
  return recordedCost(pledge,display,observation);
}
export function paidCcuCost(step:ChainStep,pledges:readonly Pledge[],display:PricingSnapshot,observation?:ChainObservation):CostPosition{
  if(step.kind!=='owned'||!step.ccu)return unknown();
  const p=pledges.find(p=>p.pledgeId===step.ccu!.pledgeId);
  if(!p||p.ccus.length!==1||p.ships.length||p.ccus[0]!.instanceId!==step.ccu.instanceId)return unknown();
  if(!p.acquisitionCost&&!observedStandaloneCcu(p,observation))return unknown();
  return recordedCost(p,display,observation);
}

export function ccuPriceAdvantageReader(display:PricingSnapshot, now=Date.now()){
  const {settings}=display;
  const fx=display.rate&&!euroRateIsStale(display.rate,now)?display.rate:null;
  const quotes=new Map<string,ShopPrice>();
  for(const quote of display.shopPrices??[]){
    if(quote.checkedAt>now||now-quote.checkedAt>=SHOP_PRICE_MAX_AGE)continue;
    const key=shopPairKey(quote)+':'+quote.edition;
    if((quotes.get(key)?.checkedAt??-1)<quote.checkedAt)quotes.set(key,quote);
  }
  return (step:ChainStep,cost:CostPosition,warbondSelected=false):CcuPriceAdvantage|null=>{
    if(cost.minor===null||!Number.isSafeInteger(cost.minor)||cost.minor<0)return null;
    if(step.kind!=='owned'&&(step.kind!=='purchase'||!warbondSelected))return null;
    const pair=shopPairForStep(step);
    if(!pair)return null;
    const key=shopPairKey(pair);
    const standard=quotes.get(key+':standard')?.amount;
    const warbond=quotes.get(key+':warbond')?.amount;
    const nativeStandard=matchesShopAmount(settings,standard)?standard.minor:null;
    let standardMinor:number|null;
    let approximate=cost.approximate||cost.rsiOrder===true;
    if(step.kind==='purchase'){
      if(!standard||!warbond)return null;
      const native=nativeStandard!==null&&matchesShopAmount(settings,warbond);
      const usdNet=standard.currency==='USD'&&standard.taxMode==='net'&&warbond.currency==='USD'&&warbond.taxMode==='net';
      if(!native&&!usdNet)return null;
      const warbondMinor=estimatePlanningMinor(warbond.minor,settings,fx,warbond);
      if(warbondMinor!==cost.minor)return null;
      standardMinor=estimatePlanningMinor(standard.minor,settings,fx,standard);
      approximate||=!native;
    }else if(nativeStandard!==null){
      standardMinor=nativeStandard;
    }else{
      const from=step.from.nominalUsd,to=step.to.nominalUsd;
      const reference=standard?.currency==='USD'&&standard.taxMode==='net'?standard.minor
        :from!==null&&to!==null&&Number.isSafeInteger(from)&&Number.isSafeInteger(to)&&from>0&&to>from&&to<=100_000_000?to-from:null;
      standardMinor=estimatePlanningMinor(reference,settings,fx);
      approximate=true;
    }
    return standardMinor!==null&&standardMinor>cost.minor?{minor:standardMinor-cost.minor,approximate}:null;
  };
}

function sum(values:readonly CostPosition[]):CostTotal{return values.reduce<CostTotal>((s,v)=>{
  const valid=v.minor!==null&&Number.isSafeInteger(v.minor)&&v.minor>=0&&Number.isSafeInteger(s.knownMinor+v.minor);
  return {knownMinor:s.knownMinor+(valid?v.minor!:0),missing:s.missing+Number(!valid),approximate:s.approximate||v.approximate||v.rsiOrder===true};
},{knownMinor:0,missing:0,approximate:false});}
export function chainCosts(plan:{base:ChainBase|null;steps:readonly ChainStep[]},pledges:readonly Pledge[],display:PricingSnapshot,current:boolean,priceFor?:PurchasePriceReader,observation?:ChainObservation,shares?:readonly PackageShare[]){
  const additional=sum(plan.steps.filter(s=>s.kind!=='conflict').map(s=>additionalCost(s,display,current,priceFor)));
  const baseCost=paidBaseCost(plan.base,pledges,display,observation,shares);
  const paid=sum([baseCost,...plan.steps.filter(s=>s.kind==='owned'||s.kind==='missing').map(s=>paidCcuCost(s,pledges,display,observation))]);
  const invalid=!plan.base||plan.steps.some(s=>s.kind==='conflict'||s.kind==='missing');
  const investment=paid.knownMinor+additional.knownMinor;
  return {additional,paid,invalid,investment:!invalid&&!paid.missing&&!additional.missing&&Number.isSafeInteger(investment)?investment:null};
}

export function chainSavings(investment:number|null,standardUsd:number|null,display:PricingSnapshot):number|null {
  if(investment===null)return null;
  const standardPrice=estimatePlanningMinor(standardUsd,display.settings,rate(display));
  return standardPrice===null?null:standardPrice-investment;
}
