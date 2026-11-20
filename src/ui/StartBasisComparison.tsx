import React, { useId, useState } from 'react';
import type { Buyback, BuybackObservation } from '../domain/model';
import type { StoreCredit } from '../domain/store-credit';
import type { CatalogueShip, MarketSnapshot } from '../market/model';
import type { ChainBase, ChainPool } from '../planner/chain';
import type { ResourceClaim } from '../planner/reservations';
import { buybackBase, startBasisRoute } from '../planner/start-basis-comparison';
import type { PricingSnapshot } from '../pricing/model';
import { formatMinor } from '../pricing/money';
import { useText } from './i18n';
import './start-basis-comparison.css';

type Props = {
  target: CatalogueShip; base: ChainBase | null; pool: ChainPool; blocked: readonly ResourceClaim[];
  market: MarketSnapshot; display: PricingSnapshot; ready: boolean; budgetMinor: number; balance?: StoreCredit;
  entries: readonly Buyback[]; observation?: BuybackObservation;
};
type Route = ReturnType<typeof startBasisRoute>;

export function StartBasisComparison(props: Props) {
  const t = useText();
  const id = useId();
  const [open, setOpen] = useState(false), [selected, setSelected] = useState('');
  const { target, base, entries, market, display, ready, balance, budgetMinor, observation } = props;
  const { language, taxMode, vatBasisPoints } = display.settings;
  const options = open ? entries.flatMap(entry => {
    const candidate = buybackBase(entry, market);
    return candidate ? [{ entry, candidate }] : [];
  }) : [];
  const choice = options.find(({ entry }) => entry.entryId === selected);
  const hangar = open && ready && base ? startBasisRoute({ ...props, base }) : null;
  const buyback = open && ready && choice
    ? startBasisRoute({ ...props, base: choice.candidate, buyback: choice.entry }) : null;
  const token = observation?.current ? observation.token : 'unknown';
  const left = hangar?.payment, right = buyback?.payment;
  const cashDelta = left && right && !left.openCount && !right.openCount && left.cashCurrency === right.cashCurrency
    ? right.cashTotal - left.cashTotal : null;
  const gapDelta = hangar && buyback ? buyback.plan.gapCount - hangar.plan.gapCount : null;

  function money(value: number, currency: 'EUR' | 'USD') {
    return formatMinor(value, currency, language);
  }

  function comparisonCard(kind: 'Hangar' | 'Buy Back', model: ChainBase | null | undefined, route: Route, entry?: Buyback) {
    const paid = route?.payment, missing = route?.plan.steps.filter(step => step.kind !== 'owned') ?? [];
    const owned = route?.plan.steps.filter(step => step.kind === 'owned') ?? [];
    return <article className="start-basis-card" aria-label={t(kind)}>
      <header>
        <p>{t(kind)}</p>
        <h3>{model ? model.model.name : t(kind === 'Hangar' ? 'Hangarbasis wählen' : 'Buy-Back-Basis wählen')} {model && <span className="badge">LTI</span>}</h3>
        {model && <small>{kind === 'Hangar' ? t('Bereits im Bestand') : <>
          {t('Rückkauf')} {entry?.currentPrice ? money(entry.currentPrice.minor, entry.currentPrice.currency) : t('Offen')}
          {' · '}{t(token === 'available' ? 'Token verfügbar' : token === 'unavailable' ? 'Kein Token verfügbar' : 'Tokenstatus offen')}
        </>}</small>}
      </header>
      {route ? <>
        <div className="start-basis-missing">
          <h4>{missing.length} {t(missing.length === 1 ? 'fehlender CCU' : 'fehlende CCUs')}</h4>
          <ul>{missing.map(step => {
            const purchase = route.purchases.find(row => row.from === step.from.name && row.to === step.to.name);
            return <li key={step.key}><span>{step.from.name} → {step.to.name}</span>
              <span>{purchase && 'usdMinor' in purchase.price ? money(purchase.price.usdMinor, 'USD') : t('Offen')}</span></li>;
          })}</ul>
        </div>
        <details><summary>{owned.length} {t(owned.length === 1 ? 'vorhandener CCU' : 'vorhandene CCUs')}</summary>
          <ul>{owned.map(step => <li key={step.key}>{step.from.name} → {step.to.name}</li>)}</ul>
        </details>
      </> : model && <p className="start-basis-note">{t(ready ? 'Keine verwendbare Kette für diese Basis gefunden.' : 'Vergleichsdaten werden geladen …')}</p>}
      <dl className="start-basis-cost">
        <div><dt>{t('Frischgeld')}</dt><dd>{paid && !paid.openCount ? '≈ ' + money(paid.cashTotal, paid.cashCurrency) : t('Offen')}</dd></div>
        <div><dt>{t('Store Credits')}</dt><dd>{paid && paid.canUseCredit && !paid.openCount ? money(paid.creditUsed, paid.creditCurrency) : t('Offen')}</dd></div>
      </dl>
    </article>;
  }

  return <details className="start-basis-comparison" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>{t('Startbasis vergleichen')} · {target.name}</summary>
    {open && <>
      <div className="start-basis-controls">
        <label htmlFor={id}>{t('Buy-Back-Basis')}</label>
        <select id={id} value={choice?.entry.entryId ?? ''} onChange={event => setSelected(event.target.value)} disabled={!options.length}>
          <option value="">{t(options.length ? 'Buy-Back-Basis wählen' : 'Keine eindeutige LTI-Basis in Buy Back')}</option>
          {options.map(({ entry, candidate }) => <option key={entry.entryId} value={entry.entryId}>{candidate.model.name} · {entry.name}</option>)}
        </select>
      </div>
      <div className="start-basis-cards">
        {comparisonCard('Hangar', base, hangar)}
        {comparisonCard('Buy Back', choice?.candidate, buyback, choice?.entry)}
      </div>
      {(cashDelta !== null || gapDelta !== null) && <p className="start-basis-result" aria-live="polite">
        {cashDelta !== null && cashDelta !== 0 && left && <strong>{t(cashDelta > 0 ? 'Hangar spart' : 'Buy Back spart')} {money(Math.abs(cashDelta), left.cashCurrency)} {t('Frischgeld')}.</strong>}
        {cashDelta === 0 && <strong>{t('Gleicher Frischgeldbedarf')}.</strong>}
        {gapDelta !== null && gapDelta !== 0 && <span>{t(gapDelta < 0 ? 'Buy Back benötigt weniger CCUs' : 'Hangar benötigt weniger CCUs')} ({Math.abs(gapDelta)}).</span>}
      </p>}
      <p className="start-basis-note">{t('Richtwerte · Kaufbarkeit ungeprüft')}{' · '}
        {taxMode === 'gross' ? t('inkl. {rate} % MwSt.').replace('{rate}', String(vatBasisPoints / 100)) : t('vor Steuern')}
        {balance && <> · {t('Budget je Variante')} {money(budgetMinor, balance.currency)}</>}
      </p>
      {choice && token !== 'available' && <p className="start-basis-note">{t('Rückkauf als Frischgeld angesetzt')}</p>}
      {!balance && (hangar || buyback) && <p className="start-basis-note">{t('Guthaben offen · als Frischgeld gerechnet')}</p>}
    </>}
  </details>;
}
