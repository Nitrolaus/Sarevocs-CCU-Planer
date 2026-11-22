import React, { useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Pledge } from '../domain/model';
import { deriveLoaners } from '../loaners/derive';
import { LOANER_ARTICLES, type LoanerSnapshot } from '../loaners/model';
import { LanguageContext, useText } from './i18n';
import {loanerReviewBasis,loanerReviewKey,type LoanerDecision,type LoanerReviewsSnapshot} from '../loaners/review-model';
import type {BridgeResult,Command} from '../main/commands';
import './loaner-reviews.css';
import {ResizableTable} from './ResizableTable';
import {inventorySearch} from '../market/search';

async function request<T>(command:Command):Promise<T>{const result=await window.ccu.request(command) as BridgeResult<T>;if(!result.ok)throw Error('LOCAL_REVIEW_FAILED');return result.data;}
type Menu={accountId:string;scope:string;key:string;left:number;top:number;state:LoanerDecision};

export function LoanerTable({ accountId, pledges, snapshot, query='', onSearchCount }: {
  accountId:string|null;pledges: readonly Pledge[]; snapshot: LoanerSnapshot; query?:string; onSearchCount?:(shown:number,total:number)=>void;
}) {
  const t = useText(),language=useContext(LanguageContext), derived = useMemo(() => deriveLoaners(pledges, snapshot.data), [pledges, snapshot.data]);
  const match=inventorySearch(query);
  const visible=derived.rows.filter(row=>match(row.name,...row.origins.flatMap(origin=>[origin.parent,origin.publishedParent])));
  useEffect(()=>onSearchCount?.(visible.length,derived.rows.length),[visible.length,derived.rows.length,onSearchCount]);
  const basis=JSON.stringify(derived.rows.map(row=>[row.key,loanerReviewBasis(row)])),scope=(accountId??'')+'|'+basis,scopeRef=useRef(scope);scopeRef.current=scope;
  const [keys,setKeys]=useState<{scope:string;values:Record<string,string>}|null>(null),[reviews,setReviews]=useState<LoanerReviewsSnapshot|null>(null);
  const [menu,setMenu]=useState<Menu|null>(null),[saving,setSaving]=useState(false),[error,setError]=useState('');
  const menuRef=useRef<HTMLDivElement>(null),selectRef=useRef<HTMLSelectElement>(null),anchor=useRef<HTMLElement|null>(null);
  useEffect(()=>{let active=true;setMenu(null);setError('');setSaving(false);
    void Promise.all((JSON.parse(basis) as [string,string][]).map(async([model,value])=>[model,await loanerReviewKey(value)] as const))
      .then(values=>{if(active)setKeys({scope,values:Object.fromEntries(values)});}).catch(()=>{if(active)setError('Bestätigungen sind derzeit nicht verfügbar.');});
    return()=>{active=false;};
  },[basis,scope]);
  useEffect(()=>{let active=true;setReviews(null);if(accountId)void request<LoanerReviewsSnapshot>({action:'loaners.reviews',accountId})
    .then(value=>{if(active&&value.accountId===accountId)setReviews(value);}).catch(()=>{if(active)setReviews({accountId,readable:false,entries:{}});});
    return()=>{active=false;};
  },[accountId]);
  const current=reviews?.accountId===accountId?reviews:null,keyMap=keys?.scope===scope?keys.values:{},activeMenu=menu?.scope===scope?menu:null;
  useEffect(()=>{if(!activeMenu)return;selectRef.current?.focus();
    const outside=(event:PointerEvent)=>{if(!menuRef.current?.contains(event.target as Node))setMenu(null);};
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){setMenu(null);if(anchor.current?.isConnected)anchor.current.focus({preventScroll:true});}};
    window.addEventListener('pointerdown',outside);window.addEventListener('keydown',escape);return()=>{window.removeEventListener('pointerdown',outside);window.removeEventListener('keydown',escape);};
  },[activeMenu?.key]);
  function openMenu(event:React.MouseEvent<HTMLTableRowElement>|React.KeyboardEvent<HTMLTableRowElement>,key:string|undefined){
    event.preventDefault();if(!accountId||!key||!current?.readable||saving)return;anchor.current=event.currentTarget;
    const rect=event.currentTarget.getBoundingClientRect(),x='clientX' in event?event.clientX:rect.left+24,y='clientY' in event?event.clientY:rect.top+16;
    setMenu({accountId,scope,key,left:Math.max(8,Math.min(x,window.innerWidth-328)),top:Math.max(8,Math.min(y,window.innerHeight-120)),state:current.entries[key]?.state??'unconfirmed'});
  }
  async function save(state:LoanerDecision){
    if(!activeMenu)return;const target=activeMenu;setSaving(true);setError('');setMenu({...target,state});
    try{const value=await request<LoanerReviewsSnapshot>({action:'loaners.review',accountId:target.accountId,key:target.key,state});
      if(scopeRef.current===target.scope){if(value.accountId!==target.accountId||!value.readable)throw Error('REVIEW_PROFILE');setReviews(value);setMenu(null);}
    }catch{if(scopeRef.current===target.scope){setError('Bestätigung konnte nicht gespeichert werden. Vorherige Angabe bleibt erhalten.');setMenu(target);}}
    finally{if(scopeRef.current===target.scope)setSaving(false);}
  }
  const outdated = snapshot.data && Date.now() - Math.min(Date.parse(snapshot.data.loaners.fetchedAt), Date.parse(snapshot.data.included.fetchedAt)) > 36 * 3600000;
  return <><ResizableTable className="inventory-table loaner-table" storageKey="loaners" label={t('Loaner & Beiboote')} columns={['Schiff / Fahrzeug','Art','RSI-Regel für','Quelle'].map((label,i)=>({label:t(label),min:[140,90,130,120][i]!,preferred:[280,150,220,185][i]!,autoLimit:920}))}>
    <tbody>{visible.map(row => {
      const kinds = new Set(row.origins.map(o => o.kind)), sources = [...new Set(row.origins.map(o => o.source))];
      const kind = kinds.size > 1 ? 'Loaner / Beiboot' : kinds.has('included') ? 'Beiboot' : 'Loaner';
      const origin = row.origins.map(o => `${o.parent} · Pledge ${o.pledgeId}${o.replaces ? ' · ' + t('Ersatz für enthaltenes Fahrzeug') + ': ' + o.replaces : ''}`).join('\n');
      const sourceTitle = sources.map(s => `${LOANER_ARTICLES[s].title}\n${t('Quellenstand')}: ${snapshot.data![s].updatedAt.slice(0,10)}\n${t('Abgerufen')}: ${snapshot.data![s].fetchedAt}`).join('\n\n');
      const reviewKey=keyMap[row.key],review=reviewKey?current?.entries[reviewKey]:undefined,status=review?'user-'+review.state:'unconfirmed';
      const statusTitle=review?t('Benutzerangabe vom')+' '+new Intl.DateTimeFormat(language==='en'?'en-GB':'de-DE',{timeZone:'Europe/Berlin',dateStyle:'short',timeStyle:'short'}).format(new Date(review.updatedAt))+' · '+t('Kein RSI-Kontonachweis'):t('Unbestätigt');
      return <tr key={row.key} tabIndex={0} data-account-status={status} data-review-ready={!!reviewKey&&!!current?.readable} className={status} onContextMenu={event=>openMenu(event,reviewKey)}
        onKeyDown={event=>{if(event.key==='ContextMenu'||event.key==='F10'&&event.shiftKey)openMenu(event,reviewKey);}}><td title={row.name+'\n'+origin+'\n'+statusTitle}>{row.name}<small className="subline">{t(review?.state==='present'?'Von dir als vorhanden bestätigt':review?.state==='absent'?'Von dir als nicht vorhanden markiert':'Nur RSI-Regel · kein Zuteilungsnachweis')}
        {row.alsoOwned && ' · ' + t('Modell im eingelesenen Bestand')}</small></td>
        <td><span className={'badge '+(review?.state==='present'?'self-present':review?.state==='absent'?'self-absent':'unknown')} title={statusTitle}>{t(kind)}<small className="subline">{t(review?.state==='present'?'Selbst bestätigt':review?.state==='absent'?'Nicht vorhanden':'Unbestätigt')}</small></span></td><td title={origin}>{[...new Set(row.origins.map(o => o.publishedParent))].join(', ')}</td>
        <td title={sourceTitle}>{t(sources.length > 1 ? 'RSI · Matrix / Beiboote' : sources[0] === 'included' ? 'RSI · Beiboote' : 'RSI · Loaner-Matrix')}
          <small className="subline">{sources.map(s => snapshot.data![s].updatedAt.slice(0,10)).join(' / ')}</small></td></tr>;
    })}
    {!derived.rows.length && <tr><td colSpan={4} className="empty">{t(!snapshot.data ? snapshot.pending ? 'Loaner-Daten werden geladen …' : 'Loaner-Daten nicht verfügbar. Bitte aktualisieren.' : !pledges.length ? 'Zuerst einen Bestand einlesen.' : 'Keine ausdrücklich passenden RSI-Regeln gefunden. Loaner-Bestand bleibt ungeprüft.')}</td></tr>}
    {!!derived.rows.length&&!visible.length&&<tr><td colSpan={4} className="empty">{t('Keine passenden Einträge gefunden.')}</td></tr>}
    </tbody></ResizableTable><div className="hint" role="status">{t('RSI-Regeln · persönliche Bestätigungen sind Benutzerangaben, keine RSI-Kontonachweise.')}
      {accountId&&!current&&' '+t('Bestätigungen werden geladen …')}
      {current&&!current.readable&&' '+t('Gespeicherte Bestätigungen sind nicht lesbar; keine Änderung möglich.')}
      {error&&' '+t(error)}
      {snapshot.pending && ' ' + t('Loaner-Daten werden aktualisiert …')}
      {(snapshot.error || outdated) && snapshot.data && ' ' + t('Letzter gültiger Quellenstand; Aktualisierung ausstehend.')}
      {!derived.gameAccessObserved && pledges.length > 0 && ' ' + t('Star-Citizen-Spielzugang im gelesenen Bestand nicht belegt.')}
      {derived.partialRules && ' ' + t('Einige Variantenregeln sind ungeklärt.')}</div>
      {activeMenu&&<div ref={menuRef} className="loaner-context" role="dialog" aria-label={t('Loaner-Bestätigung')} style={{left:activeMenu.left,top:activeMenu.top}}>
        <label>{t('Loaner-Status (deine Angabe)')}<select ref={selectRef} aria-label={t('Loaner-Status (deine Angabe)')} disabled={saving} value={activeMenu.state} onChange={event=>void save(event.currentTarget.value as LoanerDecision)}>
          <option value="unconfirmed">{t('Unbestätigt / zurücksetzen')}</option><option value="present">{t('Vorhanden – selbst bestätigt')}</option><option value="absent">{t('Nicht vorhanden – selbst bestätigt')}</option>
        </select></label></div>}
    </>;
}
