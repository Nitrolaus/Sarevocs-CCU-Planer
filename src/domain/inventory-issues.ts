import type {Pledge} from './model';

export type InventoryReadIssue='reported-upgrade-problem'|'ccu-endpoints'|'ccu-source-conflict'|'duplicate-ccu'|'ship-model'|'duplicate-ship';
const model=(name:string)=>name.normalize('NFC').trim().replace(/\s+/g,' ').toLocaleLowerCase('en-US');
/** Read/mapping problems only. Unknown insurance and unverified applicability/identity are not failed reads. */
export function inventoryReadIssues(pledge:Pledge):InventoryReadIssue[]{
 const issues=new Set<InventoryReadIssue>();
 if(pledge.sourceValues.upgradeState==='unresolved'||!!pledge.sourceValues.upgradeIssue)issues.add('reported-upgrade-problem');
 const ccus=new Set<string>(),ships=new Set<string>();
 for(const ccu of pledge.ccus){
  if(ccus.has(ccu.instanceId))issues.add('duplicate-ccu');ccus.add(ccu.instanceId);
  if(!model(ccu.from)||!model(ccu.to)||model(ccu.from)===model(ccu.to))issues.add('ccu-endpoints');
 }
 for(const ship of pledge.ships){
  if(!model(ship.modelName))issues.add('ship-model');
  if(ships.has(ship.childId))issues.add('duplicate-ship');ships.add(ship.childId);
 }
 const raw=pledge.sourceValues.upgrade;
 if(raw){try{
  const value:unknown=JSON.parse(raw);
  if(!value||typeof value!=='object'||!('from'in value)||!('to'in value)||typeof value.from!=='string'||typeof value.to!=='string'||!model(value.from)||!model(value.to))issues.add('ccu-source-conflict');
  else if(pledge.ccus.length!==1||model(value.from)!==model(pledge.ccus[0]!.from)||model(value.to)!==model(pledge.ccus[0]!.to))issues.add('ccu-source-conflict');
 }catch{issues.add('ccu-source-conflict');}}
 return [...issues];
}
export function hasInventoryReadIssue(pledge:Pledge):boolean{return inventoryReadIssues(pledge).length>0;}
