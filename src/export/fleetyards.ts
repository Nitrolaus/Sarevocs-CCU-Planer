import {z} from 'zod';
import {UserError,type AccountInventory,type Pledge} from '../domain/model';
import type {LastSeen} from '../storage/last-seen';
import type {CatalogueShip} from '../market/model';
import {catalogueIdentity} from '../market/ship-values';
import {reportSnapshot} from './snapshot';
import {sameStandaloneShip,standaloneModel} from '../pricing/inventory-values';
import {sameHistoryModelName} from '../domain/applied-ccu-price';
import {verifiedUpgradePurchasesSchema,type UpgradeHistoryResult} from '../domain/upgrade-history';
import {packageBasis,samePackageBasis,type PackageShare} from '../planner/package-shares';
import type {ChainObservation} from '../planner/observation';

export const MAX_FLEET_SHIPS=20_000;
export const fleetSelectionSchema=z.array(z.string().min(1).max(600)).min(1).max(MAX_FLEET_SHIPS)
 .refine(keys=>new Set(keys).size===keys.length);
const moneySchema=z.object({minor:z.number().int().min(0).max(100_000_000),currency:z.enum(['USD','EUR','GBP'])}).strict();
const dateSchema=z.iso.date().refine(value=>value>='1900-01-01'&&value<='2100-12-31');
export const fleetPricePolicySchema=z.discriminatedUnion('mode',[
 z.object({mode:z.literal('hidden')}).strict(),z.object({mode:z.literal('known')}).strict(),
 z.object({mode:z.literal('custom'),value:moneySchema}).strict()]);
export const fleetDatePolicySchema=z.discriminatedUnion('mode',[
 z.object({mode:z.literal('hidden')}).strict(),z.object({mode:z.literal('known')}).strict(),
 z.object({mode:z.literal('custom'),value:dateSchema}).strict()]);
export const fleetOptionsSchema=z.object({
 price:fleetPricePolicySchema.default({mode:'hidden'}),date:fleetDatePolicySchema.default({mode:'hidden'}),
 includeLti:z.boolean().default(false),includeWarbond:z.boolean().default(false),includePackageNames:z.boolean().default(false),
 overrides:z.array(z.object({key:z.string().min(1).max(600),price:fleetPricePolicySchema.optional(),date:fleetDatePolicySchema.optional()}).strict())
  .max(MAX_FLEET_SHIPS).default([]).refine(rows=>new Set(rows.map(row=>row.key)).size===rows.length),
 // Transitional callers may disable these old flags. The exact reference format has no such fields.
 customShipNames:z.boolean().optional().refine(value=>!value),paints:z.boolean().optional().refine(value=>!value),
}).strict();
export type FleetOptions=z.input<typeof fleetOptionsSchema>;
export type FleetPricePolicy=z.infer<typeof fleetPricePolicySchema>;
export type FleetDatePolicy=z.infer<typeof fleetDatePolicySchema>;
export type FleetMoney=z.infer<typeof moneySchema>;
export type FleetShip={key:string;name:string;catalogueName:string|null;manufacturer:string|null;
 customShipName:string|null;paintSlugs:string[];lti?:boolean;warbond?:boolean;packageName?:string;
 knownPrice?:FleetMoney|null;knownDate?:string|null;dateKind?:'purchase'|'hangar'|null};
export type FleetFileRow={manufacturer:string;name:string;lti:boolean;warbond:boolean;package_id:string;pledge:string;pledge_date:string;cost:string};
export type FleetPreview={token:string;profileName:string;createdAt:string;inventoryAt:string|null;ships:FleetShip[]};

/** Native-currency totals only: never mistake the original token price for the upgraded ship. */
function documentedTotal(p:Pledge,history:UpgradeHistoryResult|undefined,catalogue:readonly CatalogueShip[]):FleetMoney|null{
 const result=verifiedUpgradePurchasesSchema.safeParse(history),base=standaloneModel(p),receipt=p.rsiPurchase;
 if(!result.success||result.data.confirmedEmpty||!base||p.ships.length!==1||!receipt||receipt.status!=='documented'||receipt.source!=='order')return null;
 const steps=[...result.data.steps].sort((a,b)=>a.appliedAt!.localeCompare(b.appliedAt!));
 if(!sameHistoryModelName(base,steps[0]!.from,catalogue)||!sameHistoryModelName(p.ships[0]!.modelName,steps.at(-1)!.to,catalogue)||
  steps.some((step,i)=>step.ccuPledgeId===p.pledgeId||i>0&&!sameHistoryModelName(steps[i-1]!.to,step.from,catalogue)))return null;
 let minor=receipt.minor;
 for(const {price} of result.data.purchases!){
  if(price.status!=='documented'||price.source!=='order'||price.currency!==receipt.currency)return null;
  minor+=price.minor;
 }
 return moneySchema.safeParse({minor,currency:receipt.currency}).success?{minor,currency:receipt.currency}:null;
}

