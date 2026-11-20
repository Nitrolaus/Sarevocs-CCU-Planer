import type {Pledge} from '../domain/model';
import type {ChainBase,ChainStep} from './chain';
import type {PricingSnapshot} from '../pricing/model';
import {estimateMinor,estimatePlanningMinor,euroRateIsStale,matchesShopAmount} from '../pricing/money';
import type {PurchasePriceReader} from './shopping-list';

export type CostPosition={minor:number|null;approximate:boolean;usdMinor:number|null};
export type CostTotal={knownMinor:number;missing:number;approximate:boolean};
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
/** Never add today's VAT to an old gross payment or guess its historical tax basis. */
function recordedCost(value:Pledge['acquisitionCost'],display:PricingSnapshot):CostPosition{
  if(!value||value.taxBasis!==display.settings.taxMode)return unknown();
  if(value.currency===display.settings.currency)return {minor:value.minor,approximate:false,usdMinor:value.currency==='USD'?value.minor:null};
  const fx=rate(display);if(!fx||value.minor>100_000_000)return unknown();
  const minor=value.currency==='USD'?estimateMinor(value.minor,{...display.settings,taxMode:'net'},fx):
    Number((BigInt(value.minor)*BigInt(fx.usdPerEurMicros)+500_000n)/1_000_000n);
  return {minor,approximate:true,usdMinor:value.currency==='USD'?value.minor:null};
}
export function paidCcuCost(step:ChainStep,pledges:readonly Pledge[],display:PricingSnapshot):CostPosition{
  if(step.kind!=='owned'||!step.ccu)return unknown();
  const p=pledges.find(p=>p.pledgeId===step.ccu!.pledgeId);
  if(!p||p.ccus.length!==1||p.ships.length||p.ccus[0]!.instanceId!==step.ccu.instanceId)return unknown();
  return recordedCost(p.acquisitionCost,display);
}
function sum(values:readonly CostPosition[]):CostTotal{return values.reduce<CostTotal>((s,v)=>{
  const valid=v.minor!==null&&Number.isSafeInteger(v.minor)&&v.minor>=0&&Number.isSafeInteger(s.knownMinor+v.minor);
  return {knownMinor:s.knownMinor+(valid?v.minor!:0),missing:s.missing+Number(!valid),approximate:s.approximate||v.approximate};
},{knownMinor:0,missing:0,approximate:false});}
export function chainCosts(plan:{base:ChainBase|null;steps:readonly ChainStep[]},pledges:readonly Pledge[],display:PricingSnapshot,current:boolean,priceFor?:PurchasePriceReader){
  const additional=sum(plan.steps.filter(s=>s.kind!=='conflict').map(s=>additionalCost(s,display,current,priceFor)));
  const base=plan.base&&pledges.find(p=>p.pledgeId===plan.base!.pledgeId);
  const baseCost=base&&base.ships.length===1&&!base.ccus.length?recordedCost(base.acquisitionCost,display):unknown();
  const paid=sum([baseCost,...plan.steps.filter(s=>s.kind==='owned'||s.kind==='missing').map(s=>paidCcuCost(s,pledges,display))]);
  const invalid=!plan.base||plan.steps.some(s=>s.kind==='conflict'||s.kind==='missing');
  const investment=paid.knownMinor+additional.knownMinor;
  return {additional,paid,invalid,investment:!invalid&&!paid.missing&&!additional.missing&&Number.isSafeInteger(investment)?investment:null};
}
