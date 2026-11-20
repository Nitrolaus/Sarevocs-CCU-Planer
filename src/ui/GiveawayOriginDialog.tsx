import React, { useEffect, useRef, useState } from 'react';
import { useText } from './i18n';

export function GiveawayOriginDialog({ initial, onSave, onClose }: {
  initial: string; onSave: (name: string) => Promise<void>; onClose: () => void;
}) {
  const t = useText(), dialog = useRef<HTMLDialogElement>(null), input = useRef<HTMLInputElement>(null), saving = useRef(false);
  const [name, setName] = useState(initial), [busy, setBusy] = useState(false), [error, setError] = useState(false);

  useEffect(() => {
    const current = dialog.current;
    if (current && !current.open) current.showModal();
    input.current?.select();
    return () => current?.close();
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError(false);
    try { await onSave(name.trim()); onClose(); }
    catch { setError(true); }
    finally { saving.current = false; setBusy(false); }
  }

  return <dialog ref={dialog} className="giveaway-dialog" aria-labelledby="giveaway-origin-title"
    onCancel={event => { event.preventDefault(); if (!saving.current) onClose(); }}>
    <form onSubmit={event => void submit(event)}>
      <h2 id="giveaway-origin-title">{t('Giveaway-Herkunft')}</h2>
      <label htmlFor="giveaway-donor">{t('Name des Spenders')}</label>
      <input ref={input} id="giveaway-donor" type="text" maxLength={80} autoComplete="off"
        value={name} disabled={busy} onChange={event => setName(event.currentTarget.value)} />
      {error && <p role="alert" className="error">{t('Giveaway-Herkunft konnte nicht gespeichert werden.')}</p>}
      <div className="dialog-actions"><button type="submit" className="primary" disabled={busy}>OK</button></div>
    </form>
  </dialog>;
}
