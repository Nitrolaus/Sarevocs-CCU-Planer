import {UserError,type AccountInventory,type Pledge} from '../domain/model';
import type {LastSeen} from '../storage/last-seen';
import {comparePledgeDates,pledgeDate} from '../domain/pledge-date';
import {gameContentKind} from '../domain/game-content';
import {gameAccessAssignment} from '../domain/game-access-assignment';
import {purchaseValue, RSI_ORDER_PRICE, RSI_LOG_PRICE} from '../pricing/inventory-values';
import type {PoundRate} from '../pricing/pound-history';

type ReportMoney={minor:number;currency:'USD'|'EUR'|'GBP';taxBasis:'net'|'gross'|'unknown';purchaseDate?:string;poundRate?:PoundRate};
type ReportInsurance={kind:'lti'}|{kind:'months';months:number}|{kind:'unknown'};
export type ReportPledge={
 id:string;name:string;date:string|null;source:string;insurance:ReportInsurance;
 ships:{id:string;name:string;role:Pledge['ships'][number]['role']}[];
 ccus:{id:string;from:string;to:string;status:Pledge['ccus'][number]['status'];applicability:Pledge['ccus'][number]['applicability']}[];
 purchase:{kind:ReturnType<typeof purchaseValue>['kind'];value:ReportMoney|null;scope:'pledge-total';rsiSource?:'order'|'log'};
 gameKind:ReturnType<typeof gameContentKind>;access:ReturnType<typeof gameAccessAssignment>;
 protected:boolean;unresolvedUpgrade:boolean;
};
export type ReportSnapshot={
 profileName:string;mode:'real'|'demo';createdAt:string;inventoryAt:string|null;
 origin:'last-observed'|'accepted-import';scope:'partial-or-unverified'|'file-declared-complete';
 pledges:ReportPledge[];
};

/** A local report snapshot, shared by both output formats. No network, storage or authentication access.
 * Values are explicitly selected; raw source values, descriptions and session-related fields never escape. */
export function reportSnapshot(inventory:AccountInventory,observed:LastSeen|null,createdAt=new Date().toISOString()):ReportSnapshot{
 if(!Number.isFinite(Date.parse(createdAt)))throw new UserError('Exportdatum ist ungültig.');
 const account=inventory.account;
 if(observed){
  const identity=observed.document.account;
  if(account.mode!=='real'||observed.accountId!==account.id||observed.document.dataMode!=='real'||
    identity.identityKind==='manual-reference'&&identity.reference!==`rsi-local:${account.id}`||
    account.reference!==null&&(account.reference!==identity.reference||account.identityKind!==identity.identityKind)||
    !Number.isFinite(Date.parse(observed.observedAt)))throw new UserError('Exportbestand gehört nicht zu diesem Profil.');
 }
 const latestAccepted=inventory.items.reduce((latest,item)=>Math.max(latest,Date.parse(item.importedAt)||0),Date.parse(account.lastComplete??'')||0);
 // Match the main page: a newer observed view outranks an older accepted import, never the reverse.
 const useObserved=!!observed&&Date.parse(observed.observedAt)>latestAccepted;
 const rows=useObserved?observed!.document.pledges.map(pledge=>({pledge,source:'rsi-dom-probe/1'})):
  inventory.items.filter(item=>item.availability==='present').map(item=>({pledge:item.pledge,source:item.source}));
 const money=(v:ReturnType<typeof purchaseValue>['value']):ReportMoney|null=>v?{minor:v.minor,currency:v.currency,taxBasis:v.taxBasis,
  ...(v.purchaseDate?{purchaseDate:v.purchaseDate}:{}),...(v.poundRate?{poundRate:v.poundRate}:{})}:null;
 const pledges=rows.slice().sort((a,b)=>comparePledgeDates(a.pledge,b.pledge)).map(({pledge:p,source}):ReportPledge=>{
  const cost=purchaseValue(p,source),assignment=gameAccessAssignment(p,source);
  const rsiSource=cost.value?.evidence===RSI_ORDER_PRICE?'order' as const:cost.value?.evidence===RSI_LOG_PRICE?'log' as const:undefined;
  return {id:p.pledgeId,name:p.name,date:pledgeDate(p),source,
   insurance:p.insurance.kind==='months'?{kind:'months',months:p.insurance.months}:{kind:p.insurance.kind},
   ships:p.ships.map(s=>({id:s.childId,name:s.modelName,role:s.role})),
   ccus:p.ccus.map(c=>({id:c.instanceId,from:c.from,to:c.to,status:c.status,applicability:c.applicability})),
   purchase:{kind:cost.kind,value:money(cost.value),scope:'pledge-total',...(rsiSource?{rsiSource}:{})},gameKind:gameContentKind(p),
   access:{state:assignment.state,games:[...assignment.games]},protected:p.protected,unresolvedUpgrade:p.sourceValues.upgradeState==='unresolved'};
 });
 return {profileName:account.name,mode:account.mode,createdAt,inventoryAt:useObserved?observed!.observedAt:latestAccepted?new Date(latestAccepted).toISOString():null,
  origin:useObserved?'last-observed':'accepted-import',
  scope:!useObserved&&account.lastComplete&&Date.parse(account.lastComplete)===latestAccepted?'file-declared-complete':'partial-or-unverified',pledges};
}
