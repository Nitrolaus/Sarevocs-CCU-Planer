import React, { useEffect, useState } from 'react';
import type { Pledge } from '../domain/model';
import type { UpgradeHistoryResult } from '../domain/upgrade-history';
import { pricedUpgradeSteps, sameHistoryModelName } from '../domain/applied-ccu-price';
import type { MarketSnapshot } from '../market/model';
import { historyCosts } from '../pricing/history-costs';
import type { PricingSnapshot } from '../pricing/model';
import { formatMinor } from '../pricing/money';
import { ChainHistoryResult } from './ChainHistoryResult';
import { ChainLink } from './ChainLink';
import { useText } from './i18n';
import './chain-history.css';

type HistoryEntry = { pledge: Pledge; result: UpgradeHistoryResult };
type ReadState = { entries: HistoryEntry[]; checked: number; blocked: boolean };
const initial: ReadState = { entries: [], checked: 0, blocked: false };

function dateLabel(at: string, language: 'de' | 'en'): string {
  const [year, month, day, hour, minute] = at.split(/[- :]/);
  return (language === 'de' ? `${day}.${month}.${year}` : `${year}-${month}-${day}`) + ` · ${hour}:${minute}`;
}

export function ChainHistory({ pledges, read, purchases, market, display }: {
  pledges: readonly Pledge[];
  read: (pledge: Pledge) => Promise<UpgradeHistoryResult>;
  purchases: ReadonlyMap<string, Pledge>;
  market?: MarketSnapshot;
  display: PricingSnapshot;
}) {
  const t = useText();
  const catalogue = market?.catalogue?.ships ?? [];
  const { language } = display.settings;
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
      const steps = pricedUpgradeSteps(result.steps, purchases, catalogue, result.purchases);
      const summary = historyCosts(pledge, steps, result.partial, display, market);
      const title = pledge.ships.length === 1 ? pledge.ships[0]!.modelName : pledge.name;
      return <section key={pledge.pledgeId} className="chain-history-row" aria-label={title}>
        <header><h3>{title}</h3><span>{t(steps.length === 1 ? '{count} angewendetes CCU' : '{count} angewendete CCUs').replace('{count}', String(steps.length))}</span></header>
        {result.partial && <p className="chain-history-status">{t('RSI-Protokoll unvollständig.')}</p>}
        <ol className="chain-history-rail" tabIndex={0} aria-label={t('Baudatum, älteste Schritte zuerst')}>
          {steps.map(({ step, price }, index) => {
            const previous = steps[index - 1]?.step;
            return <li key={index}>
              {previous && <span className="chain-history-link" aria-hidden="true">
                <ChainLink label="" broken={!sameHistoryModelName(previous.to, step.from, catalogue) || !previous.appliedAt || !step.appliedAt} />
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
                  {price?.status === 'documented' ? <strong>{formatMinor(price.minor, price.currency, language)}</strong> : <span>{t('Preis offen')}</span>}
                </div>
              </article>
            </li>;
          })}
          <li>
            <span className="chain-history-link" aria-hidden="true"><ChainLink label="" broken={!summary.target} /></span>
            <ChainHistoryResult summary={summary} settings={display.settings} />
          </li>
        </ol>
      </section>;
    })}
  </div>;
}
