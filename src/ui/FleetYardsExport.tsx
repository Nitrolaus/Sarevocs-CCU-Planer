import React,{useContext,useEffect,useMemo,useRef,useState} from 'react';
import type {Command} from '../main/commands';
import {fleetFile,fleetJson,type FleetPreview,type FleetShip} from '../export/fleetyards';
import {LanguageContext} from './i18n';
import './fleetyards.css';

async function request<T>(command:Command):Promise<T>{const result=await window.ccu.request(command);if(!result.ok)throw Error(result.error);return result.data as T;}
const normalize=(v:string)=>v.normalize('NFD').replace(/\p{M}/gu,'').toLocaleLowerCase('en').trim();
export function FleetYardsExport({accountId,onClose,onSaved,onBusy}:{accountId:string;onClose:()=>void;onSaved:()=>void;onBusy:(busy:boolean)=>void}){
 const language=useContext(LanguageContext),l=(de:string,en:string)=>language==='en'?en:de;
 const [preview,setPreview]=useState<FleetPreview|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false);
 const [selected,setSelected]=useState<Set<string>>(()=>new Set()),[query,setQuery]=useState(''),[manufacturer,setManufacturer]=useState('');
 const [view,setView]=useState<'all'|'selected'|'hidden'>('all'),[page,setPage]=useState(0),[size,setSize]=useState(25),[names,setNames]=useState(false),[paints,setPaints]=useState(false),[jsonOpen,setJsonOpen]=useState(false);
 const generation=useRef(0),pending=useRef(false),scroll=useRef<HTMLDivElement>(null),pageCheck=useRef<HTMLInputElement>(null);
 useEffect(()=>{const epoch=++generation.current;setLoading(true);setError('');setPreview(null);setSelected(new Set());
  void request<FleetPreview>({action:'fleetyards.preview',accountId}).then(data=>{if(generation.current===epoch)setPreview(data)}).catch(e=>{if(generation.current===epoch)setError(e.message)}).finally(()=>{if(generation.current===epoch)setLoading(false)});
  return()=>{generation.current++;};
 },[accountId]);
 useEffect(()=>{onBusy(saving);return()=>onBusy(false)},[saving,onBusy]);
 const ships=preview?.ships??[];
 const manufacturers=useMemo(()=>[...new Set(ships.flatMap(s=>s.manufacturer?[s.manufacturer]:[]))].sort((a,b)=>a.localeCompare(b,language)),[ships,language]);
 const copies=useMemo(()=>{const totals=new Map<string,number>(),seen=new Map<string,number>();for(const s of ships)totals.set(s.name,(totals.get(s.name)??0)+1);return new Map(ships.map(s=>{const n=(seen.get(s.name)??0)+1;seen.set(s.name,n);return[s.key,(totals.get(s.name)??0)>1?n:0]}))},[ships]);
 const hits=useMemo(()=>ships.filter(s=>(!manufacturer||s.manufacturer===manufacturer)&&(!query||normalize([s.name,s.manufacturer,s.customShipName].join(' ')).includes(normalize(query)))&&(view==='all'||selected.has(s.key)===(view==='selected'))),[ships,manufacturer,query,view,selected]);
 const pages=Math.max(1,Math.ceil(hits.length/size)),index=Math.min(page,pages-1),visible=hits.slice(index*size,(index+1)*size);
 const options={customShipNames:names,paints},file=selected.size?fleetFile(ships,[...selected],options):[];
 const grouped=new Map<string,number>();for(const row of file)grouped.set(row.name,(grouped.get(row.name)??0)+1);
 const eligible=visible.filter(s=>!!s.catalogueName),checked=eligible.filter(s=>selected.has(s.key)).length;
 useEffect(()=>{if(pageCheck.current)pageCheck.current.indeterminate=checked>0&&checked<eligible.length},[checked,eligible.length]);
 useEffect(()=>{if(scroll.current)scroll.current.scrollTop=0},[index,query,manufacturer,view]);
 function choose(rows:readonly FleetShip[],include:boolean){setSelected(current=>{const next=new Set(current);for(const s of rows)if(s.catalogueName){if(include)next.add(s.key);else next.delete(s.key)}return next})}
 async function save(){if(pending.current||!preview||!selected.size)return;pending.current=true;const epoch=generation.current;setSaving(true);setError('');
  try{const result=await request<{exported:boolean}>({action:'fleetyards.save',accountId,token:preview.token,selected:[...selected],options});if(generation.current===epoch&&result.exported){onSaved();onClose()}}
  catch(e){if(generation.current===epoch)setError(e instanceof Error?e.message:l('Export fehlgeschlagen.','Export failed.'))}
  finally{pending.current=false;if(generation.current===epoch)setSaving(false)}
 }
 if(loading)return <div className="fy-loading" role="status">{l('Vorschau wird erstellt …','Preparing preview …')}</div>;
 if(!preview)return <div className="fy-loading" role="alert">{error}</div>;
 return <>
  <div className="fy-workspace">
   <section className={'fy-ships-panel'+(names?' fy-show-names':'')+(paints?' fy-show-paints':'')} aria-labelledby="fy-ships-title">
    <div className="fy-section-title"><h3 id="fy-ships-title">{l('Schiffe & Fahrzeuge','Ships & vehicles')}</h3><span>{file.length} {l('von','of')} {ships.length} {l('im Export','in export')}</span></div>
    <div className="fy-search-row"><label className="fy-search"><span aria-hidden="true">⌕</span><input type="search" autoComplete="off" value={query} disabled={saving} aria-label={l('Schiffe durchsuchen','Search ships')} placeholder={l('Schiff, Hersteller oder eigenen Namen suchen','Search ship, manufacturer or custom name')} onChange={e=>{setQuery(e.target.value);setPage(0)}}/></label>
     <select value={manufacturer} disabled={saving} aria-label={l('Nach Hersteller filtern','Filter by manufacturer')} onChange={e=>{setManufacturer(e.target.value);setPage(0)}}><option value="">{l('Alle Hersteller','All manufacturers')}</option>{manufacturers.map(name=><option key={name}>{name}</option>)}</select></div>
    <div className="fy-toolbar"><div className="fy-view-tabs" role="group" aria-label={l('Auswahl anzeigen','Show selection')}>{(['all','selected','hidden'] as const).map((mode,i)=><button key={mode} disabled={saving} aria-pressed={view===mode} onClick={()=>{setView(mode);setPage(0)}}>{[l('Alle','All'),l('Im Export','Included'),l('Ausgeblendet','Hidden')][i]} <span>{[ships.length,selected.size,ships.length-selected.size][i]}</span></button>)}</div><span role="status">{hits.length} {l('Treffer','matches')}</span></div>
    <div className="fy-bulk"><button disabled={saving||!hits.some(s=>s.catalogueName&&!selected.has(s.key))} onClick={()=>choose(hits,true)}>{l('Treffer übernehmen','Include matches')}</button><button className="fy-text-button" disabled={saving||!hits.some(s=>selected.has(s.key))} onClick={()=>choose(hits,false)}>{l('Treffer ausblenden','Hide matches')}</button><span>{l('Gilt für alle gefilterten Treffer','Applies to all filtered matches')}</span></div>
    <div className="fy-table-scroll" ref={scroll} tabIndex={0} aria-label={l('Schiffstabelle','Ship table')}>
     <table><colgroup><col style={{width:38}}/><col/><col style={{width:'34%'}}/>{names&&<col style={{width:160}}/>}{paints&&<col style={{width:160}}/>}<col style={{width:100}}/></colgroup><thead><tr><th className="fy-check-col"><input ref={pageCheck} type="checkbox" checked={!!eligible.length&&checked===eligible.length} disabled={saving||!eligible.length} aria-label={l('Schiffe dieser Seite auswählen','Select this page')} onChange={e=>choose(visible,e.target.checked)}/></th><th>{l('Schiff / Fahrzeug','Ship / vehicle')}</th><th>{l('Hersteller','Manufacturer')}</th>{names&&<th>{l('Eigener Schiffsname','Custom name')}</th>}{paints&&<th>{l('Lackierung','Paint')}</th>}<th>{l('Datei','File')}</th></tr></thead>
      <tbody>{visible.map(s=><tr key={s.key} className={selected.has(s.key)?'fy-selected':''}><td className="fy-check-col"><input type="checkbox" checked={selected.has(s.key)} disabled={saving||!s.catalogueName} aria-label={`${s.name}${copies.get(s.key)?`, ${l('Exemplar','Copy')} ${copies.get(s.key)}`:''} ${l('in Export aufnehmen','include in export')}`} onChange={e=>choose([s],e.target.checked)}/></td><th scope="row">{s.name}{!!copies.get(s.key)&&<small>{l('Exemplar','Copy')} {copies.get(s.key)}</small>}</th><td className="fy-maker">{s.manufacturer??l('Zuordnung offen','Match pending')}</td>{names&&<td>{s.customShipName??'—'}</td>}{paints&&<td>{s.paintSlugs.join(', ')||'—'}</td>}<td className={'fy-state'+(!s.catalogueName?' fy-open':selected.has(s.key)?' fy-included':'')}>{!s.catalogueName?l('Zuordnung offen','Match pending'):selected.has(s.key)?l('✓ Enthalten','✓ Included'):l('Ausgeblendet','Hidden')}</td></tr>)}</tbody></table>
     {!hits.length&&<p className="fy-empty">{l('Keine passenden Schiffe. Ändere deine Suche oder den Herstellerfilter.','No matching ships. Change your search or manufacturer filter.')}</p>}
    </div>
    <div className="fy-pagination"><span>{hits.length?`${index*size+1}–${Math.min((index+1)*size,hits.length)}`:'0'} {l('von','of')} {hits.length}</span><div><label>{l('Zeilen','Rows')} <select value={size} disabled={saving} aria-label={l('Zeilen je Seite','Rows per page')} onChange={e=>{setSize(Number(e.target.value));setPage(0)}}>{[25,50,100].map(n=><option key={n}>{n}</option>)}</select></label><button disabled={saving||index===0} aria-label={l('Vorherige Seite','Previous page')} onClick={()=>setPage(index-1)}>‹</button><span>{index+1} / {pages}</span><button disabled={saving||index+1>=pages} aria-label={l('Nächste Seite','Next page')} onClick={()=>setPage(index+1)}>›</button></div></div>
    {ships.some(s=>!s.catalogueName)&&<p className="fy-resolution">{ships.filter(s=>!s.catalogueName).length} {l('Modelle noch nicht zugeordnet. Sie bleiben außerhalb des Exports.','models are not matched yet and stay out of the export.')}</p>}
   </section>
   <aside className="fy-file-panel" aria-labelledby="fy-file-title">
    <div className="fy-section-title"><h3 id="fy-file-title">{l('Das gibst du weiter','What you share')}</h3><span className="fy-private">◈ {l('Privat','Private')}</span></div>
    <div className="fy-file-summary"><strong>{file.length}</strong><span>{l('Schiffe in deiner Datei','ships in your file')}</span><small>{ships.length-file.length} {l('Schiffe bleiben außerhalb der Datei','ships stay out of the file')}</small></div>
    <fieldset><legend>{l('Optionale Angaben','Optional details')}</legend><label><input type="checkbox" checked={names} disabled={saving||!ships.some(s=>s.customShipName)} onChange={e=>setNames(e.target.checked)}/><span>{l('Eigene Schiffsnamen','Custom ship names')}<small>{ships.some(s=>s.customShipName)?l('Nur bei ausdrücklicher Auswahl','Only when selected'):l('Im gespeicherten Bestand nicht belegt','Not documented in the saved inventory')}</small></span></label><label><input type="checkbox" checked={paints} disabled={saving||!ships.some(s=>s.paintSlugs.length)} onChange={e=>setPaints(e.target.checked)}/><span>{l('Lackierungen','Paints')}<small>{ships.some(s=>s.paintSlugs.length)?l('Nur eindeutig zugeordnete Paints','Only explicitly associated paints'):l('Keine eindeutige Zuordnung belegt','No explicit association documented')}</small></span></label></fieldset>
    <div className="fy-local-only"><span aria-hidden="true">▣</span><div><strong>{l('Bleibt bei dir','Stays with you')}</strong><p>{l('Kaufpreise, Seriennummern, Bestellnummern und RSI-Kontodaten.','Purchase prices, serial numbers, order numbers and RSI account details.')}</p></div></div>
    <div className="fy-manifest-header"><h4>{l('Deine Auswahl','Your selection')}</h4><button className="fy-text-button" disabled={saving||!selected.size} onClick={()=>setSelected(new Set())}>{l('Leeren','Clear')}</button></div>
    <ul className="fy-manifest">{grouped.size?[...grouped].map(([name,n])=><li key={name}><div>{name}</div><span>× {n}</span></li>):<li className="fy-no-selection">{l('Wähle links die Schiffe aus, die du weitergeben möchtest.','Select the ships you want to share on the left.')}</li>}</ul>
    <div className="fy-file-details"><button aria-expanded={jsonOpen} onClick={()=>setJsonOpen(!jsonOpen)}>{l('< / >  Dateivorschau','< / >  File preview')} <span>⌄</span></button>{jsonOpen&&<pre tabIndex={0} aria-label={l('Inhalt der FleetYards-Datei','FleetYards file contents')}>{fleetJson(file)}</pre>}</div>
    <p className="fy-privacy-note">{l('„Privat“ wird in der Datei gesetzt. Nach dem Import gelten zusätzlich deine Einstellungen bei FleetYards.','The file specifies “private”. Your FleetYards settings also apply after import.')}</p>
   </aside>
  </div>
  {error&&<p className="error" role="alert">{error}</p>}
  <footer className="fy-footer"><div><span className="fy-footer-icon" aria-hidden="true">↧</span><p><strong>{l('Du entscheidest, was du teilst.','You decide what you share.')}</strong><span>{l('Die Datei wird lokal gespeichert. Es wird nichts hochgeladen.','The file is saved locally. Nothing is uploaded.')}</span></p></div><div><button disabled={saving} onClick={onClose}>{l('Schließen','Close')}</button><button className="primary" disabled={saving||!file.length} onClick={()=>void save()}>{saving?l('Wird gespeichert …','Saving …'):l('JSON-Datei speichern …','Save JSON file …')}</button></div></footer>
 </>;
}
