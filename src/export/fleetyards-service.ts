import {randomUUID} from 'node:crypto';
import {UserError,type AccountInventory} from '../domain/model';
import type {LastSeen} from '../storage/last-seen';
import type {CatalogueShip} from '../market/model';
import type {PackageShare} from '../planner/package-shares';
import {fleetShips,fleetFile,fleetJson,type FleetOptions,type FleetPreview} from './fleetyards';

/** One frozen local snapshot per receipt; no network, account writes or authentication. */
export class FleetYardsService{
 private pending=new Map<string,{accountId:string;expires:number;preview:FleetPreview}>();
 constructor(private readonly now=()=>Date.now()){}
 preview(inventory:AccountInventory,observed:LastSeen|null,catalogue:readonly CatalogueShip[],shares:readonly PackageShare[]=[]):FleetPreview{
  const at=this.now();for(const [token,item]of this.pending)if(item.expires<at)this.pending.delete(token);
  const token=randomUUID(),preview={token,...fleetShips(inventory,observed,catalogue,shares)};
  while(this.pending.size>=3)this.pending.delete(this.pending.keys().next().value!);
  this.pending.set(token,{accountId:inventory.account.id,expires:at+15*60_000,preview:structuredClone(preview)});
  return preview;
 }
 file(accountId:string,token:string,selected:readonly string[],options:FleetOptions){
  const item=this.pending.get(token);
  if(!item||item.accountId!==accountId||item.expires<this.now())throw new UserError('Exportvorschau ist abgelaufen oder gehört zu einem anderen Profil. Bitte neu öffnen.');
  return fleetJson(fleetFile(item.preview.ships,selected,options));
 }
 remove(token:string){this.pending.delete(token);}
 clear(){this.pending.clear();}
}
