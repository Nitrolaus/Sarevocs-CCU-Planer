import React, { useEffect, useState } from 'react';
import type { Pledge } from '../domain/model';
import type { UpgradeHistoryResult, UpgradeHistoryStep } from '../domain/upgrade-history';
import { appliedCcuPrice } from '../domain/applied-ccu-price';
import type { CatalogueShip } from '../market/model';
import { sameModelName } from '../market/ship-values';
import { formatMinor } from '../pricing/money';
import { ChainLink } from './ChainLink';
import { useText } from './i18n';
import './chain-history.css';

type HistoryEntry = { pledge: Pledge; result: UpgradeHistoryResult };
type ReadState = { entries: HistoryEntry[]; checked: number; blocked: boolean };
const initial: ReadState = { entries: [], checked: 0, blocked: false };

function byBuildDate(a: UpgradeHistoryStep, b: UpgradeHistoryStep): number {
  if (a.appliedAt === b.appliedAt) return 0;
  if (!a.appliedAt) return 1;
  if (!b.appliedAt) return -1;
  return a.appliedAt.localeCompare(b.appliedAt);
}

function dateLabel(at: string, language: 'de' | 'en'): string {
  const [year, month, day, hour, minute] = at.split(/[- :]/);
  return (language === 'de' ? `${day}.${month}.${year}` : `${year}-${month}-${day}`) + ` · ${hour}:${minute}`;
}

export function ChainHistory({ pledges, read, purchases, catalogue, language }: {
  pledges: readonly Pledge[];
  read: (pledge: Pledge) => Promise<UpgradeHistoryResult>;
  purchases: ReadonlyMap<string, Pledge>;
  catalogue: readonly CatalogueShip[];
  language: 'de' | 'en';
}) {
  const t = useText();
  const [view, setView] = useState(initial);
  useEffect(() => {
    let active = true;
    setView(initial);
    async function load() {
      for (const [index, pledge] of pledges.entries()) {
        const result = await read(pledge);
        if (!active) return;
        const blocked = result.status !== 'loaded';
        setView(previous => ({
          entries: result.steps.length ? [...previous.entries, { pledge, result }] : previous.entries,
          checked: blocked ? index : index + 1,
          blocked,
        }));
        if (blocked) return;
      }
    }
    void load();
    return () => { active = false; };
  }, [pledges, read]);

  if (!pledges.length) return <p className="chain-history-status" role="status">{t('Für die Kettenbauhistorie wird ein aktuell gelesener RSI-Hangar benötigt.')}</p>;
  const status = view.blocked ? t('Weitere RSI-Protokolle konnten nicht geladen werden.')
    : view.checked < pledges.length ? t('RSI-Protokolle werden gelesen …')
    : view.entries.length === 0 ? t('In den gelesenen RSI-Protokollen wurden keine angewendeten CCUs gefunden.') : '';
  return <div className="chain-history" role="tabpanel" aria-label={t('Kettenbauhistorie')}>
    {status && <p className="chain-history-status" role="status">{status}{view.checked < pledges.length && <> {view.checked}/{pledges.length}</>}</p>}
    {view.entries.map(({ pledge, result }) => {
      const steps = [...result.steps].sort(byBuildDate);
      const title = pledge.ships.length === 1 ? pledge.ships[0]!.modelName : pledge.name;
      return <section key={pledge.pledgeId} className="chain-history-row" aria-label={title}>
        <header><h3>{title}</h3><span>{t(steps.length === 1 ? '{count} angewendetes CCU' : '{count} angewendete CCUs').replace('{count}', String(steps.length))}</span></header>
        {result.partial && <p className="chain-history-status">{t('RSI-Protokoll unvollständig.')}</p>}
        <ol className="chain-history-rail" tabIndex={0} aria-label={t('Baudatum, älteste Schritte zuerst')}>
          {steps.map((step, index) => {
            const previous = steps[index - 1];
            const price = appliedCcuPrice(step, purchases, catalogue);
            return <li key={index}>
              {previous && <span className="chain-history-link" aria-hidden="true">
                <ChainLink label="" broken={!sameModelName(previous.to, step.from, catalogue) || !previous.appliedAt || !step.appliedAt} />
              </span>}
              <article className="chain-history-card">
                <div className="chain-history-date">
                  <span>{t('Gebaut am')}</span>
                  {step.appliedAt
                    ? <time dateTime={step.appliedAt.replace(' ', 'T')}>{dateLabel(step.appliedAt, language)}</time>
                    : <strong>{t('Datum offen')}</strong>}
                </div>
                <dl><dt>{t('Von')}</dt><dd>{step.from}</dd><dt>{t('Nach')}</dt><dd>{step.to}</dd></dl>
                <div className="chain-history-price"><span>{t('Kaufpreis')}</span>
                  {price ? <strong>{formatMinor(price.minor, price.currency, language)}</strong> : <span>{t('Preis offen')}</span>}
                </div>
              </article>
            </li>;
          })}
        </ol>
      </section>;
    })}
  </div>;
}
