import React, { useEffect, useId, useRef, useState } from 'react';
import type { ConciergeRank, PledgeTotal } from '../domain/concierge';
import { ConciergeBadge, hasConciergeBadge } from './ConciergeBadge';
import type { Command } from '../main/commands';
import { translate } from './i18n';

export function ConciergeCard({ accountId, revision, connected, busy=false, language, request }: {
  accountId?: string;
  revision?: string;
  connected: boolean;
  busy?: boolean;
  language: 'de' | 'en';
  request: <T>(command: Command) => Promise<T>;
}) {
  const t = (message: string) => translate(language, message);
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const revealEpoch = useRef(0);
  const [rank, setRank] = useState<ConciergeRank | null>(null);
  const [reading, setReading] = useState(false);
  const [total, setTotal] = useState<Extract<PledgeTotal, { status: 'loaded' }> | null>(null);
  const [notice, setNotice] = useState('');
  function clear() {
    ++revealEpoch.current;
    dialog.current?.close();
    setTotal(null);
    setReading(false);
    setNotice('');
  }
  useEffect(() => {
    const onVisibility = () => { if (document.hidden) clear(); };
    document.addEventListener('visibilitychange', onVisibility);
    const unsubscribe = window.ccu.onConcealPledge?.(clear);
    return () => { ++revealEpoch.current; document.removeEventListener('visibilitychange', onVisibility); unsubscribe?.(); };
  }, []);
  useEffect(() => {
    if (!accountId || busy) return;
    let active = true;
    setRank(null);
    void request<ConciergeRank>({ action: 'rsi.conciergeRank', accountId }).then(result => {
      if (active) setRank(result);
    }).catch(() => { if (active) setRank({ status: 'unavailable' }); });
    return () => { active = false; };
  }, [accountId, revision, connected, busy, request]);
  useEffect(() => {
    if (!total) return;
    const timeout = setTimeout(clear, 30_000);
    return () => clearTimeout(timeout);
  }, [total]);

  async function reveal() {
    if (!accountId || reading || busy) return;
    dialog.current?.close();
    const epoch = ++revealEpoch.current;
    setReading(true);
    setNotice('');
    try {
      const result = await request<PledgeTotal>({ action: 'rsi.pledgeTotal', accountId });
      if (epoch !== revealEpoch.current || document.hidden) return;
      if (result.status === 'loaded') setTotal(result);
      else if (result.status === 'hello-unavailable') setNotice('Windows Hello ist nicht verfügbar.');
      else if (result.status === 'session-required') setNotice('Eine gültige gespeicherte RSI-Sitzung ist erforderlich.');
      else if (result.status === 'unavailable') setNotice(result.reason==='format'
        ? 'RSI-Billing enthält keine lesbare Pledge-Summe.' : 'RSI-Pledge-Summe derzeit nicht verfügbar.');
    } catch {
      if (epoch === revealEpoch.current) setNotice('RSI-Pledge-Summe derzeit nicht verfügbar.');
    } finally {
      if (epoch === revealEpoch.current) setReading(false);
    }
  }
  const amount = total ? new Intl.NumberFormat(language === 'de' ? 'de-DE' : 'en-US', {
    style: 'currency', currency: total.currency, currencyDisplay: 'code',
  }).format(total.amountMinor / 100) : null;
  return <section className="panel concierge-card" aria-labelledby={id}>
    {rank?.status === 'loaded' && hasConciergeBadge(rank.rank) ? <ConciergeBadge rank={rank.rank}/> : <svg className="concierge-insignia" viewBox="0 0 68 68" fill="none" aria-hidden="true">
      <circle cx="34" cy="34" r="28" stroke="currentColor" strokeOpacity=".22" />
      <path d="M8 41a27 27 0 0 1 32-33m20 19a27 27 0 0 1-32 33" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M34 15l4.5 13.5L52 34l-13.5 4.5L34 53l-4.5-14.5L16 34l13.5-5.5L34 15Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx="34" cy="34" r="3" fill="currentColor" />
      <circle cx="55" cy="15" r="2" fill="currentColor" />
      <circle cx="13" cy="53" r="2" fill="currentColor" />
    </svg>}
    <div>
      <p className="concierge-eyebrow">RSI Concierge</p>
      <h2 id={id}>{rank?.status === 'loaded' ? rank.rank :
        t(rank?.status === 'no-rank' ? 'Kein Concierge-Rang' : 'Concierge-Rang')}</h2>
      {rank?.status === 'loaded' && rank.nextRank && <div className="concierge-progress">
        <div><span>{t('Richtung')} {rank.nextRank}</span>{rank.progress !== null && <strong>{rank.progress} %</strong>}</div>
        {rank.progress !== null && <progress value={rank.progress} max={100} aria-label={t('Richtung') + ' ' + rank.nextRank} />}
      </div>}
      {rank?.status !== 'loaded' && rank?.status !== 'no-rank' && <p className="concierge-status">
        {t(!accountId ? 'Ein RSI-Profil auswählen.' : rank?.status==='session-required' ? 'Eine gültige gespeicherte RSI-Sitzung ist erforderlich.'
          : rank?.status==='unavailable'&&rank.reason==='format' ? 'Die RSI-Concierge-Seite enthält keinen lesbaren Rang.'
          : busy||!rank ? 'RSI-Rang wird gelesen …' : 'RSI-Rang derzeit nicht verfügbar.')}
      </p>}
    </div>
    <div className="concierge-private">
      {amount
        ? <><strong className="concierge-amount">{amount}</strong><button type="button" onClick={clear}>{t('Summe ausblenden')}</button></>
        : <><button type="button" disabled={!accountId || reading || busy} onClick={() => dialog.current?.showModal()}>
          {t(reading ? 'Bestätigung läuft …' : 'Pledge-Summe anzeigen')}
        </button><p>{t('Mit Windows Hello freigeben')}</p></>}
      {notice && <p role="status">{t(notice)}</p>}
    </div>
    <dialog ref={dialog} className="concierge-dialog" aria-labelledby={id + '-question'}>
      <h2 id={id + '-question'}>{t('Pledge-Summe anzeigen?')}</h2>
      <p>{t('Bestätige die Anzeige mit Windows Hello.')}</p>
      <div className="actions">
        <button type="button" autoFocus onClick={() => dialog.current?.close()}>{t('Abbrechen')}</button>
        <button type="button" onClick={() => void reveal()}>{t('Mit Windows Hello bestätigen')}</button>
      </div>
    </dialog>
  </section>;
}
