import React,{useEffect,useState} from 'react';
import type { DisplaySettings, PricingSnapshot } from '../pricing/model';
import { useText } from './i18n';
import { vatLabel } from './vat-label';
import './settings.css';
export function SettingsView({display,onSave,dataDir}:{display:PricingSnapshot;onSave:(settings:DisplaySettings)=>Promise<void>;dataDir:string}){
  const t=useText(),[draft,setDraft]=useState(display.settings),[vat,setVat]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false);
  const enteredRate=Number(vat.replace(',','.'));
  const labelledRate=vat.trim()&&Number.isFinite(enteredRate)&&enteredRate>=0&&enteredRate<=100?Math.round(enteredRate*100):draft.vatBasisPoints;
  useEffect(()=>{
    const s=display.settings;
    setDraft(s);
    setVat((s.vatBasisPoints/100).toFixed(2).replace('.',s.language==='de'?',':'.'));
  },[display.settings.language,display.settings.currency,display.settings.taxMode,display.settings.vatBasisPoints,display.settings.windowClose]);
  async function save(){setError('');setSaved(false);if(!/^\d{1,3}(?:[.,]\d{1,2})?$/.test(vat)||Number(vat.replace(',','.'))>100){setError(t('Mehrwertsteuer muss zwischen 0 und 100 Prozent liegen, mit höchstens zwei Nachkommastellen.'));return;}
    const next:DisplaySettings={...draft,vatBasisPoints:Math.round(enteredRate*100)};
    setBusy(true);try{await onSave(next);setSaved(true);}catch{setError(t('Einstellungen konnten nicht gespeichert werden.'));}finally{setBusy(false);}}
  return <section className="settings-view"><h1>{t('Daten & Einstellungen')}</h1><section className="panel settings-panel"><h2>{t(display.configured?'Sprache, Preise & Fenster':'Erste Einrichtung')}</h2><p>{t(display.configured?'Jederzeit für dieses Windows-Benutzerkonto ändern.':'Wähle deine Anzeigeeinstellungen; eine RSI-Anmeldung ist dafür nicht nötig.')}</p>
    {display.settingsError&&<p className="error" role="alert">{t('Gespeicherte Einstellungen sind nicht lesbar. Bitte deine Auswahl prüfen und speichern.')}</p>}
    <label>{t('Sprache')}<select aria-label={t('Sprache')} value={draft.language} disabled={busy} onChange={e=>{setDraft({...draft,language:e.target.value as 'de'|'en'});setSaved(false);}}><option value="de">Deutsch</option><option value="en">English</option></select></label>
    <label>{t('Anzeigewährung')}<select aria-label={t('Anzeigewährung')} value={draft.currency} disabled={busy} onChange={e=>{setDraft({...draft,currency:e.target.value as 'EUR'|'USD'});setSaved(false);}}><option value="EUR">{t('Euro (EUR)')}</option><option value="USD">{t('US-Dollar (USD)')}</option></select></label>
    <label>{t('Preisanzeige')}<select aria-label={t('Preisanzeige')} value={draft.taxMode} disabled={busy} onChange={e=>{setDraft({...draft,taxMode:e.target.value as 'net'|'gross'});setSaved(false);}}><option value="net">{t('Vor Steuer (netto)')}</option><option value="gross">{vatLabel(labelledRate,draft.language)}</option></select></label>
    <label>{t('Mehrwertsteuersatz (%)')}<input value={vat} inputMode="decimal" maxLength={6} disabled={busy} onChange={e=>{setVat(e.target.value);setSaved(false);}} /></label>
    <p className="hint">{t('Preisquelle für CCUs · Automatisch · RSI-Shoppreis, sonst EZB')}</p>
    <label>{t('Beim Schließen mit X')}
      <select value={draft.windowClose??'tray'} disabled={busy} onChange={e=>{setDraft({...draft,windowClose:e.target.value==='quit'?'quit':'tray'});setSaved(false);}}>
        <option value="tray">{t('Im Tray weiterlaufen')}</option>
        <option value="quit">{t('Programm beenden')}</option>
      </select>
    </label>
    {error&&<p className="error" role="alert">{error}</p>}{saved&&<p className="message" role="status">{t('Einstellungen gespeichert.')}</p>}
    <div className="settings-actions"><button className="primary" disabled={busy} onClick={()=>void save()}>{t('Speichern')}</button></div></section>
    <div className="data-location" id="data-location"><strong>{t('Datenordner')}</strong><p>{dataDir}</p></div></section>;
}
