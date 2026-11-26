import {UserError,type AccountInventory,type Pledge} from '../domain/model';
import type {LastSeen} from '../storage/last-seen';
import {reportSnapshot} from './snapshot';
import type {ReportDocument,ReportFilters,ReportKind,ReportChain,ReportColumn,ReportRow} from './model';
import {reportFilterLabels} from './filters';
import {offersAreStale,type MarketSnapshot} from '../market/model';
import {catalogueIdentity} from '../market/ship-values';
import {convertPurchaseValue,currentShipValues} from '../pricing/inventory-values';
import {estimateMinor,euroRateIsStale,formatMinor} from '../pricing/money';
import type {PricingSnapshot} from '../pricing/model';
import {prepareChains,buildChain} from '../planner/chain';
import {manualChain} from '../planner/manual';
import {selectedStartBase,withStartBase} from '../planner/bases';
import {withoutExcludedCcus} from '../planner/exclusions';
import {additionalCost,paidBaseCost,paidCcuCost,chainCosts} from '../planner/costs';
import {purchasePriceReader} from '../planner/shopping-list';
import {analyseReservations,availableForTarget,DEFAULT_PRIORITIES,blockingPlanResources,type ReservationTarget} from '../planner/reservations';
import type {PlannerDraft} from '../planner/draft';
import {deriveLoaners} from '../loaners/derive';
import {LOANER_ARTICLES,type LoanerCache} from '../loaners/model';
import {loanerReviewBasis,loanerReviewKey,type LoanerReviewsSnapshot} from '../loaners/review-model';
import {paintAdvice} from '../paints/advice';
import {gameAccessEvidence} from '../domain/game-access';
import {addonCategories,inventoryAddons} from '../domain/inventory-addons';
import {pledgeDate} from '../domain/pledge-date';
import type {PackageShare} from '../planner/package-shares';

export type ReportInput={kind:ReportKind;inventory:AccountInventory;observed:LastSeen|null;market:MarketSnapshot;display:PricingSnapshot;
 chain?:ReportChain;excluded?:string[];targets?:(number|null)[];drafts?:Map<number,PlannerDraft>;now?:string;allowEmpty?:boolean;packageShares?:readonly PackageShare[];
 loaners?:LoanerCache|null;loanerStatus?:Map<string,string>;filters?:readonly string[]};

