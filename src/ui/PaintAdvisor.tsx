import {paintTierAdvice} from '../paints/tier-advice';
import React,{useEffect,useMemo,useState} from 'react';
import type {PricingSnapshot} from '../pricing/model';import {convertPurchaseValue} from '../pricing/inventory-values';import {formatMinor} from '../pricing/money';
import {paintAdvice,type PaintInventoryRow} from '../paints/advice';import {paintCatalogueStale,type PaintSnapshot} from '../paints/model';import {ResizableTable} from './ResizableTable';import {useText} from './i18n';
import './paint-advisor.css';
const empty:PaintSnapshot={data:null,pending:false,error:null};
export function PaintAdvisor({rows,display}:{rows:readonly PaintInventoryRow[];display:PricingSnapshot}){
 const t=useText(),[snapshot,setSnapshot]=useState<PaintSnapshot>(empty),[minute,setMinute]=useState(()=>Math.floor(Date.now()/60000));
 const receive=(value:unknown)=>{const data=value as PaintSnapshot;setSnapshot(before=>JSON.stringify(before)===JSON.stringify(data)?before:data);};
 const refresh=async()=>{try{const r=await window.ccu.request({action:'paints.refresh'});if(r.ok)receive(r.data);else setSnapshot(s=>({...s,error:t('Paint-Preise konnten nicht gelesen werden.')}));}catch{setSnapshot(s=>({...s,error:t('Paint-Preise konnten nicht gelesen werden.')}));}};
 useEffect(()=>{let active=true,timer:ReturnType<typeof setTimeout>,first=true;const poll=async()=>{try{
  const result=await window.ccu.request({action:'paints.status'});if(active&&result.ok){const value=result.data as PaintSnapshot;receive(value);if(first&&paintCatalogueStale(value.data)&&!value.pending){first=false;const started=await window.ccu.request({action:'paints.refresh'});if(active&&started.ok)receive(started.data);}}
 }catch{if(active)setSnapshot(s=>({...s,error:'Paint-Preise konnten nicht gelesen werden.'}));}finally{first=false;if(active){setMinute(Math.floor(Date.now()/60000));timer=setTimeout(()=>void poll(),1500);}}};void poll();return()=>{active=false;clearTimeout(timer);};},[]);
 const [hideExcluded,setHideExcluded]=useState(()=>{try{return localStorage.getItem('ccu.paint-hide-excluded.v1')==='true';}catch{return false;}});
 useEffect(()=>{try{localStorage.setItem('ccu.paint-hide-excluded.v1',String(hideExcluded));}catch{/* Display-only preference; unavailable storage does not affect calculations. */}},[hideExcluded]);
 const advice=useMemo(()=>paintAdvice(rows,snapshot.data),[rows,snapshot.data,minute]);
 const cash=(value:number|null,approximate=false,inline=false)=>{
  if(value===null)return <span>—</span>;
  const converted=convertPurchaseValue({minor:value,currency:'USD',taxBasis:'net',evidence:'Paint-Vergleich'},display),convertedValue=converted.minor;
  const amount=(approximate||converted.approximate?'≈ ':'')+formatMinor(convertedValue??value,convertedValue===null?'USD':display.settings.currency,display.settings.language),original=convertedValue!==null&&display.settings.currency==='EUR'?formatMinor(value,'USD',display.settings.language)+' · '+t('vor Steuer'):t('USD · vor Steuer');
  return inline?<small className="paint-replacement-price" title={amount+' · '+original}>{amount}{display.settings.currency==='EUR'?' · '+formatMinor(value,'USD',display.settings.language):''}</small>:<><strong title={amount}>{amount}</strong><small title={original}>{original}</small></>;
 };
 const tier=useMemo(()=>paintTierAdvice(advice,snapshot.data,rows),[advice,snapshot.data,rows,minute]);
 const visibleRows=hideExcluded?advice.rows.filter(r=>r.state!=='excluded'&&r.state!=='no-benefit'):advice.rows;
 const step=tier.next;
 const sourceAt=snapshot.data?new Intl.DateTimeFormat(display.settings.language==='de'?'de-DE':'en-GB',{dateStyle:'short',timeStyle:'short',timeZone:'Europe/Berlin'}).format(new Date(snapshot.data.fetchedAt)):null;
 const labels=['Vorhandener Paint-Pledge','Schutz','RSI-Wert','Neu kaufen (identisch)','Freie Store Credits','Status'];
 return <>
  <header><div><div className="eyebrow">{t('LACKIERUNGEN & STORE CREDITS')}</div><h1>{t('Paint-Berater')}</h1><p>{t('Nur reine Paint-Pledges prüfen; Farben aus Schiffspaketen bleiben ausgeschlossen.')}</p></div></header>
  <div className="stats"><div className="stat"><label>{t('Reine Paint-Pledges mit Preisvorteil')}</label><strong>{advice.ready}</strong><small>{t('Vorprüfung · Reclaim und Warenkorb bei RSI bestätigen')}</small></div><div className="stat"><label>{t('Noch zu prüfen')}</label><strong>{advice.unverified}</strong><small>{t('Fehlender Beleg oder Frist noch offen')}</small></div><div className="stat"><label>{t('Ausgeschlossene Pledges')}</label><strong>{advice.excluded}</strong><small>{t('Auch Pakete mit Paint-Beigaben; keine Zahl einzelner Farben')}</small></div></div>
  <section className="panel paint-forecast" aria-label={t('Möglicher Paint-Tausch')}><div className="paint-forecast-money"><div className="eyebrow">{t("MÖGLICHER PAINT-TAUSCH · VORPRÜFUNG")}</div><div className="paint-forecast-values"><span>{t("RSI-Einschmelzbasis")}{cash(advice.totalOldMinor)}</span><span>{t("Identisch neu kaufen")}{cash(advice.totalReplacementMinor,advice.approximate)}</span><span className="paint-forecast-free">{t("Danach freie Store Credits")}{cash(advice.totalFreeMinor,advice.approximate)}</span></div></div>
   <div className="paint-tier" aria-label={t('Rabattstufen')}><b>{t("Rabattstufen")}</b>{tier.state==='higher'&&<small>{t('Aktuell')} {tier.currentPercent} % · {tier.distinctPositions} {t('unterschiedliche Shop-Positionen')}</small>}
    {tier.state==='maximum'?<><strong>{t('Höchste Stufe erreicht')}: {tier.maximumPercent} %</strong><small>{t("Keine weiteren Farben für den Mengenrabatt nötig.")}</small></>:step?<><strong>{step.missing===0?t('Stufe bereits erreichbar'):t('Noch')+' '+step.missing+' '+t('geeignete Shop-Positionen')} → {step.percent} %</strong>{tier.maximum&&tier.maximum.percent!==step.percent&&<small>{t('Zur höchsten Stufe')} ({tier.maximum.percent} %): {tier.maximum.missing} {t('zusätzliche Positionen.')}</small>}
     {step.complete?<><small title={step.extra.map(p=>p.title).join('\n')}>{t('Zusatzkäufe')}: {formatMinor(step.extraCostMinor!,'USD',display.settings.language)}</small><span className={step.changeMinor!>0?'paint-change-positive':'paint-change-negative'}>{formatMinor(Math.abs(step.changeMinor!),'USD',display.settings.language)} {step.changeMinor!>0?t('mehr'):step.changeMinor!<0?t('weniger'):t('zusätzliche')} {t('freie Store Credits')}</span><small>{t("Zusatzkosten sind gegengerechnet · bekannte Variante.")}</small></>:<small>{t("Zusatzkosten nicht vollständig belegt.")}</small>}
    </>:<small>{t(tier.state==='no-rules'?'Keine passende Rabattstaffel belegt.':'Zuerst eine berechenbare Tauschvorschau laden.')}</small>}
   </div></section>
  <section className="panel paint-advisor"><div className="panel-head"><h2>{t('Deine Paints im Vergleich')}</h2><div className="paint-tools"><label className="paint-hide-excluded"><input type="checkbox" checked={hideExcluded} onChange={e=>setHideExcluded(e.currentTarget.checked)}/>{t("Ausgeschlossene ausblenden")}</label><button className="secondary" disabled={snapshot.pending} onClick={()=>void refresh()}>{snapshot.pending&&<span className="paint-refresh-spinner" aria-hidden="true"/>}{t(snapshot.pending?'Preise werden geprüft …':'Preise prüfen')}</button></div></div>
   {snapshot.error&&<p className="paint-source-note" role="status">{t(snapshot.error)}</p>}
   <ResizableTable className="inventory-table ship-value-table paint-advisor-table" storageKey="paints" label={t('Paint-Vergleich')} columns={labels.map((label,i)=>({label:t(label),min:[140,100,90,120,110,110][i]!,preferred:[240,200,120,240,140,150][i]!,autoLimit:920}))}><tbody>
    {visibleRows.map(row=><tr key={row.pledgeId} data-pledge={row.pledgeId} data-paint-state={row.state} data-paint-protected={row.protection||undefined}><td title={row.name}>{row.name}<small>{row.paintCount} {t('Paints im Pledge')}</small></td>
     <td title={t(row.protection==='ship-package'?'Im Schiffspaket – geschützt':row.protection?'Weitere Inhalte – geschützt':'Reiner Paint-Pledge')+(row.protection?'\n'+t('Vom Planer ausgeschlossen: Ein Reclaim würde den gesamten Pledge mit allen Inhalten betreffen. Kein entsperrbarer Schalter.'):'')}>
      {row.protection?<span className="paint-protected"><svg viewBox="0 0 20 22" width="14" height="16" role="img" aria-label={t('Geschützt')}><path d="M5 9V6a5 5 0 0 1 10 0v3" fill="none" stroke="currentColor" strokeWidth="2.4"/><rect x="2" y="9" width="16" height="12" rx="2" fill="currentColor"/><path d="M10 13v4" stroke="#17222c" strokeWidth="2"/></svg><span>{t(row.protection==='ship-package'?'Im Schiffspaket – geschützt':'Weitere Inhalte – geschützt')}</span></span>:t('Reiner Paint-Pledge')}
     </td>
     <td className="ship-price" title={t('RSI-Pledgewert als Vorprüfbasis, keine persönliche Kaufquittung. Vor Reclaim den Betrag bei RSI prüfen.')}>{cash(row.oldMinor)}</td>
     <td className="ship-price" tabIndex={row.replacement.length?0:undefined} title={row.replacement.join('\n')}><span className="paint-replacement">{row.replacement.length?row.replacement.join(' + '):t('Kein Ersatz vorgesehen')}</span>{row.replacementMinor===null?<small>{t('Preis offen')}</small>:cash(row.replacementMinor,row.approximate,true)}</td>
     <td className="ship-price paint-credit">{cash(row.freeMinor,row.approximate)}</td>
     <td title={t(row.reason)}><span className={'badge '+(row.state==='ready'?'': 'unknown')}>{t(row.state==='ready'?'Vorprüfung':row.state==='excluded'?'Ausgeschlossen':row.state==='no-benefit'?'Kein Vorteil':'Noch zu prüfen')}</span><small className="paint-reason">{t(row.reason)}</small></td>
    </tr>)}
    {!visibleRows.length&&<tr><td colSpan={6} className="empty">{t(advice.rows.length&&hideExcluded?'Alle Paint-Einträge sind durch den Anzeigefilter ausgeblendet.':rows.length?'Keine Paint-Inhalte im gespeicherten Bestand erkannt.':'Zuerst einen Bestand einlesen.')}</td></tr>}
   </tbody></ResizableTable>
   <details className="paint-calculation"><summary>{t('Berechnung & Bedingungen')}</summary><p>{t('Belegter Einschmelzwert minus vollständiger Ersatzpreis ergibt frei werdende Store Credits. Fehlende Belege bleiben offen. Keine automatische Kaufempfehlung.')}</p>

    {snapshot.data&&<p>{t('Mengenrabatt laut Quelle')}: {snapshot.data.rules.filter(r=>r.percent>0&&r.amountOff===null&&r.maximum===null).map(r=>`${r.from}${r.to===null?'+':r.to!==r.from?'–'+r.to:''}: ${r.percent} %`).join(' · ')}</p>}
    {advice.rows.filter(row=>row.replacement.length>0).map(row=><p key={row.pledgeId}><b>{row.name}:</b> {row.replacement.join(' · ')}</p>)}
    <p>{t('Paket- und Mengenrabatte werden nicht ungeprüft gestapelt. Nur bekannte Varianten werden verglichen; ein weltweites Optimum wird nicht behauptet.')}</p>
    <p>{t('Einzelkauf-Varianten enthalten getrennte Käufe; der Preis im gemeinsamen Warenkorb kann abweichen.')}</p>
    <p>{t('Doppelte Farben bleiben als doppelte Exemplare erhalten. Schiffspakete, Spielzugänge, weitere Paketbeigaben und ungeklärte Reclaims sind ausgeschlossen.')}</p>
    <p>{t('Store Credits werden in USD berechnet. Euro ist ein Richtwert vor Steuer; Guthabenkäufe werden nicht erneut besteuert.')}</p>
   </details>
   <p className="paint-source-note">{t('Quelle')}: RSI · {sourceAt??t('Noch nicht gelesen')}{snapshot.data&&paintCatalogueStale(snapshot.data)?' · '+t('Letzter gültiger Stand; Aktualisierung erforderlich.') :''} · {t('Keine Kauf- oder Einschmelzaktionen im Planer.')}</p>
  </section>
 </>;
}
