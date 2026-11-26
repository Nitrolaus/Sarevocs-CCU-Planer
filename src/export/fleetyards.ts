import {z} from 'zod';
import {UserError,type AccountInventory} from '../domain/model';
import type {LastSeen} from '../storage/last-seen';
import type {CatalogueShip} from '../market/model';
import {catalogueIdentity} from '../market/ship-values';
import {reportSnapshot} from './snapshot';

export const MAX_FLEET_SHIPS=20_000;
export const fleetSelectionSchema=z.array(z.string().min(1).max(600)).min(1).max(MAX_FLEET_SHIPS)
 .refine(keys=>new Set(keys).size===keys.length);
export const fleetOptionsSchema=z.object({customShipNames:z.boolean(),paints:z.boolean()}).strict();
export type FleetOptions=z.infer<typeof fleetOptionsSchema>;
export type FleetShip={key:string;name:string;catalogueName:string|null;manufacturer:string|null;
 customShipName:string|null;paintSlugs:string[]};
export type FleetFileRow={name:string;public:false;nameVisible:false;shipName?:string;paintSlugs?:string[]};
export type FleetPreview={token:string;profileName:string;createdAt:string;inventoryAt:string|null;ships:FleetShip[]};

/** Cached inventory only. The renderer sees local keys, the external file never does. */
export function fleetShips(inventory:AccountInventory,observed:LastSeen|null,catalogue:readonly CatalogueShip[]){
 const snapshot=reportSnapshot(inventory,observed),counts=new Map<string,number>();
 for(const p of snapshot.pledges)for(const ship of p.ships){const key=JSON.stringify([p.id,ship.id]);counts.set(key,(counts.get(key)??0)+1);}
 const ships:FleetShip[]=[];
 for(const [pi,p] of snapshot.pledges.entries())for(const [si,ship] of p.ships.entries()){
  if(ship.role==='included'||ship.role==='loaner')continue;
  if(ships.length>=MAX_FLEET_SHIPS)throw new UserError('Der Bestand ist für diesen Export zu groß.');
  const model=!p.unresolvedUpgrade&&counts.get(JSON.stringify([p.id,ship.id]))===1?catalogueIdentity(ship.name,catalogue):undefined;
  ships.push({key:JSON.stringify([p.id,ship.id,pi,si]),name:ship.name,catalogueName:model?.name??null,manufacturer:model?.manufacturer??null,
   // Current readers do not prove an individual custom name or a FleetYards paint slug.
   // Do not guess either from pledge titles, owned paints or unrelated raw fields.
   customShipName:null,paintSlugs:[]});
 }
 return {profileName:snapshot.profileName,createdAt:snapshot.createdAt,inventoryAt:snapshot.inventoryAt,ships};
}

/** Explicit allowlist: prices, RSI identity, local IDs and arbitrary source properties cannot escape. */
export function fleetFile(ships:readonly FleetShip[],selected:readonly string[],options:FleetOptions):FleetFileRow[]{
 const keys=fleetSelectionSchema.parse(selected),settings=fleetOptionsSchema.parse(options);
 const indexed=new Map(ships.map(ship=>[ship.key,ship]));
 if(indexed.size!==ships.length||keys.some(key=>!indexed.get(key)?.catalogueName))throw new UserError('Die Schiffsauswahl ist nicht mehr gültig. Bitte die Vorschau neu öffnen.');
 const wanted=new Set(keys);
 return ships.filter(ship=>wanted.has(ship.key)).map(ship=>({name:ship.catalogueName!,public:false,nameVisible:false,
  ...(settings.customShipNames&&ship.customShipName?{shipName:ship.customShipName}:{}),
  ...(settings.paints&&ship.paintSlugs.length?{paintSlugs:[...ship.paintSlugs]}:{})}));
}
export const fleetJson=(rows:readonly FleetFileRow[])=>JSON.stringify(rows,null,2)+'\n';
