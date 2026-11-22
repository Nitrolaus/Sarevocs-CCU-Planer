import React,{useEffect,useMemo,useRef,useState} from 'react';
import type {AdvisorInput,PurchaseAdvice} from '../planner/advisor';
import type {ReservablePlan} from '../planner/reservations';
import {chainCosts} from '../planner/costs';
import {shipValuesStale} from '../market/ship-values';
import type {Pledge} from '../domain/model';
import {estimatePlanningMinor,euroRateIsStale,formatMinor} from '../pricing/money';
import {vatLabel} from './vat-label';
import {useAdvisor} from './useAdvisor';import {useText} from './i18n';
import type { FairOfferRequest } from './FairNewsPanel';
import './advisors.css';
export type AdvisorContext={input:AdvisorInput|null;signature:string;ready:boolean;pledges:readonly Pledge[]};
export function PlanningAdvisors({context,active,fairOffer}:{context:AdvisorContext;active:boolean;fairOffer?:FairOfferRequest|null}){
 const t=useText(),{input}=context,[offerKey,setOfferKey]=useState(''),[notice,setNotice]=useState('');
 useEffect(()=>setNotice(''),[active]);
 const offers=input?.offers.filter(o=>o.change!=='missing'&&o.warbond&&o.warbondMinor!==null&&o.warbondMinor<o.regularMinor)??[];
 const offer=offerKey ? offers.find(o=>o.key===offerKey) : offers[0];
 const purchase=useAdvisor<PurchaseAdvice>(context.ready?input:null,context.signature+':'+(offer?.key??''));
 const checkedFairOffer = useRef<FairOfferRequest | null>(null);
 useEffect(() => { setOfferKey(fairOffer?.offerKey ?? ''); }, [fairOffer]);
 useEffect(() => {
   if (!fairOffer || checkedFairOffer.current === fairOffer || !active
     || !context.ready || !input?.current || offer?.key !== fairOffer.offerKey || offerKey !== fairOffer.offerKey) return;
   checkedFairOffer.current = fairOffer;
   purchase.run(offer);
 }, [fairOffer, active, context.ready, context.signature, input?.current, offer?.key, offerKey]);
 if(!input||!input.targets.length)return <div className="planning-advisors" aria-label={t('Heutiger CCU-Kaufoptimierer')}><p className="advisor-empty">{t('Wähle mindestens ein Zielschiff mit geladenem Bestand.')}</p></div>;
 const display=input.display,rate=display.rate&&!euroRateIsStale(display.rate)?display.rate:null;
 function money(usd:number|null,sign=false){if(usd===null)return t('offen');const converted=estimatePlanningMinor(Math.abs(usd),display.settings,rate);return converted===null?t('Euro-Kurs fehlt'):(usd<0?'− ':sign&&usd>0?'+ ':'')+(usd===0?'':'≈ ')+formatMinor(converted,display.settings.currency,display.settings.language);}
 function cash(minor:number|null,sign=false){return minor===null?t('offen'):(minor<0?'− ':sign&&minor>0?'+ ':'')+(minor===0?'':'≈ ')+formatMinor(Math.abs(minor),display.settings.currency,display.settings.language);}
 function cost(plan:ReservablePlan|null){if(!plan)return null;const c=chainCosts(plan,context.pledges,display,input!.current||!shipValuesStale(input!.pool.values));return c.invalid||c.additional.missing?null:c.additional.knownMinor;}
 function route(plan:ReservablePlan|null){return !plan?<span>{t('Kein belegbarer Weg gefunden.')}</span>:<div className="advisor-route"><span className="owned">{t('Basis')}: {plan.base?.model.name}</span>{plan.steps.map((step,i)=><React.Fragment key={i}><span className="advisor-arrow" aria-hidden="true">⛓ ›</span><span className={step.kind==='owned'?'owned':'buy'}><small>{t(step.kind==='owned'?'Im Bestand':step.purchaseQuote?'Warbond-Einstieg · ungeprüft':'Noch kaufen')}</small>{step.from.name} → {step.to.name}</span></React.Fragment>)}</div>;}
 const pricesLabel=display.settings.taxMode==='gross'?vatLabel(display.settings.vatBasisPoints,display.settings.language):t('vor Steuer');
 const evidence=<p className="advisor-evidence">{t('Richtwerte')} · {pricesLabel} · {t('Kaufbarkeit und Anwendbarkeit ungeprüft. Gesperrte CCUs ausgeschlossen.')}</p>;
 return <div className="planning-advisors" aria-label={t('Heutiger CCU-Kaufoptimierer')}>
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
 {evidence}{notice&&<p role="status">{t(notice)}</p>}
 </div>;
}
