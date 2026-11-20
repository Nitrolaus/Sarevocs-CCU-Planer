import React,{useEffect,useMemo,useRef,useState} from 'react';
import type {AdvisorInput,PortfolioAdvice,PurchaseAdvice} from '../planner/advisor';
import {anchorFromStep,type PlannerDraft} from '../planner/draft';
import type {ReservablePlan} from '../planner/reservations';
import {analyseReservations} from '../planner/reservations';
import {chainCosts} from '../planner/costs';
import {purchasePriceReader} from '../planner/shopping-list';
import {planningRateLabel} from './planning-rate-label';
import {shipValuesStale} from '../market/ship-values';
import type {Pledge} from '../domain/model';
import {estimatePlanningMinor,euroRateIsStale,formatMinor} from '../pricing/money';
import {vatLabel} from './vat-label';
import {useAdvisor} from './useAdvisor';import {useText} from './i18n';
import type { FairOfferRequest } from './FairNewsPanel';
import './advisors.css';
export type AdvisorContext={input:AdvisorInput|null;signature:string;ready:boolean;conflicts:number;pledges:readonly Pledge[];apply:(rows:{targetId:number;draft:PlannerDraft}[])=>Promise<boolean>};
export function PlanningAdvisors({context,tab,fairOffer}:{context:AdvisorContext;tab:'conflicts'|'purchase';fairOffer?:FairOfferRequest|null}){
 const t=useText(),{input}=context,[offerKey,setOfferKey]=useState(''),[saving,setSaving]=useState(false),[notice,setNotice]=useState('');
 const priceFor=useMemo(()=>tab==='conflicts'&&input?purchasePriceReader(input.offers,input.pool.values,input.current,Date.now(),input.display.shopPrices):undefined,[tab,input?.offers,input?.pool.values,input?.current,input?.display.shopPrices]);
 useEffect(()=>setNotice(''),[tab]);
 const portfolio=useAdvisor<PortfolioAdvice>(context.ready?input:null,context.signature),offers=input?.offers.filter(o=>o.change!=='missing'&&o.warbond&&o.warbondMinor!==null&&o.warbondMinor<o.regularMinor)??[];
 const offer=offerKey ? offers.find(o=>o.key===offerKey) : offers[0];
 const purchase=useAdvisor<PurchaseAdvice>(context.ready?input:null,context.signature+':'+(offer?.key??''));
 const checkedFairOffer = useRef<FairOfferRequest | null>(null);
 useEffect(() => { setOfferKey(fairOffer?.offerKey ?? ''); }, [fairOffer]);
 useEffect(() => {
   if (!fairOffer || checkedFairOffer.current === fairOffer || tab !== 'purchase'
     || !context.ready || !input?.current || offer?.key !== fairOffer.offerKey || offerKey !== fairOffer.offerKey) return;
   checkedFairOffer.current = fairOffer;
   purchase.run(offer);
 }, [fairOffer, tab, context.ready, context.signature, input?.current, offer?.key, offerKey]);
 if(!input||!input.targets.length)return <div className="planning-advisors" aria-label={t(tab==='conflicts'?'Konfliktberater':'Heutiger CCU-Kaufoptimierer')}><p className="advisor-empty">{t('Wähle mindestens ein Zielschiff mit geladenem Bestand.')}</p></div>;
 const display=input.display,rate=display.rate&&!euroRateIsStale(display.rate)?display.rate:null;
 function money(usd:number|null,sign=false){if(usd===null)return t('offen');const converted=estimatePlanningMinor(Math.abs(usd),display.settings,rate);return converted===null?t('Euro-Kurs fehlt'):(usd<0?'− ':sign&&usd>0?'+ ':'')+(usd===0?'':'≈ ')+formatMinor(converted,display.settings.currency,display.settings.language);}
 function cash(minor:number|null,sign=false){return minor===null?t('offen'):(minor<0?'− ':sign&&minor>0?'+ ':'')+(minor===0?'':'≈ ')+formatMinor(Math.abs(minor),display.settings.currency,display.settings.language);}
 function cost(plan:ReservablePlan|null){if(!plan)return null;const c=chainCosts(plan,context.pledges,display,input!.current||!shipValuesStale(input!.pool.values),priceFor);return c.invalid||c.additional.missing?null:c.additional.knownMinor;}
 function route(plan:ReservablePlan|null){return !plan?<span>{t('Kein belegbarer Weg gefunden.')}</span>:<div className="advisor-route"><span className="owned">{t('Basis')}: {plan.base?.model.name}</span>{plan.steps.map((step,i)=><React.Fragment key={i}><span className="advisor-arrow" aria-hidden="true">⛓ ›</span><span className={step.kind==='owned'?'owned':'buy'}><small>{t(step.kind==='owned'?'Im Bestand':step.purchaseQuote?'Warbond-Einstieg · ungeprüft':'Noch kaufen')}</small>{step.from.name} → {step.to.name}</span></React.Fragment>)}</div>;}
 const status={preserved:'Eigener Entwurf bleibt vorrangig',alternative:'Konfliktfreie Alternative',limit:'Prüfgrenze erreicht; kein vollständiger Vergleich.',upstream:'Vorrangiges Ziel zuerst klären.', 'no-path':'Kein belegbarer Weg gefunden.','base-required':'Bitte zuerst selbst eine LTI-Startbasis wählen.','base-conflict':'Diese Startbasis gehört bereits zu einem vorrangigen Ziel. Bitte einen anderen LTI-Token wählen.'} as const;
 async function apply(){if(!portfolio.result?.complete||!context.ready||saving)return;setSaving(true);setNotice('');try{
  const rows=portfolio.result.rows.filter(r=>r.status!=='preserved'&&r.plan).map(r=>{const key=input!.targets.find(t=>t.target.id===r.target.id)?.baseKey;if(!key||key!==r.plan!.base.key)throw Error('START_BASE_CHANGED');return {targetId:r.target.id,draft:{mode:'manual' as const,initialized:true,baseKey:key,baseApprovedKey:key,anchors:r.plan!.steps.map(anchorFromStep)}};});
  if(!rows.length){setNotice('Die Entwürfe bleiben unverändert.');return;}
  setNotice(await context.apply(rows)?'Ersatzketten gespeichert.':'Vorschau nicht gespeichert. Bitte erneut prüfen.');
 }catch{setNotice('Vorschau nicht gespeichert. Bitte erneut prüfen.');}finally{setSaving(false);}}
 const pricesLabel=display.settings.taxMode==='gross'?vatLabel(display.settings.vatBasisPoints,display.settings.language):t('vor Steuer');
 const evidence=<p className="advisor-evidence">{tab==='conflicts'&&display.settings.currency==='EUR'?planningRateLabel(display):t('Richtwerte')} · {pricesLabel} · {t('Kaufbarkeit und Anwendbarkeit ungeprüft. Gesperrte CCUs ausgeschlossen.')}</p>;
 const currentClaims=analyseReservations(input.targets.map(r=>({slot:r.slot,targetId:r.target.id,name:r.target.name,plan:r.existing}))),collisions=currentClaims.conflicts;
 const projected=portfolio.result?.rows??[];
 function conflictCards(){return collisions.map(c=>{
   const owner=portfolio.result?projected.find(r=>r.plan&&(c.kind==='base'?r.plan.base.key===c.key:r.plan.steps.some(s=>s.kind==='owned'&&s.ccu?.key===c.key))):null;
   const assigned=portfolio.result?owner?{slot:owner.slot,name:owner.target.name,targetId:owner.target.id}:null:c.winner;
   const losers=c.owners.filter(o=>!assigned||o.targetId!==assigned.targetId);
   return <article className="advisor-collision" key={c.kind+':'+c.key}><p className="advisor-collision-name"><strong>{c.label}</strong><span className="badge">{t(c.kind==='base'?'Dieselbe Startbasis':'Dasselbe Bestands-Exemplar')}</span></p>
     <div className="advisor-explanation-grid"><div className="advisor-explanation owned"><h3>{assigned?`${assigned.slot+1} · ${assigned.name} `+t(c.kind==='base'?'verwendet diese Startbasis':'behält dieses CCU'):t('Im Vorschlag nicht benötigt')}</h3><p>{t(c.kind==='base'?'Ein Startschiff kann nicht für zwei Ziele verwendet werden.':'Ziel 1 erhält zuerst die benötigten Exemplare. Andere Ziele verwenden den freien Rest.')}</p></div>
     {losers.map(loser=>{const row=projected.find(r=>r.target.id===loser.targetId),before=cost(row?.before??input!.targets.find(r=>r.target.id===loser.targetId)?.existing??null),after=cost(row?.plan??null);return <div className="advisor-explanation buy" key={loser.targetId}><h3>{loser.slot+1} · {loser.name} · {t(c.kind==='base'?'Anderen LTI-Token wählen':'Ersatzweg')}</h3>
       {!row?<p>{t('Ketten prüfen zeigt die Alternative und ihre Mehrkosten.')}</p>:row.plan?<><p>{t('Für dieses Ziel noch zu kaufen')}:</p><ul>{row.plan.steps.filter(s=>s.kind==='purchase').map(s=><li key={s.key}>{s.from.name} → {s.to.name}</li>)}</ul>{!row.plan.gapCount&&<p>{t('Alternative nur aus freiem Bestand.')}</p>}<div className="advisor-explanation-price"><span>{t('Mehr Zukauf für')} {loser.name}</span><strong>{cash(after!==null&&before!==null?after-before:null,true)}</strong></div><details><summary>{t('Ersatzkette ansehen')} · {loser.name}</summary>{route(row.plan)}</details></>:<p>{t(status[row.status])}</p>}
     </div>;})}</div></article>;
 });}
 return <div className="planning-advisors" aria-label={t(tab==='conflicts'?'Konfliktberater':'Heutiger CCU-Kaufoptimierer')}>
 {tab==='conflicts'?<>
  <div className="advisor-tools"><strong>{t(collisions.some(c=>c.kind==='ccu')?'Ein CCU wird für mehrere Ziele gebraucht':collisions.some(c=>c.kind==='base')?'Eine Startbasis ist mehrfach gewählt':'Ketten ohne Doppelbelegung prüfen')}</strong><button disabled={!context.ready||portfolio.pending||saving} onClick={()=>{setNotice('');portfolio.run();}}>{t(portfolio.pending?'Ziele werden geprüft …':'Ketten prüfen')}</button></div>
  <div className="advisor-order">{input.targets.slice().sort((a,b)=>a.slot-b.slot).map((r,i)=><span key={r.slot}>{i>0?'→ ':''}<b>{r.slot+1}</b> · {r.target.name} · {r.baseKey?input.pool.bases.find(b=>b.key===r.baseKey)?.model.name:t('Startbasis noch wählen')}</span>)}</div>
  {!context.ready&&input.targets.some(r=>!r.baseKey)&&<p className="advisor-warn">{t('Bitte für jedes Ziel zuerst selbst eine LTI-Startbasis wählen.')}</p>}
  {conflictCards()}
  {!portfolio.result&&!collisions.length&&<p className="advisor-empty">{t('Ziel 1 erhält zuerst die benötigten Exemplare. Andere Ziele verwenden den freien Rest.')}</p>}
  {portfolio.result&&<><details className="advisor-all-prices"><summary>{t('Alle Ziele im Preisvergleich')}</summary><div className="advisor-table"><table><thead><tr><th>{t('Ziel / Ergebnis')}</th><th>{t('Bisheriger Zukauf')}</th><th>{t('Konfliktfreie Alternative')}</th><th>{t('Mehrkosten')}</th></tr></thead><tbody>{portfolio.result.rows.map(row=>{const before=cost(row.before),after=cost(row.plan);return <tr key={row.slot}><td><b>{row.slot+1} · {row.target.name}</b><small>{t(status[row.status])}{row.plan?' · '+row.plan.ownedCount+' '+t('Bestand')+' · '+row.plan.gapCount+' '+t('Lücken'):''}</small><details><summary>{t('Kette und Konfliktgrund')}</summary>{row.conflicts.map(c=><p key={c.kind+':'+c.key}>{c.label} — {t('Vorrang')}: {c.winner.name}</p>)}{route(row.plan)}{!!row.search?.unknownModels&&<p>{row.search.unknownModels} {t('Modelle ohne Preis; kein vollständiger Preisvergleich.')}</p>}</details></td><td>{cash(before)}</td><td className="advisor-good">{cash(after)}</td><td className={after!==null&&before!==null&&after>before?'advisor-warn':''}>{cash(after!==null&&before!==null?after-before:null,true)}</td></tr>;})}</tbody></table></div></details>
   {!portfolio.result.complete&&<p role="status" className="advisor-warn">{t('Keine vollständige konfliktfreie Vorschau. Bestehende Entwürfe bleiben erhalten.')}</p>}
   <div className="advisor-footer"><small>{t('Kein eigener Schiffsrumpf wird automatisch als Basis eingesetzt. Deine Entwürfe ändern sich erst durch Übernehmen.')}</small><button className="primary" disabled={!portfolio.result.complete||saving||!context.ready} onClick={()=>void apply()}>{t(saving?'Wird gespeichert …':'Ersatzketten übernehmen')}</button></div>
  </>}
  {portfolio.error&&<p role="alert">{t('Beraterprüfung fehlgeschlagen. Entwürfe bleiben erhalten.')}</p>}
 </>:<>
  {!context.ready&&input.targets.some(r=>!r.baseKey)&&<p className="advisor-warn">{t('Bitte für jedes Ziel zuerst selbst eine LTI-Startbasis wählen.')}</p>}
  <div className="advisor-tools"><strong>{t('Heutiger CCU-Kaufoptimierer')}</strong><select aria-label={t('Warbond-Ziel für Kaufoptimierer')} value={offer?.key??''} onChange={e=>{setOfferKey(e.target.value);setNotice('');}}><option value="" disabled>{t('Kein aktuelles Warbond-Ziel')}</option>{offers.map(o=><option key={o.key} value={o.key}>{o.targetName} · Warbond</option>)}</select><button disabled={!offer||!context.ready||purchase.pending} onClick={()=>purchase.run(offer)}>{t(purchase.pending?'Einstiege werden geprüft …':'Einstiege prüfen')}</button></div>
  {!purchase.result&&<p className="advisor-empty">{t('Vergleicht alle Schiffe der nächstniedrigeren Preisstufe mit dem freien Bestand und dem gesamten Zukauf bis zum Ziel. Kein Einkauf wird ausgeführt.')}</p>}
  {!context.ready&&fairOffer&&<p role="status">{t('Wähle zuerst eine LTI-Startbasis für deine Ziele.')}</p>}
  {purchase.result&&<>
   <p className="advisor-meta">{purchase.result.rows.length} {t('Einstiegsschiffe geprüft')} · {t('Preisstufe')}: {money(purchase.result.tierUsd)} · {t('Datenstand')}: {purchase.result.sourceAt?new Date(purchase.result.sourceAt).toLocaleString(display.settings.language==='de'?'de-DE':'en-US',{timeZone:'Europe/Berlin'}):'—'}</p>
   {!!purchase.result.rows.length&&<div className="advisor-table"><table><thead><tr><th>{t('Ausgangsschiff')} → {offer?.targetName}</th><th>{t('CCU-Richtwert')}</th><th>{t('Ziel / Anschluss')}</th><th>{t('Noch nötiger Zukauf')}</th><th>{t('Vorteil')}</th></tr></thead><tbody>{purchase.result.rows.map(row=><tr key={row.candidate.ship.id}><td><b>{row.candidate.ship.name}</b><details><summary>{t('Anschluss und Vergleich')}</summary>{row.paths.map(path=><div key={path.slot}><p><b>{path.slot+1} · {path.target.name}</b> · {t('Ohne Neukauf')}: {cash(cost(path.withoutPlan))} · {t('Mit Einstieg')}: {cash(cost(path.plan))}{path.reservedFor.length?' · '+t('Vorrang')+': '+path.reservedFor.join(', '):''}</p>{path.reason!=='none'&&<p className="advisor-warn">{t(path.reason==='limit'?'Prüfgrenze erreicht; kein vollständiger Vergleich.':path.reason==='priority'?'Vorrangiges Ziel zuerst klären.':'Kein belegbarer Weg gefunden.')}</p>}{route(path.plan)}</div>)}</details></td><td>{money(row.candidate.usdMinor)}<small>{formatMinor(row.candidate.usdMinor,'USD',display.settings.language)} · USD {t('vor Steuer')}</small></td><td>{row.best?.target.name??'—'}<small>{t({useful:'Günstigerer Weg im bekannten Suchraum',equal:'Gleichwertig',covered:'Bereits abgedeckt',unhelpful:'Kein Vorteil belegt',unproven:'Nicht bestätigt'}[row.status])}</small></td><td className={row.status==='useful'?'advisor-good':''}>{cash(cost(row.best?.plan??null))}</td><td className={row.status==='useful'?'advisor-good':'advisor-warn'}>{cash(row.best&&cost(row.best.withoutPlan)!==null&&cost(row.best.plan)!==null?cost(row.best.withoutPlan)!-cost(row.best.plan)!:null)}</td></tr>)}</tbody></table></div>}
   {purchase.result.reason!=='none'&&<p role="status" className="advisor-warn">{t(purchase.result.reason==='stale'?'Angebote oder Schiffswerte veraltet. Bitte öffentliche Daten aktualisieren.':purchase.result.reason==='identity'?'Angebot und RSI-Schiffswerte nicht eindeutig zugeordnet.':purchase.result.reason==='limit'?'Prüfgrenze erreicht; kein vollständiger Vergleich.':'Kein belegbarer Warbond-Vergleich möglich.')}</p>}
  </>}
  {purchase.error&&<p role="alert">{t('Beraterprüfung fehlgeschlagen. Entwürfe bleiben erhalten.')}</p>}
  <div className="advisor-footer"><small>{t('Zukauf inklusive Einstieg. Vorteil gegenüber dem besten bekannten Weg ohne diesen Neukauf. Gleiche Ergebnisse bleiben gleichwertig; Einstiege sind Alternativen, keine gemeinsame Einkaufsliste.')}</small><button onClick={()=>void window.ccu.request({action:'market.openUpgrades'}).then(r=>{if(!r.ok)setNotice('RSI-Seite konnte nicht geöffnet werden.');}).catch(()=>setNotice('RSI-Seite konnte nicht geöffnet werden.'))}>{t('RSI-Upgrades ↗')}</button></div>
 </>}
 {evidence}{notice&&<p role="status">{t(notice)}</p>}
 </div>;
}
