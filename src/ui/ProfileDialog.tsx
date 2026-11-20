import React,{useEffect,useRef,useState} from 'react';
import {useText} from './i18n';
import './profile-dialog.css';

export function ProfileDialog({open,onCreate,onCreated,onClose}:{open:boolean;onCreate:(name:string)=>Promise<string>;onCreated:(id:string)=>void;onClose:()=>void}){
 const t=useText(),dialog=useRef<HTMLDialogElement>(null),input=useRef<HTMLInputElement>(null),inFlight=useRef(false);
 const [name,setName]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{if(open){setName('');setError('');if(!dialog.current?.open)dialog.current?.showModal();input.current?.focus();}else dialog.current?.close();},[open]);
 async function submit(e:React.FormEvent){e.preventDefault();if(inFlight.current||!name.trim())return;inFlight.current=true;setBusy(true);setError('');
  try{const id=await onCreate(name.trim());dialog.current?.close();onCreated(id);}catch(e){setError(e instanceof Error?e.message:t('Profil konnte nicht angelegt werden.'));}finally{inFlight.current=false;setBusy(false);}}
 return <dialog className="profile-dialog" ref={dialog} aria-labelledby="profile-title" onCancel={e=>{e.preventDefault();if(!inFlight.current)onClose();}}>
  <form onSubmit={e=>void submit(e)}><div className="eyebrow">{t('LOKALES PROFIL')}</div><h1 id="profile-title">{t('Profil anlegen')}</h1><p>{t('Gib deinem Hangar einen Namen.')}</p>
   <label htmlFor="profile-name">{t('Profilname')}</label><input ref={input} id="profile-name" autoComplete="off" placeholder={t('Mein Hangar')} value={name} maxLength={80} disabled={busy} onChange={e=>setName(e.target.value)}/>
   <small>{t('Nur lokal · keine RSI-Zugangsdaten nötig')}</small>{error&&<p className="error" role="alert">{error}</p>}
   <div className="dialog-actions"><button type="button" disabled={busy} onClick={onClose}>{t('Abbrechen')}</button><button type="submit" className="primary" disabled={busy||!name.trim()}>{t(busy?'Profil wird angelegt …':'Profil anlegen')}</button></div>
  </form>
 </dialog>;
}
