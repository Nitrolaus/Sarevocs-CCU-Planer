import React from 'react';
import type { HangarRefreshProgress } from '../importers/hangar-read';
import { useText } from './i18n';

export function HangarProgress({ progress, hasInventory }: {
  progress?: HangarRefreshProgress;
  hasInventory: boolean;
}) {
  const t = useText();
  const pages = progress?.pagesRead ?? 0;
  const total = progress?.totalPages;
  const heading = t(!progress ? 'Verbindung wird geprüft …' : progress.phase === 'reading'
    ? 'Hangar wird gelesen' : 'Bestand wird geprüft');
  return <section className="hangar-progress" aria-label={heading}>
    <div className="hangar-progress-heading">
      <strong>{heading}</strong>
      {progress && <span>{total ? `${Math.min(pages, total)} ${t('von')} ${total} ${t('Seiten')}`
        : `${pages} ${t('Seiten gelesen')}`}</span>}
    </div>
    <progress aria-label={heading} max={total ?? 1}
      value={total ? Math.min(pages, total) : progress?.phase === 'finishing' ? 1 : undefined} />
    <div className="hangar-progress-detail">
      {progress && <span aria-live="off">{progress.pledgesRead} {t('Einträge gelesen')}</span>}
      {hasInventory && <span>{t('Dein bisheriger Bestand bleibt sichtbar.')}</span>}
    </div>
    {progress?.waiting && <p className="hangar-wait" role="status">
      {t('RSI antwortet vorübergehend langsam.')} {t('Seite')} {progress.page} {t('wird erneut versucht.')}
    </p>}
  </section>;
}