export async function createReports(input:Omit<ReportInput,'kind'>,kinds:readonly ReportKind[],reviews?:LoanerReviewsSnapshot,filters?:ReportFilters):Promise<ReportDocument>{
 const now=input.now??new Date().toISOString(),loanerStatus=new Map<string,string>();
 if(kinds.includes('loaners')&&reviews?.readable&&reviews.accountId===input.inventory.account.id){
  const snapshot=reportSnapshot(input.inventory,input.observed,now);
  const source=snapshot.origin==='last-observed'?input.observed!.document.pledges:input.inventory.items.filter(i=>i.availability==='present').map(i=>i.pledge);
  await Promise.all(deriveLoaners(source,input.loaners??null).rows.map(async row=>{
   const review=reviews.entries[await loanerReviewKey(loanerReviewBasis(row))];
   if(review)loanerStatus.set(row.key,review.state);
  }));
 }
 const sections=kinds.map(kind=>createReport({...input,kind,now,loanerStatus,allowEmpty:true,filters:kind==='inventory'?undefined:filters?.[kind]}));
 if(sections.reduce((sum,d)=>sum+d.rows.length,0)>100_000)throw new UserError('Export ist zu groß. Bitte den Umfang eingrenzen.');
 return {...sections[0]!,sections};
}
/** All inputs are cached local views. Reports never call readers, authentication or inventory mutations. */
export function createReport(input:ReportInput):ReportDocument{
 const {kind,market,display}=input,snapshot=reportSnapshot(input.inventory,input.observed,input.now),en=display.settings.language==='en';
 const l=(de:string,english:string)=>en?english:de,open=l('Offen','Unknown');
 const filters=input.filters??[],filtered=filters.length>0;
 const matches=(...ids:string[])=>!filtered||ids.some(id=>filters.includes(id));
 const fx=display.rate&&!euroRateIsStale(display.rate,Date.parse(snapshot.createdAt))?display.rate:null;
 const current=!offersAreStale(market,Date.parse(snapshot.createdAt));
 const currency=display.settings.currency,priceHeader=currency+(display.settings.taxMode==='gross'?` inkl. ${display.settings.vatBasisPoints/100} % MwSt.`:' netto');
 const convert=(n:number|null)=>{const v=estimateMinor(n,display.settings,fx);return v===null?null:v/100;};
 const money=(n:number)=>formatMinor(n,currency,display.settings.language);
 const columns:ReportColumn[]=[],rows:ReportRow[]=[],totals:ReportDocument['totals']=[];
 const notes=[l('Lokale Momentaufnahme; keine Kauf- oder Änderungsvorgänge.','Local snapshot; no purchases or changes.'),
  l('Währungsumrechnung ist ein Richtwert. Historische Zahlungen erhalten keine neue Mehrwertsteuer.','Currency conversions are estimates. Historical payments receive no new VAT.'),
  fx?`ECB ${fx.sourceDate}: 1 EUR = ${fx.usdPerEurMicros/1_000_000} USD`:l('Kein aktueller EZB-Referenzkurs verfügbar.','No current ECB reference rate available.')];
 if(kind!=='inventory'&&filtered)notes.unshift(l('Unterfilter','Filters')+' · '+reportFilterLabels(kind,filters,display.settings.language).join(l(' oder ',' or ')));
 let title='';
 const col=(label:string,width:number,format?:ReportColumn['format'])=>columns.push({label,width,format});
 const pledges:Pledge[]=snapshot.origin==='last-observed'?input.observed!.document.pledges:input.inventory.items.filter(i=>i.availability==='present').map(i=>i.pledge);
 if(kind==='inventory'||kind==='ships'||kind==='ccus'||kind==='packages'||kind==='access'){
  title=kind==='ships'?l('Schiffe & Fahrzeuge','Ships & vehicles'):kind==='ccus'?l('CCUs im Bestand','Owned CCUs'):
   kind==='packages'?l('Spielpakete','Game packages'):kind==='access'?l('Spielzugänge','Game access'):l('Bestand dieses Profils','Inventory of this profile');
  notes.push(l('Kaufwerte gelten je gesamtem Paket und stehen genau einmal. RSI-Pledgewerte sind kein Beleg der persönlich bezahlten Summe.','Purchase values apply to the whole pledge and appear once. RSI pledge values do not prove personal cash paid.'),
   l('Letzter lokal gelesener Bestand; keine Behauptung einer aktuellen vollständigen RSI-Kontoprüfung.','Last locally read inventory; no claim of a current complete RSI account check.'),
   `${l('Bestandsstand','Inventory as of')}: ${snapshot.inventoryAt??open}`);
  [l('Paket / Gegenstand','Pledge / item'),l('Aktuelle Schiffe / Fahrzeuge','Current ships / vehicles'),l('Hersteller','Manufacturer'),l('CCU Von → Nach','CCU From → To')].forEach((v,i)=>col(v,[32,29,22,35][i]!));
  col(l('Versicherung','Insurance'),16);col(l('RSI-Datum','RSI date'),13,'date');col(l('Kaufwert','Purchase value')+' '+currency,16,'money');col(l('Originalbetrag','Original amount'),14,'money');col(l('Währung / Steuer','Currency / tax'),18);col(l('Wertbeleg','Value basis'),22);col(l('Heutiger Schiffswert','Current ship value')+' '+priceHeader,18,'money');col(l('Art / Hinweise','Type / notes'),34);
  const rawById=new Map(pledges.map(p=>[p.pledgeId,p]));const known=new Map<string,number>();let missing=0;
  for(const p of snapshot.pledges){
   const raw=rawById.get(p.id),ccus=kind==='ccus'?p.ccus.filter(ccu=>matches(ccu.status)):p.ccus;
   const unresolved=p.unresolvedUpgrade&&matches('unverified');
   if(kind==='ships'&&!p.ships.some(s=>s.role!=='loaner') || kind==='ccus'&&!p.ccus.length&&!p.unresolvedUpgrade ||
     kind==='packages'&&p.gameKind!=='package'||kind==='access'&&(p.access.state!=='observed'||!p.access.games.length))continue;
   if(kind==='ships'&&!matches(p.insurance.kind)||kind==='ccus'&&!ccus.length&&!unresolved||
     kind==='access'&&!matches(...p.access.games))continue;
   if(kind==='packages'&&filtered){
    const games=raw?gameAccessEvidence(raw):null;
    const key=games?.starCitizen&&games.squadron42?'both':games?.starCitizen?'sc':games?.squadron42?'sq42':'';
    if(!matches(key))continue;
   }
   const cost=p.purchase.value,converted=cost?convertPurchaseValue({...cost,evidence:''},display).minor:null;
   if(converted===null)missing++;else known.set(cost!.taxBasis,(known.get(cost!.taxBasis)??0)+converted);
   const ships=p.ships.filter(s=>s.role!=='loaner'),values=raw?currentShipValues(raw,market).filter(v=>ships.some(s=>s.id===v.childId)):[];
   // One pledge row: neither a package price nor its current fleet value is repeated for each child.
   const currentValue=values.length&&values.every(v=>v.usdMinor!==null)?values.reduce((sum,v)=>sum+v.usdMinor!,0):null;
   const currentConverted=currentValue!==null&&currentValue<=100_000_000?convert(currentValue):null;
   const access=p.access.games.map(g=>g==='sc'?'SC':'SQ42').join(' + ');
   const hints=[p.gameKind==='package'?l('Spielpaket','Game package'):p.gameKind==='copy'?l('Spielkopie','Game copy'):'',p.protected?l('Geschützt','Protected'):'',access?`${access} (${p.access.state})`:'',(kind==='ccus'?unresolved:p.unresolvedUpgrade)?l('Upgrade ungeklärt','Upgrade unresolved'):'',ccus.some(c=>c.applicability!=='confirmed')?l('CCU-Anwendbarkeit ungeprüft','CCU applicability unverified'):''].filter(Boolean).join(' · ');
   const evidence=p.purchase.rsiSource==='order'?l('RSI-Bestellposition','RSI order line'):p.purchase.rsiSource==='log'?l('RSI-Protokollwert','RSI history value'):
    p.purchase.kind==='recorded'?l('Erfasst','Recorded'):p.purchase.kind==='rsi-pledge'?'RSI-Pledgewert':open;
   const basis=cost?.currency==='GBP'&&converted!==null&&cost.poundRate
    ?evidence+' · '+l('Historischer EZB-Kurs','Historical ECB rate')+' '+cost.poundRate.sourceDate:evidence;
   rows.push({tone:'owned',cells:[p.name,ships.map(s=>s.name).join(' / '),[...new Set(ships.map(s=>catalogueIdentity(s.name,market.catalogue?.ships??[])?.manufacturer??open))].join(' / '),ccus.map(c=>`${c.from} → ${c.to}`).join(' / '),ccus.length&&!p.ships.length?l('Basis gilt','Base applies'):p.insurance.kind==='lti'?'LTI':p.insurance.kind==='months'?`${p.insurance.months} ${l('Monate','months')}`:open,p.date?new Date(p.date):null,converted===null?null:converted/100,cost?cost.minor/100:null,cost?`${cost.currency} / ${cost.taxBasis}`:'',basis,currentConverted,hints]});
  }
  for(const [basis,amount]of known)totals.push({label:l('Bekannte Paket-Kaufwerte','Known pledge purchase values')+' · '+(basis==='net'?l('netto','net'):basis==='gross'?l('brutto','gross'):l('Steuerbasis ungeklärt','unknown tax basis')),value:money(amount)});
  if(missing)totals.push({label:l('Kaufwerte offen','Purchase values unknown'),value:String(missing)});
 }else if(kind==='addons'){
  title=l('Add-ons & Gear','Add-ons & Gear');
  const source=snapshot.origin==='last-observed'?pledges.map(pledge=>({pledge,source:'rsi-dom-probe/1'})):
   input.inventory.items.filter(item=>item.availability==='present');
  col(l('Gegenstand','Item'),32);col(l('Art','Type'),22);col(l('Zuordnung','Association'),24);
  col(l('Enthalten in','Included in'),36);col(l('Mein Kaufpreis','My purchase price'),18,'money');
  col(l('Währung','Currency'),12);col(l('Preisumrechnung','Price conversion'),20);
  col(l('RSI-Datum','RSI date'),14,'date');
  notes.push(l('Einzelpreise erscheinen nur für einen belegten Einzelkauf. Gemeinsame Paketpreise werden nicht aufgeteilt.',
   'Individual prices require a documented single-item purchase. Shared package prices are not divided between items.'));
  for(const item of inventoryAddons(source,market.catalogue?.ships.map(ship=>ship.name)??[])){
   if(!matches(item.category))continue;
   const converted=convertPurchaseValue(item.purchase,display),cost=item.purchase;
   const date=pledgeDate(item.pledge),category=addonCategories.find(([id])=>id===item.category)!;
   rows.push({cells:[item.name,category[en?2:1],item.relatedShips.join(' / '),item.pledge.name,
    cost?(converted.minor??cost.minor)/100:null,cost?(converted.minor===null?cost.currency:currency):'',
    converted.minor!==null&&converted.approximate?l('Richtwert','Estimate'):'',date?new Date(date):null]});
  }
 }else if(kind==='paints'){
  title='Paints';
  const source=snapshot.origin==='last-observed'?pledges.map(pledge=>({pledge,source:'rsi-dom-probe/1'})):
   input.inventory.items.filter(item=>item.availability==='present');
  const evidence=new Map(source.map(row=>[row.pledge.pledgeId,row.source==='rsi-dom-probe/1'?row.pledge.sourceValues.meltable:undefined]));
  const paints=paintAdvice(source,null,Date.parse(snapshot.createdAt)).rows;
  notes.push(l('Lackierungen aus dem lokal gelesenen Bestand. Paketwerte gelten für den ganzen Pledge.','Paints from the last local inventory. Values apply to the whole pledge.'));
  col(l('Pledge / Paket','Pledge / package'),30);col(l('Lackierungen','Paints'),35);col(l('Anzahl','Count'),8);
  col(l('Art / Schutz','Type / protection'),25);col(l('Pledgewert USD netto','Net pledge value USD'),21,'money');col(l('Einschmelzstatus','Reclaim status'),26);
  for(const row of paints){
   const reclaim=evidence.get(row.pledgeId);
   const kind=row.protection??(reclaim==='true'?'meltable':reclaim==='false'?'not-meltable':'unknown');
   if(!matches(kind))continue;
   rows.push({tone:row.protection?'warning':'owned',cells:[row.name,row.paintNames.join(' / '),row.paintCount,
    row.protection==='ship-package'?l('Im Schiffspaket – geschützt','Protected in ship package'):
    row.protection==='mixed-contents'?l('Weitere Inhalte – geschützt','Protected mixed contents'):l('Reiner Paint-Pledge','Paint-only pledge'),
    row.oldMinor===null?null:row.oldMinor/100,row.protection?l('Teil eines Pakets','Part of a package'):reportFilterLabels('paints',[kind],display.settings.language)[0]!]});
  }
 }else if(kind==='buyback'){
  title='Buy Back';
  const observed=input.observed?.document.buybackObservation;
  const entries=observed?input.observed!.document.buybacks:input.inventory.buybacks;
  const token=observed?.current?observed.token:'unknown';
  notes.push(l('Rückkauf und Kaufbarkeit sind ungeprüft.','Buyback and availability are unverified.'));
  if(observed)notes.push(`${l('Quellstand','Source as of')}: ${observed.observedAt}`);
  col(l('Schiff / Paket','Ship / package'),32);col(l('Ursprüngliche Schiffe','Original ships'),28);col(l('Versicherung','Insurance'),16);
  col(l('Rückkaufpreis','Buyback price'),16,'money');col(l('Währung / Steuer','Currency / tax'),18);col('Store Credits',22);
  for(const entry of entries){
   const insurance=entry.insurance,price=entry.currentPrice;
   if(!matches(insurance?.kind??'unknown'))continue;
   rows.push({cells:[entry.name,entry.originalShips?.join(' / ')??'',insurance?.kind==='lti'?'LTI':insurance?.kind==='months'?`${insurance.months} ${l('Monate','months')}`:open,
    price?price.minor/100:null,price?`${price.currency} / ${price.taxBasis}`:'',token==='available'?l('Token verfügbar','Token available'):token==='unavailable'?l('Kein Token verfügbar','No token available'):open]});
  }
 }else if(kind==='loaners'){
  title=l('Loaner & Beiboote','Loaners & snubs');
  const derived=deriveLoaners(pledges,input.loaners??null);
  notes.push(l('RSI-Regeln sind kein Zuteilungsnachweis. Benutzerangaben sind separat gekennzeichnet.','RSI rules do not prove assignment. User reviews are identified separately.'));
  if(derived.partialRules)notes.push(l('Regeldaten sind unvollständig.','Rule data is incomplete.'));
  col(l('Schiff / Fahrzeug','Ship / vehicle'),30);col(l('RSI-Regel für','RSI rule for'),30);
  col(l('Quelle','Source'),33);col(l('Benutzerangabe','User review'),23);col(l('Auch im Bestand','Also owned'),16);
  for(const row of derived.rows){
   const origins=row.origins.filter(origin=>matches(origin.kind));
   if(!origins.length)continue;
   const status=input.loanerStatus?.get(row.key);
   rows.push({cells:[row.name,[...new Set(origins.map(o=>o.publishedParent))].join(' / '),
    [...new Set(origins.map(o=>LOANER_ARTICLES[o.source].title))].join(' / '),
    status==='present'?l('Selbst bestätigt','Self-confirmed'):status==='absent'?l('Nicht vorhanden','Marked absent'):l('Unbestätigt','Unconfirmed'),
    row.alsoOwned?l('Ja','Yes'):l('Nein','No')]});
  }
 }else if(kind==='offers'){
  title=l('Messeangebote','Show offers');
  notes.push(l('Quelle: Open Hangar. Zielwerte sind keine Preise einzelner CCUs. Warbond-Rabatt = Standard-Zielwert minus Warbond-Zielwert.','Source: Open Hangar. Target values are not prices of individual CCUs. Warbond discount = standard target value minus Warbond target value.'),`${l('Quellstand','Source as of')}: ${market.offers?.sourceAt??open}`,current?l('Aktuelle Angebotsbeobachtung; Kaufbarkeit des konkreten CCUs ungeprüft.','Current offer observation; individual CCU availability unverified.'):l('Angebotsdaten fehlen oder sind veraltet.','Offer data missing or stale.'));
  col(l('Zielschiff','Target ship'),35);col(l('Status','Status'),20);col(l('Standard-Zielwert','Standard target value')+' '+priceHeader,21,'money');col('USD netto',16,'money');col(l('Warbond-Zielwert','Warbond target value')+' '+priceHeader,21,'money');col('Warbond USD netto',17,'money');col(l('Zielwert-Rabatt','Target value discount')+' '+currency,18,'money');col(l('Zuletzt beobachtet','Last observed'),19,'date');
  for(const o of [...(market.offers?.items??[])].sort((a,b)=>a.targetName.localeCompare(b.targetName))){
   if(!matches(o.warbond?'warbond':'standard'))continue;
   rows.push({tone:o.change==='missing'||!current?'warning':'purchase',cells:[o.targetName,o.change==='missing'?l('Nicht mehr beobachtet','No longer observed'):current?l('Beobachtet','Observed'):l('Veraltet','Stale'),convert(o.regularMinor),o.regularMinor/100,o.warbond&&o.warbondMinor!==null?convert(o.warbondMinor):null,o.warbond&&o.warbondMinor!==null?o.warbondMinor/100:null,o.warbond&&o.warbondMinor!==null?convert(o.regularMinor-o.warbondMinor):null,new Date(o.lastSeenAt)]});
  }
 }else{
  if(!input.chain)throw new UserError(l('Zuerst eine CCU-Kette mit Startbasis anzeigen.','First display a CCU chain with a start base.'));
  const context=input.chain,target=market.catalogue?.ships.find(s=>s.id===context.targetId);
  if(!target)throw new UserError(l('Zielschiff ist im lokalen Katalog nicht verfügbar.','Target ship unavailable in the local catalogue.'));
  const observation=snapshot.origin==='last-observed'?{kind:'rsi-hangar' as const,observedAt:input.observed!.observedAt}:{kind:'rsi-imports' as const,observations:Object.fromEntries(input.inventory.items.filter(i=>i.availability==='present'&&i.source==='rsi-dom-probe/1').map(i=>[i.pledge.pledgeId,i.importedAt]))};
  const pool=withoutExcludedCcus(prepareChains(pledges,market.catalogue?.ships??[],market.offers?.items??[],current,observation,market.values),input.excluded??[]);
  const base=selectedStartBase(pool,context.draft);if(!base)throw new UserError(l('Startbasis der angezeigten Kette ist nicht verfügbar.','The displayed chain start base is unavailable.'));
  const higher:ReservationTarget[]=[];
  for(const slot of DEFAULT_PRIORITIES){const id=input.targets?.[slot];if(id===context.targetId)break;const ship=market.catalogue?.ships.find(s=>s.id===id),draft=id?input.drafts?.get(id):null,b=draft?selectedStartBase(pool,draft):null;if(!ship||!draft||!b)continue;const scoped=withStartBase(pool,b.key),unavailable=analyseReservations(higher).resources;
   const plan=draft.mode==='manual'?manualChain(scoped,ship,market.catalogue!.ships,market.offers?.items??[],current,draft,unavailable):buildChain(availableForTarget(scoped,unavailable),ship,market.offers?.items??[],current,b.key,{...display,shopPrices:market.shopPrices});higher.push({slot,targetId:ship.id,name:ship.name,plan});}
  const blocked=analyseReservations(higher).resources;
  const plan=manualChain(withStartBase(pool,base.key),target,market.catalogue!.ships,market.offers?.items??[],current,context.draft,blocked);
  const priceFor=purchasePriceReader(market.offers?.items??[],market.values,current,Date.parse(snapshot.createdAt),market.shopPrices);
  const costs=chainCosts(plan,pledges,display,current,priceFor,observation,input.packageShares),conflicts=blockingPlanResources(plan,blocked),invalid=costs.invalid||plan.invalid||!!conflicts.length;
  title=`CCU-Kette → ${target.name}`;
  if(currency==='EUR')notes.push(l('Preisquelle · RSI-Shoppreis, sonst EZB-Richtwert','Price source · RSI shop price, otherwise ECB estimate'));
  notes.push(input.chain.preview?l('Testvorschau; eigener Entwurf bleibt unverändert.','Test preview; your saved draft remains unchanged.'):l('Lokaler Planungsentwurf.','Local planning draft.'),l('Richtwerte werden je Schritt auf Cent gerundet.','Estimates are rounded to cents per step.'),l('Erfasste Kaufpreise benötigen eine passende Steuerbasis. In der Bruttoansicht fließen eindeutig zugeordnete RSI-Bestellpreise in ihrer ursprünglichen Höhe in den Richtwert ein.','Recorded purchase prices require a matching tax basis. In the gross view, uniquely matched RSI order prices contribute to the estimate at their original amounts.'),invalid?l('Anschlüsse oder Ressourcenkonflikte prüfen; keine gültige Kaufkette bestätigt.','Check connections or resource conflicts; no valid purchase chain confirmed.'):l('CCU-Anwendbarkeit und Kaufbarkeit ungeprüft.','CCU applicability and purchase availability unverified.'));
  col('#',5);col(l('Von','From'),27);col(l('Nach','To'),27);col(l('Status','Status'),20);col(l('Bereits bezahlt','Already paid')+' '+currency,17,'money');col(l('Noch zu kaufen','Still to buy')+' '+priceHeader,19,'money');col(l('Zusatz USD netto','Additional USD net'),17,'money');col(l('Bezahlt Original USD','Paid original USD'),18,'money');col(l('Hinweis','Note'),27);
  const paidBase=paidBaseCost(base,pledges,display,observation,input.packageShares);
  if(!filtered)rows.push({tone:'owned',cells:[0,l('Startbasis','Start base'),base.model.name,l('Im Bestand','Owned'),paidBase.minor===null?null:paidBase.minor/100,0,0,paidBase.usdMinor===null?null:paidBase.usdMinor/100,paidBase.packageShare?l('Paketanteil · Eigene Angabe','Package share · User allocation'):base.pledgeName]});
  plan.steps.forEach((s,i)=>{const paid=paidCcuCost(s,pledges,display,observation),additional=additionalCost(s,display,current,priceFor),bad=s.kind==='conflict'||s.kind==='missing'||s.validity==='invalid';
   if(!matches(bad?'warning':s.kind))return;
   const note=bad?l('Ungültig / fehlt','Invalid / missing'):s.kind==='owned'?l('Anwendbarkeit ungeprüft','Applicability unverified'):
     additional.minor===null?open:!additional.approximate?l('RSI-Shoppreis','RSI shop price'):
       currency==='EUR'?l('EZB-Richtwert','ECB estimate'):l('Richtwert','Estimate');
   rows.push({tone:bad?'warning':s.kind==='owned'?'owned':'purchase',cells:[i+1,s.from.name,s.to.name,s.kind==='owned'?l('Im Bestand','Owned'):bad?l('Anschluss prüfen','Check connection'):l('Noch kaufen','Still to buy'),s.kind==='owned'&&paid.minor!==null?paid.minor/100:null,additional.minor===null?null:additional.minor/100,additional.usdMinor===null?null:additional.usdMinor/100,paid.usdMinor===null?null:paid.usdMinor/100,note]});});
  if(filtered)notes.push(l('Startbasis','Start base')+' · '+base.model.name,l('Der Export enthält die ausgewählten Schritte. Gesamtkosten stehen in der vollständigen Kette.','The export contains the selected steps. Total costs are shown in the full chain.'));
  else {
   for(const [label,v]of [[l('Bereits bezahlt','Already paid'),costs.paid],[l('Noch zu kaufen','Still to buy'),costs.additional]]as const)totals.push({label,value:`${v.approximate?'≈ ':''}${money(v.knownMinor)}${v.missing?` + ${v.missing} ${open}`:''}`});
   totals.push({label:l('Gesamtkosten','Total cost'),value:!invalid&&costs.investment!==null?'≈ '+money(costs.investment):open});
  }
 }
 if(!rows.length){
  const empty=l('Für diesen Bereich liegen noch keine Daten vor.','No data available for this section.');
  if(!input.allowEmpty)throw new UserError(l('Für diesen Export liegen noch keine Daten vor.','No data available for this export.'));
  notes.push(empty);
 }
 if(rows.length>100_000||rows.some(r=>r.cells.some(c=>typeof c==='string'&&c.length>32_000)))throw new UserError(l('Export ist zu groß. Bitte den Umfang eingrenzen.','Export too large. Please reduce its scope.'));
 return {title,kind,profileName:snapshot.profileName,createdAt:snapshot.createdAt,language:display.settings.language,notes,columns,rows,totals};
}
