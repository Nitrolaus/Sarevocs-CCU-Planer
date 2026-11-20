import type { CatalogueShip, TargetOffer } from '../market/model';
import { shipValuesStale, type ShipValues } from '../market/ship-values';
import type { ChainModel } from './chain';

export type PurchaseCandidate={ship:CatalogueShip;from:ChainModel;to:ChainModel;usdMinor:number};
/** Only exact matrix ID + canonical name joins. All ties at the highest strictly lower MSRP participate. */
export function purchaseCandidates(input: { current: boolean; pool: { values?: ShipValues | null } }, offer:TargetOffer, now = Date.now()):{rows:PurchaseCandidate[];tier:number|null;reason:'none'|'stale'|'input'|'identity'|'no-candidates'} {
 if(!input.current||shipValuesStale(input.pool.values, now))return {rows:[],tier:null,reason:'stale'};
 if(offer.change==='missing'||!offer.warbond||offer.warbondMinor===null||offer.warbondMinor<=0||offer.warbondMinor>=offer.regularMinor)return {rows:[],tier:null,reason:'input'};
 const target=input.pool.values!.items.find(s=>s.id===offer.toShipId&&s.name===offer.targetName);
 if(!target||target.minor!==offer.regularMinor)return {rows:[],tier:null,reason:'identity'};
 const warbondMinor=offer.warbondMinor;
 const values=input.pool.values!.items.filter(s=>s.minor>0&&s.minor<warbondMinor),tier=values.length?Math.max(...values.map(s=>s.minor)):null;
 if(tier===null)return {rows:[],tier:null,reason:'no-candidates'};
 const to:ChainModel={key:'matrix:'+target.id,name:target.name,catalogueConfirmed:true,nominalUsd:target.minor};
 // The from-list is the authority for the price tier; an absent matrix entry must not silently select a cheaper tier.
 const rows=values.filter(s=>s.minor===tier).map(s=>({ship:{id:s.id,name:s.name,chassisId:null,manufacturer:'RSI',manufacturerCode:'',status:'unknown',focus:'',length:null} as CatalogueShip,from:{key:'matrix:'+s.id,name:s.name,catalogueConfirmed:true,nominalUsd:s.minor},to,usdMinor:offer.warbondMinor!-s.minor}));
 return {rows:rows.sort((a,b)=>a.ship.name.localeCompare(b.ship.name)),tier,reason:'none'};
}

/** Standard gaps connect existing nodes directly. A Warbond can make a newly bought intermediate worthwhile. */
export function warbondBridgeModels(catalogue: readonly CatalogueShip[], offers: readonly TargetOffer[],
  values: ShipValues | null | undefined, current: boolean, now = Date.now()): ChainModel[] {
  if (!current || shipValuesStale(values, now)) return [];
  const names = new Map(catalogue.map(ship => ['matrix:' + ship.id, ship.name]));
  const models = new Map<string, ChainModel>();
  for (const offer of offers) {
    if (!offer.warbond || offer.change === 'missing') continue;
    const { rows } = purchaseCandidates({ current, pool: { values } }, offer, now);
    for (const { from, to } of rows) {
      if (names.get(from.key) !== from.name || names.get(to.key) !== to.name) continue;
      models.set(from.key, from);
      models.set(to.key, to);
    }
  }
  return [...models.values()];
}