/** Cached inventory only. The renderer sees local keys, the external file never does. */
export function fleetShips(inventory:AccountInventory,observed:LastSeen|null,catalogue:readonly CatalogueShip[],shares:readonly PackageShare[]=[]){
 const snapshot=reportSnapshot(inventory,observed),counts=new Map<string,number>();
 const originals=snapshot.origin==='last-observed'?observed!.document.pledges:inventory.items.filter(item=>item.availability==='present').map(item=>item.pledge);
 const byId=new Map(originals.map(p=>[p.pledgeId,p]));
 const observation:ChainObservation=snapshot.origin==='last-observed'?{kind:'rsi-hangar',observedAt:observed!.observedAt}:
  {kind:'rsi-imports',observations:Object.fromEntries(inventory.items.filter(item=>item.availability==='present'&&item.source==='rsi-dom-probe/1').map(item=>[item.pledge.pledgeId,item.importedAt]))};
 for(const p of snapshot.pledges)for(const ship of p.ships){const key=JSON.stringify([p.id,ship.id]);counts.set(key,(counts.get(key)??0)+1);}
 const ships:FleetShip[]=[];
 for(const [pi,p] of snapshot.pledges.entries())for(const [si,ship] of p.ships.entries()){
  if(ship.role==='included'||ship.role==='loaner')continue;
  if(ships.length>=MAX_FLEET_SHIPS)throw new UserError('Der Bestand ist für diesen Export zu groß.');
  const model=!p.unresolvedUpgrade&&counts.get(JSON.stringify([p.id,ship.id]))===1?catalogueIdentity(ship.name,catalogue):undefined;
  const original=byId.get(p.id),history=snapshot.origin==='last-observed'?observed?.appliedPurchaseHistories?.[p.id]:undefined;
  const single=p.ships.length===1&&!p.ccus.length&&!p.unresolvedUpgrade;
  const unchanged=p.source!=='rsi-dom-probe/1'||!!original&&sameStandaloneShip(original,catalogue)||history?.status==='loaded'&&history.confirmedEmpty&&!history.partial;
  const basis=packageBasis(original,ship.id,observation),share=basis?shares.find(value=>samePackageBasis(value,basis)):undefined;
  const total=single&&original?documentedTotal(original,history,catalogue):null;
  const knownPrice=total??(single&&unchanged&&p.purchase.kind==='recorded'&&p.purchase.rsiSource!=='log'?p.purchase.value:null)??(share?{minor:share.minor,currency:share.currency}:null);
  ships.push({key:JSON.stringify([p.id,ship.id,pi,si]),name:ship.name,catalogueName:model?.name??null,manufacturer:model?.manufacturer??null,
   // Current readers do not prove an individual custom name or a FleetYards paint slug.
   // Do not guess either from pledge titles, owned paints or unrelated raw fields.
   customShipName:null,paintSlugs:[],lti:p.insurance.kind==='lti',warbond:/\bwarbond\b/i.test(p.name),packageName:p.name,
   knownPrice:knownPrice?{minor:knownPrice.minor,currency:knownPrice.currency}:null,
   knownDate:p.purchase.value?.purchaseDate??p.date,dateKind:p.purchase.value?.purchaseDate?'purchase':p.date?'hangar':null});
 }
 return {profileName:snapshot.profileName,createdAt:snapshot.createdAt,inventoryAt:snapshot.inventoryAt,ships};
}

export const fleetAmount=(value:FleetMoney)=>({USD:'$',EUR:'€',GBP:'£'}[value.currency])+(value.minor/100).toFixed(2)+' '+value.currency;
export const fleetDate=(value:string)=>new Intl.DateTimeFormat('en-US',{timeZone:'UTC',year:'numeric',month:'long',day:'numeric'}).format(new Date(value+'T12:00:00Z'));
export function fleetValues(ship:FleetShip,price:FleetPricePolicy,date:FleetDatePolicy){
 return {price:price.mode==='custom'?price.value:price.mode==='known'?ship.knownPrice??null:null,
  date:date.mode==='custom'?date.value:date.mode==='known'?ship.knownDate??null:null};
}

/** Exact Hangar XPLOR allowlist. Real RSI IDs never leave; sensitive values require explicit opt-in. */
export function fleetFile(ships:readonly FleetShip[],selected:readonly string[],options:FleetOptions):FleetFileRow[]{
 const keys=fleetSelectionSchema.parse(selected),settings=fleetOptionsSchema.parse(options);
 const indexed=new Map(ships.map(ship=>[ship.key,ship]));
 if(indexed.size!==ships.length||keys.some(key=>!indexed.get(key)?.catalogueName)||settings.overrides.some(row=>!indexed.has(row.key)))throw new UserError('Die Schiffsauswahl ist nicht mehr gültig. Bitte die Vorschau neu öffnen.');
 const wanted=new Set(keys);
 const overrides=new Map(settings.overrides.map(row=>[row.key,row]));
 return ships.filter(ship=>wanted.has(ship.key)).map((ship,i)=>{
  const override=overrides.get(ship.key),values=fleetValues(ship,override?.price??settings.price,override?.date??settings.date);
  return {manufacturer:ship.manufacturer??'',name:ship.catalogueName!,lti:settings.includeLti&&!!ship.lti,warbond:settings.includeWarbond&&!!ship.warbond,
   package_id:String(i+1).padStart(8,'0'),pledge:settings.includePackageNames&&ship.packageName?ship.packageName:'Standalone Ship - '+ship.catalogueName,
   pledge_date:values.date?fleetDate(dateSchema.parse(values.date)):'',cost:values.price?fleetAmount(moneySchema.parse(values.price)):''};
 });
}
export const fleetJson=(rows:readonly FleetFileRow[])=>JSON.stringify(rows,null,2)+'\n';
