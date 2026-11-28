import React,{useContext,useEffect,useMemo,useRef,useState} from 'react';
import type {Command} from '../main/commands';
import {fleetFile,fleetJson,type FleetPreview,type FleetShip} from '../export/fleetyards';
import {fleetDraftOptions,emptyPrice,emptyDate,emptyShipDraft,type PriceDraft,type DateDraft,type ShipDraft} from './fleetyards-options';
import {LanguageContext} from './i18n';
import './fleetyards.css';

async function request<T>(command:Command):Promise<T>{const result=await window.ccu.request(command);if(!result.ok)throw Error(result.error);return result.data as T;}
const normalize=(v:string)=>v.normalize('NFD').replace(/\p{M}/gu,'').toLocaleLowerCase('en').trim();
type Localize=(de:string,en:string)=>string;

function PriceControl({value,onChange,disabled,individual,l}:{value:PriceDraft;onChange:(v:PriceDraft)=>void;disabled:boolean;individual:boolean;l:Localize}){
 const scope=l(individual?'Schiff: Preis':'Alle Schiffe: Preis',individual?'Ship: price':'All ships: price');
 return <div className="fy-policy"><label><span>{l('Preis','Price')}</span><select aria-label={scope} disabled={disabled} value={value.mode} onChange={e=>onChange({...value,mode:e.target.value as PriceDraft['mode']})}>
  {individual&&<option value="inherit">{l('Wie Vorgabe','Use default')}</option>}
  <option value="hidden">{l('Leer lassen','Leave empty')}</option><option value="known">{l('Bekannten Gesamtpreis verwenden','Use known total price')}</option><option value="custom">{l('Eigenen Ersatzwert verwenden','Use a replacement value')}</option>
 </select></label>{value.mode==='custom'&&<div className="fy-custom-value"><input type="text" inputMode="decimal" autoComplete="off" aria-label={scope+' · '+l('Ersatzwert','Replacement')} disabled={disabled} placeholder="0,00" value={value.amount} onChange={e=>onChange({...value,amount:e.target.value})}/>
 <select aria-label={scope+' · '+l('Währung','Currency')} disabled={disabled} value={value.currency} onChange={e=>onChange({...value,currency:e.target.value as PriceDraft['currency']})}>{['USD','EUR','GBP'].map(currency=><option key={currency}>{currency}</option>)}</select></div>}</div>;
}
function DateControl({value,onChange,disabled,individual,l}:{value:DateDraft;onChange:(v:DateDraft)=>void;disabled:boolean;individual:boolean;l:Localize}){
 const scope=l(individual?'Schiff: Datum':'Alle Schiffe: Datum',individual?'Ship: date':'All ships: date');
 return <div className="fy-policy"><label><span>{l('Datum','Date')}</span><select aria-label={scope} title={l('Bekanntes Datum: belegtes Kaufdatum, sonst das RSI-Hangardatum „Erhalten am“.','Known date: documented purchase date, otherwise the RSI hangar “received on” date.')} disabled={disabled} value={value.mode} onChange={e=>onChange({...value,mode:e.target.value as DateDraft['mode']})}>
  {individual&&<option value="inherit">{l('Wie Vorgabe','Use default')}</option>}
  <option value="hidden">{l('Leer lassen','Leave empty')}</option><option value="known">{l('Bekanntes Datum verwenden','Use known date')}</option><option value="custom">{l('Eigenes Datum verwenden','Use a replacement date')}</option>
 </select></label>{value.mode==='custom'&&<input type="date" min="1900-01-01" max="2100-12-31" aria-label={scope+' · '+l('Ersatzdatum','Replacement')} disabled={disabled} value={value.value} onChange={e=>onChange({...value,value:e.target.value})}/>}</div>;
}

