import React, { useContext, useRef, useState } from 'react';
import type { ReleaseUpdate } from '../main/release-updates';
import { LanguageContext } from './i18n';

const copy = {
  de: {
    title: 'Update verfügbar', notes: 'Was ist neu?', close: 'Schließen', open: 'GitHub öffnen und Planer beenden',
    warning: 'Nach deiner Bestätigung öffnet sich GitHub im Browser. Der Planer wird vollständig beendet, auch im Windows-Infobereich.',
    fallback: 'Die Details zu dieser Version stehen auf GitHub.',
    error: 'Die Release-Seite konnte nicht geöffnet werden.',
  },
  en: {
    title: 'Update available', notes: 'What’s new?', close: 'Close', open: 'Open GitHub and quit planner',
    warning: 'After you confirm, GitHub opens in your browser and the planner quits completely, including its system tray icon.',
    fallback: 'Details about this version are available on GitHub.',
    error: 'Could not open the release page.',
  },
};

export function ReleaseUpdateControl({ update }: { update: ReleaseUpdate }) {
  const language = useContext(LanguageContext);
  const label = copy[language];
  const [opening, setOpening] = useState(false);
  const [failed, setFailed] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);

  function showUpdate() {
    setFailed(false);
    dialog.current?.showModal();
  }

  async function openRelease() {
    if (opening) return;
    setOpening(true);
    setFailed(false);
    try {
      const result = await window.ccu.request({ action: 'help.openUpdate', tag: update.tag });
      if (!result.ok) setFailed(true);
      else if ((result.data as { opened?: boolean } | undefined)?.opened) dialog.current?.close();
    } catch { setFailed(true); }
    finally { setOpening(false); }
  }

  const notes = update.notes[language];
  return <>
    <button className="help-update-button primary" type="button" onClick={showUpdate}>{label.title} · {update.version}</button>
    <dialog ref={dialog} className="help-update-dialog" aria-labelledby="help-update-title">
      <span className="eyebrow">Version {update.version}</span>
      <h2 id="help-update-title">{label.title}</h2>
      <h3>{label.notes}</h3>
      <div className="help-update-notes">
        {notes?.length ? notes.map((line, index) => <p key={index}>{line}</p>) : <p>{label.fallback}</p>}
      </div>
      <p className="help-update-warning">{label.warning}</p>
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
