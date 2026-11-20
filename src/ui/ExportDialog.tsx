import React,{useContext,useEffect,useRef,useState} from 'react';
import type {Command} from '../main/commands';
import type {ExportContext,ReportFilters,ReportKind,ReportPreview,ReportSaveResult} from '../export/model';
import {reportSections,inventoryReportSections,planningReportSections} from '../export/model';
import {reportFilterLabels,reportFilterOptions} from '../export/filters';
import {LanguageContext,useText} from './i18n';
import './export.css';
async function request<T>(command:Command):Promise<T>{const r=await window.ccu.request(command);if(!r.ok)throw Error(r.error);return r.data as T;}
export function ExportDialog({accountId,initialKind,chainContext,onClose,onSaved}:{accountId:string;initialKind:ReportKind;chainContext:ExportContext;onClose:()=>void;onSaved:()=>void}){
 type Section=(typeof reportSections)[number];
 const t=useText(),[selected,setSelected]=useState<Section[]>([initialKind==='inventory'?'ships':initialKind]),[format,setFormat]=useState<'xlsx'|'pdf'>('xlsx'),[prepared,setPrepared]=useState<{scope:string;data:ReportPreview}|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false);
 const language=useContext(LanguageContext),[chosenFilters,setChosenFilters]=useState<ReportFilters>({});
 const modal=useRef<HTMLDialogElement>(null),pending=useRef(false),generation=useRef(0),close=useRef(onClose);close.current=onClose;
 const context=chainContext?.accountId===accountId?chainContext.chain:undefined,signature=JSON.stringify(context);
 const kinds=reportSections.filter(kind=>selected.includes(kind)&&(kind!=='chain'||!!context));
 const filters:ReportFilters=Object.fromEntries(kinds.flatMap(kind=>chosenFilters[kind]?.length?[[kind,chosenFilters[kind]]]:[]));
 const scope=JSON.stringify([accountId,kinds,filters,signature]),preview=prepared?.scope===scope?prepared.data:null;
 const labels:Record<Section,string>={ships:'Schiffe & Fahrzeuge',ccus:'CCUs im Bestand',paints:'Paints',packages:'Spielpakete',access:'Spielzugänge',buyback:'Buy Back',loaners:'Loaner & Beiboote',chain:'Aktuelle CCU-Kette',offers:'Messeangebote'};
 function checkbox(kind:Section){
  const unavailable=kind==='chain'&&!context;
  const checked=!unavailable&&selected.includes(kind);
  return <div key={kind}>
   <label><input type="checkbox" checked={checked} disabled={saving||unavailable}
    title={unavailable?t('Zuerst eine CCU-Kette mit Startbasis anzeigen.'):undefined}
    onChange={e=>setSelected(current=>e.target.checked?[...current,kind]:current.filter(value=>value!==kind))}/>{t(labels[kind])}</label>
   {checked&&<div className="export-subfilters" role="group" aria-label={t('Unterfilter')+' · '+t(labels[kind])}>
    <span>{t('Unterfilter')}</span>
    {reportFilterOptions[kind].map(([id,de,en])=><label key={id}>
     <input type="checkbox" checked={chosenFilters[kind]?.includes(id)??false} disabled={saving}
      onChange={e=>{const checked=e.target.checked;setChosenFilters(current=>{
       const previous=current[kind]??[];
       return {...current,[kind]:checked?[...previous,id]:previous.filter(value=>value!==id)};
      });}}/>{language==='en'?en:de}
    </label>)}
   </div>}
  </div>;
 }
 useEffect(()=>{const dialog=modal.current!,previous=document.activeElement as HTMLElement|null;dialog.showModal();return ()=>{generation.current++;dialog.close();previous?.focus();};},[]);
 useEffect(()=>{const epoch=++generation.current;setLoading(true);setPrepared(null);setError('');
  if(!kinds.length){setLoading(false);return;}
  void request<ReportPreview>({action:'report.selection',accountId,kinds,filters,...(kinds.includes('chain')?{chain:context}:{} )}).then(data=>{if(generation.current===epoch)setPrepared({scope,data});}).catch(e=>{if(generation.current===epoch)setError(e.message);}).finally(()=>{if(generation.current===epoch)setLoading(false);});
 },[scope]);
 async function save(){if(pending.current||!preview)return;pending.current=true;const epoch=generation.current;setSaving(true);setError('');
  try{const result=await request<ReportSaveResult>({action:'report.save',accountId,token:preview.token,format});if(epoch===generation.current&&result.exported){onSaved();close.current();}}
  catch(e){if(epoch===generation.current)setError(e instanceof Error?e.message:t('Export fehlgeschlagen.'));}
  finally{pending.current=false;if(epoch===generation.current)setSaving(false);}
 }
 return <dialog ref={modal} className="export-dialog" aria-labelledby="export-title" onCancel={event=>{event.preventDefault();if(!pending.current)close.current();}}>
  <header className="export-header"><div><h2 id="export-title">{t('Exportieren')}</h2><span className="export-meta">{preview?.profileName}</span></div>
   <div className="export-formats" role="group" aria-label={t('Dateiformat')}><button aria-pressed={format==='xlsx'} className={format==='xlsx'?'primary':''} disabled={saving} onClick={()=>setFormat('xlsx')}>Excel (.xlsx)</button><button aria-pressed={format==='pdf'} className={format==='pdf'?'primary':''} disabled={saving} onClick={()=>setFormat('pdf')}>PDF</button></div>
  </header>
  <h3>{t('Inhalte auswählen')}</h3>
  <div className="export-choices">
   <fieldset><legend>{t('Bestand')}</legend>{inventoryReportSections.map(checkbox)}</fieldset>
   <fieldset><legend>{t('Planung & Angebote')}</legend>{planningReportSections.map(checkbox)}</fieldset>
  </div>
  <div className="export-selection-preview" aria-live="polite" aria-busy={loading||saving}>
   <strong>{kinds.length?`${format==='xlsx'?'Excel':'PDF'} · ${kinds.length} ${t(format==='xlsx'?(kinds.length===1?'Tabellenblatt':'Tabellenblätter'):(kinds.length===1?'Abschnitt':'Abschnitte'))}`:t('Keine Bereiche ausgewählt')}</strong>
   {kinds.map(kind=><p key={kind}>{t(labels[kind])} · {reportFilterLabels(kind,filters[kind]??[],language).join(t(' oder '))||t('Alle Einträge')}</p>)}
   {kinds.length>0&&loading&&<p>{t('Vorschau wird erstellt …')}</p>}
   {preview?.sections?.some(section=>!section.count)&&<p>{t('Ohne Daten')}: {preview.sections.filter(section=>!section.count).map(section=>section.title).join(' · ')}</p>}
  </div>
  {error&&<p className="error" role="alert">{error}</p>}
  <div className="export-actions"><button disabled={saving} onClick={onClose}>{t('Abbrechen')}</button><button className="primary" disabled={loading||saving||!preview} onClick={()=>void save()}>{saving?t('Wird gespeichert …'):t('Speicherort wählen …')}</button></div>
 </dialog>;
}