export function FleetYardsExport({accountId,onClose,onSaved,onBusy}:{accountId:string;onClose:()=>void;onSaved:()=>void;onBusy:(busy:boolean)=>void}){
 const language=useContext(LanguageContext),l:Localize=(de,en)=>language==='en'?en:de;
 const [preview,setPreview]=useState<FleetPreview|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false);
 const [selected,setSelected]=useState<Set<string>>(()=>new Set()),[query,setQuery]=useState(''),[manufacturer,setManufacturer]=useState('');
 const [view,setView]=useState<'all'|'selected'|'hidden'>('all'),[page,setPage]=useState(0),[size,setSize]=useState(25),[jsonOpen,setJsonOpen]=useState(false);
 const [price,setPrice]=useState<PriceDraft>(()=>emptyPrice('hidden')),[date,setDate]=useState<DateDraft>(()=>emptyDate('hidden'));
 const [details,setDetails]=useState({includeLti:false,includeWarbond:false,includePackageNames:false});
 const [edits,setEdits]=useState<Map<string,ShipDraft>>(()=>new Map()),[editing,setEditing]=useState<string|null>(null);
 const generation=useRef(0),pending=useRef(false),scroll=useRef<HTMLDivElement>(null),pageCheck=useRef<HTMLInputElement>(null);
 useEffect(()=>{const epoch=++generation.current;setLoading(true);setError('');setPreview(null);setSelected(new Set());setEdits(new Map());setEditing(null);
  setPrice(emptyPrice('hidden'));setDate(emptyDate('hidden'));setDetails({includeLti:false,includeWarbond:false,includePackageNames:false});
  void request<FleetPreview>({action:'fleetyards.preview',accountId}).then(data=>{if(generation.current===epoch)setPreview(data)}).catch(e=>{if(generation.current===epoch)setError(e.message)}).finally(()=>{if(generation.current===epoch)setLoading(false)});
  return()=>{generation.current++;};
 },[accountId]);
 useEffect(()=>{onBusy(saving);return()=>onBusy(false)},[saving,onBusy]);
 const ships=preview?.ships??[];
 const manufacturers=useMemo(()=>[...new Set(ships.flatMap(s=>s.manufacturer?[s.manufacturer]:[]))].sort((a,b)=>a.localeCompare(b,language)),[ships,language]);
 const copies=useMemo(()=>{const totals=new Map<string,number>(),seen=new Map<string,number>();for(const s of ships)totals.set(s.name,(totals.get(s.name)??0)+1);return new Map(ships.map(s=>{const n=(seen.get(s.name)??0)+1;seen.set(s.name,n);return[s.key,(totals.get(s.name)??0)>1?n:0]}))},[ships]);
 const hits=useMemo(()=>ships.filter(s=>(!manufacturer||s.manufacturer===manufacturer)&&(!query||normalize([s.name,s.manufacturer].join(' ')).includes(normalize(query)))&&(view==='all'||selected.has(s.key)===(view==='selected'))),[ships,manufacturer,query,view,selected]);
 const pages=Math.max(1,Math.ceil(hits.length/size)),index=Math.min(page,pages-1),visible=hits.slice(index*size,(index+1)*size);
 const prepared=useMemo(()=>fleetDraftOptions(price,date,edits,details),[price,date,edits,details]);
 const options=prepared.ok?prepared.options:null;
 const file=useMemo(()=>options&&selected.size?fleetFile(ships,[...selected],options):[],[ships,selected,options]);
 const fileByKey=useMemo(()=>new Map(ships.filter(s=>selected.has(s.key)).map((s,i)=>[s.key,file[i]])),[ships,selected,file]);
 const eligible=visible.filter(s=>!!s.catalogueName),checked=eligible.filter(s=>selected.has(s.key)).length;
 const active=ships.find(s=>s.key===editing),draft=editing?edits.get(editing)??emptyShipDraft():null;
 const invalid=prepared.ok?'':(prepared.field==='price'?l('Bitte einen Preis mit höchstens zwei Nachkommastellen eingeben.','Enter a price with at most two decimal places.'):l('Bitte ein gültiges Datum zwischen 1900 und 2100 eingeben.','Enter a valid date between 1900 and 2100.'));
 const invalidShip=!prepared.ok&&prepared.key?ships.find(s=>s.key===prepared.key):null;
 useEffect(()=>{if(pageCheck.current)pageCheck.current.indeterminate=checked>0&&checked<eligible.length},[checked,eligible.length]);
 useEffect(()=>{if(scroll.current)scroll.current.scrollTop=0},[index,query,manufacturer,view]);
 function choose(rows:readonly FleetShip[],include:boolean){setSelected(current=>{const next=new Set(current);for(const s of rows)if(s.catalogueName){if(include)next.add(s.key);else next.delete(s.key)}return next})}
 function edit(key:string,update:Partial<ShipDraft>){setEdits(current=>{const next=new Map(current);next.set(key,{...(next.get(key)??emptyShipDraft()),...update});return next})}
 async function save(){if(pending.current||!preview||!selected.size||!options)return;pending.current=true;const epoch=generation.current;setSaving(true);setError('');
  try{const result=await request<{exported:boolean}>({action:'fleetyards.save',accountId,token:preview.token,selected:[...selected],options});if(generation.current===epoch&&result.exported){onSaved();onClose()}}
  catch(e){if(generation.current===epoch)setError(e instanceof Error?e.message:l('Export fehlgeschlagen.','Export failed.'))}
  finally{pending.current=false;if(generation.current===epoch)setSaving(false)}
 }
 if(loading)return <div className="fy-loading" role="status">{l('Vorschau wird erstellt …','Preparing preview …')}</div>;
 if(!preview)return <div className="fy-loading" role="alert">{error}</div>;
 return <>
  <div className="fy-workspace">
   <section className="fy-ships-panel" aria-labelledby="fy-ships-title">
    <div className="fy-section-title"><h3 id="fy-ships-title">{l('Schiffe & Fahrzeuge','Ships & vehicles')}</h3><span>{selected.size} {l('von','of')} {ships.length} {l('im Export','in export')}</span></div>
    <div className="fy-search-row"><label className="fy-search"><span aria-hidden="true">⌕</span><input type="search" autoComplete="off" value={query} disabled={saving} aria-label={l('Schiffe durchsuchen','Search ships')} placeholder={l('Schiff oder Hersteller suchen','Search ship or manufacturer')} onChange={e=>{setQuery(e.target.value);setPage(0)}}/></label>
     <select value={manufacturer} disabled={saving} aria-label={l('Nach Hersteller filtern','Filter by manufacturer')} onChange={e=>{setManufacturer(e.target.value);setPage(0)}}><option value="">{l('Alle Hersteller','All manufacturers')}</option>{manufacturers.map(name=><option key={name}>{name}</option>)}</select></div>
    <div className="fy-toolbar"><div className="fy-view-tabs" role="group" aria-label={l('Auswahl anzeigen','Show selection')}>{(['all','selected','hidden'] as const).map((mode,i)=><button key={mode} disabled={saving} aria-pressed={view===mode} onClick={()=>{setView(mode);setPage(0)}}>{[l('Alle','All'),l('Im Export','Included'),l('Ausgeblendet','Hidden')][i]} <span>{[ships.length,selected.size,ships.length-selected.size][i]}</span></button>)}</div><span role="status">{hits.length} {l('Treffer','matches')}</span></div>
    <div className="fy-bulk"><button disabled={saving||!hits.some(s=>s.catalogueName&&!selected.has(s.key))} onClick={()=>choose(hits,true)}>{l('Treffer übernehmen','Include matches')}</button><button className="fy-text-button" disabled={saving||!hits.some(s=>selected.has(s.key))} onClick={()=>choose(hits,false)}>{l('Treffer ausblenden','Hide matches')}</button><span>{l('Gilt für alle gefilterten Treffer','Applies to all filtered matches')}</span></div>
    <div className="fy-table-scroll" ref={scroll} tabIndex={0} aria-label={l('Schiffstabelle','Ship table')}>
     <table><colgroup><col style={{width:38}}/><col/><col style={{width:120}}/><col style={{width:110}}/><col style={{width:110}}/></colgroup><thead><tr><th className="fy-check-col"><input ref={pageCheck} type="checkbox" checked={!!eligible.length&&checked===eligible.length} disabled={saving||!eligible.length} aria-label={l('Schiffe dieser Seite auswählen','Select this page')} onChange={e=>choose(visible,e.target.checked)}/></th><th>{l('Schiff / Fahrzeug','Ship / vehicle')}</th><th>{l('Hersteller','Manufacturer')}</th><th>{l('Exportpreis','Export price')}</th><th>{l('Exportdatum','Export date')}</th></tr></thead>
      <tbody>{visible.map(s=>{const row=fileByKey.get(s.key),included=selected.has(s.key),override=edits.get(s.key);return <tr key={s.key} className={(included?'fy-selected ':'')+(editing===s.key?'fy-editing':'')}>
       <td className="fy-check-col"><input type="checkbox" checked={included} disabled={saving||!s.catalogueName} aria-label={`${s.name}${copies.get(s.key)?`, ${l('Exemplar','Copy')} ${copies.get(s.key)}`:''} ${l('in Export aufnehmen','include in export')}`} onChange={e=>choose([s],e.target.checked)}/></td>
       <th scope="row">{s.name}{!!copies.get(s.key)&&<small>{l('Exemplar','Copy')} {copies.get(s.key)}</small>}</th><td className="fy-maker">{s.manufacturer??l('Zuordnung offen','Match pending')}</td>
       {(['price','date'] as const).map(kind=><td key={kind} className={'fy-export-value'+(override?.[kind]?.mode&&override[kind]!.mode!=='inherit'?' fy-overridden':'')}><button type="button" disabled={saving||!s.catalogueName} aria-pressed={editing===s.key} aria-label={s.name+' · '+l(kind==='price'?'Exportpreis bearbeiten':'Exportdatum bearbeiten',kind==='price'?'Edit export price':'Edit export date')}
        title={l('Nur die Exportangaben dieses Schiffes bearbeiten.','Edit this ship’s export values only.')} onClick={()=>setEditing(s.key)}>{!s.catalogueName?l('Offen','Pending'):!included?'—':!options?l('Prüfen','Check'):kind==='price'?row?.cost||l('Leer','Empty'):row?.pledge_date?new Intl.DateTimeFormat(language==='en'?'en-GB':'de-DE',{timeZone:'UTC',day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date(row.pledge_date+' UTC')):l('Leer','Empty')}</button></td>)}
      </tr>})}</tbody></table>
     {!hits.length&&<p className="fy-empty">{l('Keine passenden Schiffe. Ändere deine Suche oder den Herstellerfilter.','No matching ships. Change your search or manufacturer filter.')}</p>}
    </div>
    <div className="fy-pagination"><span>{hits.length?`${index*size+1}–${Math.min((index+1)*size,hits.length)}`:'0'} {l('von','of')} {hits.length}</span><div><label>{l('Zeilen','Rows')} <select value={size} disabled={saving} aria-label={l('Zeilen je Seite','Rows per page')} onChange={e=>{setSize(Number(e.target.value));setPage(0)}}>{[25,50,100].map(n=><option key={n}>{n}</option>)}</select></label><button disabled={saving||index===0} aria-label={l('Vorherige Seite','Previous page')} onClick={()=>setPage(index-1)}>‹</button><span>{index+1} / {pages}</span><button disabled={saving||index+1>=pages} aria-label={l('Nächste Seite','Next page')} onClick={()=>setPage(index+1)}>›</button></div></div>
    <p className="fy-edit-hint">{l('Preis oder Datum anklicken, um die Angaben für ein einzelnes Schiff zu ändern.','Click a price or date to change the values for one ship.')}</p>
    <p className="fy-resolution">{l('Nur die Exportkopie ändert sich. Dein Bestand und deine Kaufpreise bleiben erhalten.','Only the export copy changes. Your inventory and purchase prices stay unchanged.')}</p>
    {ships.some(s=>!s.catalogueName)&&<p className="fy-resolution">{ships.filter(s=>!s.catalogueName).length} {l('Modelle noch nicht zugeordnet. Sie bleiben außerhalb des Exports.','models are not matched yet and stay out of the export.')}</p>}
   </section>
   <aside className="fy-file-panel" aria-labelledby="fy-file-title">
    <div className="fy-section-title"><h3 id="fy-file-title">{l('Das gibst du weiter','What you share')}</h3><span className="fy-private">{l('Nur Exportkopie','Export copy only')}</span></div>
    <div className="fy-file-summary"><strong>{selected.size}</strong><span>{l('Schiffe · FleetYards-JSON','ships · FleetYards JSON')}</span><small>{l('Exaktes Format der Hangar-XPLOR-Vorlage','Exact Hangar XPLOR example format')}</small></div>
    <fieldset className="fy-defaults"><legend>{l('Vorgaben für alle Schiffe','Defaults for all ships')}</legend>
     <PriceControl value={price} onChange={setPrice} disabled={saving} individual={false} l={l}/><DateControl value={date} onChange={setDate} disabled={saving} individual={false} l={l}/>
     <label className="fy-disclose"><input type="checkbox" checked={details.includeLti&&details.includeWarbond} disabled={saving} onChange={e=>setDetails(current=>({...current,includeLti:e.target.checked,includeWarbond:e.target.checked}))}/>{l('LTI und Warbond angeben','Include LTI and Warbond')}</label>
     <label className="fy-disclose"><input type="checkbox" checked={details.includePackageNames} disabled={saving} onChange={e=>setDetails(current=>({...current,includePackageNames:e.target.checked}))}/>{l('Originale Paketnamen angeben','Include original package names')}</label>
    </fieldset>
    {active&&draft&&<section className="fy-editor" aria-label={l('Individuelle Exportangaben','Individual export values')}><div className="fy-editor-title"><h4>{active.name}</h4><button className="fy-text-button" disabled={saving||!edits.has(active.key)} onClick={()=>setEdits(current=>{const next=new Map(current);next.delete(active.key);return next})}>{l('Zurücksetzen','Reset')}</button></div>
     <p>{l('Individuelle Angaben · nur für diese Datei','Individual values · only for this file')}{!selected.has(active.key)&&' · '+l('Schiff ausgeblendet','Ship excluded')}</p>
     <PriceControl value={draft.price} onChange={value=>edit(active.key,{price:value})} disabled={saving} individual l={l}/><DateControl value={draft.date} onChange={value=>edit(active.key,{date:value})} disabled={saving} individual l={l}/>
     {(draft.price.mode==='known'||draft.price.mode==='inherit'&&price.mode==='known')&&!active.knownPrice&&<p>{l('Kein vollständiger Einzelpreis belegt. Das Preisfeld bleibt leer.','No complete individual price is documented. The price field stays empty.')}</p>}
     {(draft.date.mode==='known'||draft.date.mode==='inherit'&&date.mode==='known')&&active.dateKind==='hangar'&&<p>{l('Vorhanden ist das RSI-Erhalten-Datum, kein belegtes persönliches Kaufdatum.','The known date is the RSI received date, not a documented personal purchase date.')}</p>}
    </section>}
    {!active&&<p className="fy-edit-hint">{l('Für einzelne Abweichungen links auf Preis oder Datum klicken.','Click a price or date on the left for individual changes.')}</p>}
    {invalid&&<p className="fy-input-error" role="alert">{invalidShip?invalidShip.name+': ':''}{invalid}</p>}
    <div className="fy-file-details"><button aria-expanded={jsonOpen} onClick={()=>setJsonOpen(!jsonOpen)}>{l('< / >  Dateivorschau','< / >  File preview')} <span>⌄</span></button>{jsonOpen&&(options?<pre tabIndex={0} aria-label={l('Inhalt der FleetYards-Datei','FleetYards file contents')}>{fleetJson(file)}</pre>:<p>{l('Bitte zuerst die Eingaben prüfen.','Check the input values first.')}</p>)}</div>
    <p className="fy-privacy-note">{l('Echte RSI-IDs, Bestellnummern und Kontodaten bleiben draußen. Die Sichtbarkeit nach dem Import stellst du bei FleetYards ein.','Real RSI IDs, order numbers and account details stay out. Set visibility at FleetYards after importing.')}</p>
   </aside>
  </div>
  {error&&<p className="error" role="alert">{error}</p>}
  <footer className="fy-footer"><div><span className="fy-footer-icon" aria-hidden="true">↧</span><p><strong>{l('Du entscheidest, was du teilst.','You decide what you share.')}</strong><span>{l('Die Datei wird lokal gespeichert. Es wird nichts hochgeladen.','The file is saved locally. Nothing is uploaded.')}</span></p></div><div><button disabled={saving} onClick={onClose}>{l('Schließen','Close')}</button><button className="primary" disabled={saving||!file.length||!options} onClick={()=>void save()}>{saving?l('Wird gespeichert …','Saving …'):l('JSON-Datei speichern …','Save JSON file …')}</button></div></footer>
 </>;
}
