import type {Pledge} from '../domain/model';
import {offersAreStale,type CatalogueShip,type MarketSnapshot} from '../market/model';
import {catalogueIdentity,nominalValue,sameModelName,shipValuesStale} from '../market/ship-values';
import type {PricingSnapshot} from './model';import {estimateMinor,euroRateIsStale} from './money';
import {historicalPoundMinor,poundRateMatchesDate,type PoundRate} from './pound-history';
type Money=NonNullable<Pledge['acquisitionCost']>;
export type AcquisitionValue=Omit<Money,'currency'>&{currency:'USD'|'EUR'|'GBP';purchaseDate?:string;poundRate?:PoundRate};
/** This RSI field is a USD pledge value, not a historical base price or proof of personal cash paid. */
export function parseRsiPledgeValue(raw:unknown):Money|null{
 if(typeof raw!=='string'||raw.length>96||/[\u0000-\u001f\u007f]/u.test(raw))return null;
 const match=/^\$?((?:0|[1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+))(?:\.(\d{2}))? USD$/.exec(raw.trim());if(!match)return null;
 const cents=BigInt(match[1]!.replaceAll(',',''))*100n+BigInt(match[2]??'0');if(cents>100_000_000n)return null;
 return {minor:Number(cents),currency:'USD',taxBasis:'net',evidence:'RSI-Hangar: Pledgewert in USD, einschließlich angewendeter CCUs; kein Rechnungsbeleg.'};
}
export type PurchaseValue={kind:'recorded'|'rsi-pledge'|'unavailable';value:AcquisitionValue|null;scope:'pledge-total';sharedByShips:number};
export const RSI_ORDER_PRICE = 'RSI-Bestellung: Kaufpreis je Exemplar der zugeordneten Position.';
export const RSI_LOG_PRICE = 'RSI-Kaufprotokoll: protokollierter Wert beim Erwerb.';

export function standaloneModel(pledge: Pledge): string | undefined {
  const title = /^Standalone Ships?\s*[-–]\s*(.+)$/i.exec(pledge.name)?.[1];
  return title?.replace(/(?:\s+(?:[-–]\s+)?(?:Warbond(?: Edition)?|Standard Edition|IAE(?: 29\d{2})?(?: Edition)?))+$/i, '');
}

export function sameStandaloneShip(pledge: Pledge, catalogue: readonly CatalogueShip[] = []): boolean {
  const name = standaloneModel(pledge), ship = pledge.ships[0];
  return !!name && !!ship && pledge.ships.length === 1 && !pledge.ccus.length &&
    pledge.sourceValues.upgradeState !== 'unresolved' && sameModelName(name, ship.modelName, catalogue);
}
export function purchaseValue(pledge:Pledge,source:string):PurchaseValue{
 const receipt=source==='rsi-dom-probe/1'?pledge.rsiPurchase:undefined;
 const recorded:AcquisitionValue|null=pledge.acquisitionCost?{...pledge.acquisitionCost}:receipt?.status==='documented'?{
  minor:receipt.minor,currency:receipt.currency,taxBasis:'unknown',evidence:receipt.source==='order'?RSI_ORDER_PRICE:RSI_LOG_PRICE,
  ...(receipt.purchaseDate?{purchaseDate:receipt.purchaseDate}:{}),...(receipt.poundRate?{poundRate:receipt.poundRate}:{}),
 }:null;
 const value=recorded??(source==='rsi-dom-probe/1'&&receipt?.status!=='excluded'?parseRsiPledgeValue(pledge.sourceValues.pledgeValue):null);
 return {kind:recorded?'recorded':value?'rsi-pledge':'unavailable',value,scope:'pledge-total',sharedByShips:pledge.ships.length};
}

export function inventoryAcquisitionPrice(pledge:Pledge,source:string,catalogue:readonly CatalogueShip[]=[]):PurchaseValue{
 const price=purchaseValue(pledge,source);
 if(price.kind!=='rsi-pledge'||!price.value||!pledge.ships.length)return price;
 const configuration=pledge.sourceValues.pledgeConfigurationValue;
 if(sameStandaloneShip(pledge,catalogue)&&price.value.minor>0&&(!configuration||parseRsiPledgeValue(configuration)?.minor===0))return price;
 return {...price,kind:'unavailable',value:null};
}
export type CurrentShipValue={childId:string;name:string;usdMinor:number|null;observedAt:string|null;source:'rsi-upgrade'|'offer-observation'|'unavailable'};
export function currentShipValues(pledge:Pledge,market?:MarketSnapshot):CurrentShipValue[]{
 return pledge.ships.map(ship=>{const identity=catalogueIdentity(ship.modelName,market?.catalogue?.ships??[]),values=market?.values;
  const normalized=(s:string)=>s.normalize('NFC').trim().replace(/\s+/g,' ').toLocaleLowerCase('en-US');
  const fromRsi=!!identity&&!shipValuesStale(values)&&!!values!.items.find(v=>v.id===identity.id&&normalized(v.name)===normalized(identity.name));
  const usdMinor=identity?nominalValue(identity,market?.offers?.items??[],!!market&&!offersAreStale(market),values):null;
  return {childId:ship.childId,name:ship.modelName,usdMinor,observedAt:usdMinor===null?null:fromRsi?values!.fetchedAt:market?.offers?.fetchedAt??null,source:usdMinor===null?'unavailable':fromRsi?'rsi-upgrade':'offer-observation'};
 });
}
/** Convert an old recorded value only. Never add today's VAT or imply a historical FX rate. */
export function convertPurchaseValue(value:AcquisitionValue|null,display:PricingSnapshot):{minor:number|null;approximate:boolean}{
 if(!value)return {minor:null,approximate:false};if(value.currency===display.settings.currency)return {minor:value.minor,approximate:false};
 if(value.currency==='GBP'){
  const {purchaseDate,poundRate}=value;
  const minor=purchaseDate&&poundRate&&poundRateMatchesDate(poundRate,purchaseDate)
   ?historicalPoundMinor(value.minor,display.settings.currency,poundRate):null;
  return {minor,approximate:minor!==null};
 }
 const rate=display.rate&&!euroRateIsStale(display.rate)?display.rate:null;if(!rate||value.minor>100_000_000)return {minor:null,approximate:true};
 const minor=value.currency==='USD'?estimateMinor(value.minor,{...display.settings,taxMode:'net'},rate):Number((BigInt(value.minor)*BigInt(rate.usdPerEurMicros)+500_000n)/1_000_000n);
 return {minor,approximate:true};
}
