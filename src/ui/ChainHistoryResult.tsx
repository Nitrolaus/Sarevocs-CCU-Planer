import React from 'react';
import type { historyCosts } from '../pricing/history-costs';
import type { DisplaySettings } from '../pricing/model';
import { formatMinor } from '../pricing/money';
import { useText } from './i18n';

function LaurelCheck() {
  const branch = <>
    <path d="M30 54C15 50 8.5 35 13 16" fill="none" stroke="#ba9653" strokeWidth="1.75" strokeLinecap="round" />
    <path d="M14 23C8 17 11 10 15 7c3 6 2 12-1 16Zm-2 9C5 29 3 24 4 18c6 2 10 7 8 14Zm2 9C7 40 3 36 3 30c6 0 12 4 11 11Zm5 8c-8 1-13-3-15-8 7-2 14 2 15 8Zm8 4c-6 4-13 3-17-2 6-4 13-3 17 2Z" fill="currentColor" />
    <path d="M14 32c-2-7 1-12 6-14 2 6 0 11-6 14Zm3 9c-3-6-1-12 3-15 4 5 2 12-3 15Zm6 8c-4-6-4-11 0-15 4 3 5 10 0 15Z" fill="currentColor" opacity=".86" />
  </>;
  return <svg className="chain-history-crest" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
    <g>{branch}</g>
    <g transform="translate(64 0) scale(-1 1)">{branch}</g>
    <path className="chain-history-check" d="m23 32 6 6 13-15" fill="none" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

export function ChainHistoryResult({ summary, settings }: {
  summary: ReturnType<typeof historyCosts>; settings: DisplaySettings;
}) {
  const t = useText();
  const { start, target, normal, paid, approximate, knownMinor, difference, percentage } = summary;
  const money = (minor: number, estimate = false) =>
    (estimate ? '≈ ' : '') + formatMinor(minor, settings.currency, settings.language);

  return <article className="chain-history-card chain-history-result" aria-label={t('Kettenergebnis')}>
    <div className="chain-history-result-heading"><h3>{t('Kettenergebnis')}</h3>{target && <LaurelCheck />}</div>
    <dl className="chain-history-route">
      <div><dt>{t('Start')}</dt><dd>{start ?? t('Offen')}</dd></div>
      <div><dt>{t('Ziel')}</dt><dd>{target ?? t('Offen')}</dd></div>
    </dl>
    <dl className="chain-history-totals">
      <div title={t('Aktueller RSI-Standardwert des Zielschiffs als Richtwert inklusive Mehrwertsteuer.')}>
        <dt>{t('Normalpreis bei RSI')}</dt><dd>{normal === null ? t('Preis offen') : money(normal, true)}</dd>
      </div>
      <div title={t('Startschiff und angewendete CCUs mit zugeordnetem RSI-Bestellpreis.')}>
        <dt>{t('Gesamtkosten')}</dt><dd>{paid === null ? t('Preis offen') : money(paid, approximate)}</dd>
      </div>
      {paid === null && knownMinor > 0 && <div className="chain-history-subtotal"><dt>{t('Davon belegt')}</dt><dd>{money(knownMinor, approximate)}</dd></div>}
      <div className="chain-history-saving" data-saving={difference !== null && difference > 0}>
        <dt>{t(difference !== null && difference < 0 ? 'Mehrkosten' : 'Ersparnis')}</dt>
        <dd>{difference === null ? t('Offen') : <>{money(Math.abs(difference), true)}{percentage !== null && <small> {percentage} %</small>}</>}</dd>
      </div>
    </dl>
  </article>;
}
