import React, { useContext, useEffect, useRef, useState } from 'react';
import type { ReleaseUpdate } from '../main/release-updates';
import { LanguageContext } from './i18n';

const copy = {
  de: {
    title: 'Update verfügbar', notes: 'Was ist neu?', close: 'Schließen', open: 'Auf GitHub downloaden',
    fallback: 'Die Details zu dieser Version stehen auf GitHub.',
    error: 'Die Release-Seite konnte nicht geöffnet werden.',
  },
  en: {
    title: 'Update available', notes: 'What’s new?', close: 'Close', open: 'Download on GitHub',
    fallback: 'Details about this version are available on GitHub.',
    error: 'Could not open the release page.',
  },
};

export function ReleaseUpdateControl() {
  const language = useContext(LanguageContext);
  const label = copy[language];
  const [update, setUpdate] = useState<ReleaseUpdate | null>(null);
  const [displayed, setDisplayed] = useState<ReleaseUpdate | null>(null);
  const [opening, setOpening] = useState(false);
  const [failed, setFailed] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    let active = true;
    async function readUpdate() {
      try {
        const result = await window.ccu.request({ action: 'help.checkUpdate' });
        if (active && result.ok) setUpdate(result.data as ReleaseUpdate | null);
      } catch { /* The help page is usable when GitHub is offline. */ }
    }
    void readUpdate();
    const timer = window.setInterval(() => void readUpdate(), 15 * 60 * 1000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  function showUpdate() {
    if (!update || !dialog.current) return;
    setFailed(false);
    setDisplayed(update);
    dialog.current.showModal();
  }

  async function openRelease() {
    if (!displayed || opening) return;
    setOpening(true);
    setFailed(false);
    try {
      const result = await window.ccu.request({ action: 'help.openUpdate', tag: displayed.tag });
      if (result.ok) dialog.current?.close();
      else setFailed(true);
    } catch { setFailed(true); }
    finally { setOpening(false); }
  }

  const notes = displayed?.notes[language];
  return <>
    {update && <button className="help-update-button" type="button" onClick={showUpdate}>{label.title} · {update.version}</button>}
    <dialog ref={dialog} className="help-update-dialog" aria-labelledby="help-update-title">
      <span className="eyebrow">Version {displayed?.version}</span>
      <h2 id="help-update-title">{label.title}</h2>
      <h3>{label.notes}</h3>
      <div className="help-update-notes">
        {notes?.length ? notes.map((line, index) => <p key={index}>{line}</p>) : <p>{label.fallback}</p>}
      </div>
      {failed && <p className="help-error" role="alert">{label.error}</p>}
      <div className="dialog-actions">
        <button type="button" className="secondary" autoFocus onClick={() => dialog.current?.close()}>{label.close}</button>
        <button type="button" className="primary" disabled={opening} onClick={() => void openRelease()}>
          {label.open} <span aria-hidden="true">↗</span>
        </button>
      </div>
    </dialog>
  </>;
}
