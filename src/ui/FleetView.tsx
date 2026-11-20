import React, { useState } from 'react';
import type { StoreCredit } from '../domain/store-credit';
import { offersAreStale, type MarketSnapshot } from '../market/model';
import type { fleetScenarios } from '../planner/fleet';
import { DEFAULT_PRIORITIES } from '../planner/reservations';
import { shoppingList, shoppingPayments } from '../planner/shopping-list';
import type { PricingSnapshot } from '../pricing/model';
import { formatMinor } from '../pricing/money';
import { useText } from './i18n';
import { ShipPlaceholder } from './ShipPlaceholder';
import { vatLabel } from './vat-label';
import { planningRateLabel } from './planning-rate-label';
import './fleet.css';

type Comparison = ReturnType<typeof fleetScenarios>;

export function FleetView({ comparison, display, market, balance, budgetMinor, budgetReady, loading, catalogueMissing, error, saving, onApply, onOpenPlanner }: {
  comparison: Comparison; display: PricingSnapshot; market?: MarketSnapshot; balance?: StoreCredit;
  budgetMinor: number; budgetReady: boolean;
  loading: boolean; catalogueMissing: boolean; error: string; saving: boolean;
  onApply: (ids: (number | null)[], slot: number) => void; onOpenPlanner: () => void;
}) {
  const t = useText();
  const scopeId = React.useId();
  const { language, taxMode, vatBasisPoints } = display.settings;
  const [choice, setChoice] = useState('combined');
  const cases = comparison.cases.map(scenario => {
    const list = shoppingList(scenario.routes, DEFAULT_PRIORITIES, market?.offers?.items ?? [], market?.values,
      !!market && !offersAreStale(market), market?.shopPrices);
    return { ...scenario, list, payments: shoppingPayments(list, display, balance, budgetMinor) };
  });
  const selected = cases.find(scenario => scenario.key === choice) ?? cases.at(-1);
  const combined = cases.find(scenario => scenario.key === 'combined');
  const first = cases[0];
  const activeCombined = selected === combined && !!combined;
  const cash = (minor: number, currency: 'EUR' | 'USD', approximate: boolean) => (approximate ? '≈ ' : '') + formatMinor(minor, currency, language);
  const signed = (minor: number, currency: 'EUR' | 'USD') => (minor >= 0 ? '+ ' : '− ') + formatMinor(Math.abs(minor), currency, language);
  const credits = (minor: number, currency = balance?.currency ?? 'USD') => formatMinor(minor, currency, language);
  const tax = taxMode === 'gross' ? vatLabel(vatBasisPoints, language) : t('vor Steuer');
  const blocked = !selected || loading || catalogueMissing || !!selected.list.issues.length;

  return <section className="fleet-view" aria-labelledby="fleet-title">
    <header className="fleet-intro">
      <div><h1 id="fleet-title">{t('Flottenplan')}</h1><p>{t('Vergleiche den nötigen Zukauf für deine Zielschiffe.')}</p></div>
      <div className="fleet-budget"><small>{t('Store-Credit-Budget je Variante')}</small><strong>{balance && budgetReady ? credits(budgetMinor) : '—'}</strong></div>
    </header>
    {error && <p className="error" role="alert">{t(error)}</p>}
    {(loading || catalogueMissing || !cases.length) ? <div className="panel fleet-empty">
      <p role="status">{t(catalogueMissing ? 'Katalogzuordnung fehlt' : loading ? 'Planungsdaten werden geladen …' : 'Wähle zuerst deine Zielschiffe und LTI-Startbasen im CCU-Planer.')}</p>
      <button type="button" onClick={onOpenPlanner}>{t('Zum CCU-Planer')}</button>
    </div> : <>
      <div className="fleet-scenarios" data-count={cases.length} role="group" aria-label={t('Zielvarianten')}>
        {cases.map(scenario => {
          const multiple = scenario.routes.length > 1;
          const route = scenario.routes[0]!;
          const approved = route.plan?.base;
          const { list, payments } = scenario;
          const hasKnown = scenario.routes.length > list.issues.length && (!payments.rows.length || payments.rows.some(row => row.cash !== null));
          const title = multiple ? scenario.routes.map(target => target.name).join(' + ') : `${t('Nur')} ${route.name}`;
          const slotLabel = multiple
            ? t('Vorrang') + ' ' + scenario.routes.map(target => (target.slot + 1) + ' · ' + target.name).join(' → ')
            : t('Zielplatz') + ' ' + (route.slot + 1);
          const slotId = scopeId + '-' + scenario.key;

          return <button type="button" className="fleet-scenario panel" aria-label={title} aria-describedby={slotId} aria-pressed={selected === scenario}
            key={scenario.key} onClick={() => setChoice(scenario.key)}>
            <div className="fleet-art" data-ships={scenario.routes.length} aria-hidden="true">
              {scenario.routes.map((target, index) => <React.Fragment key={target.targetId}>
                {index > 0 && <span>+</span>}
                <ShipPlaceholder index={index}/>
              </React.Fragment>)}
            </div>
            <span className="fleet-info">
              <span className="fleet-title-group"><strong className="fleet-name">{title}</strong>
                <small id={slotId}>{slotLabel}{' · '}{multiple ? t('gemeinsames Budget')
                  : approved ? `${t('Startbasis')} ${approved.model.name} · LTI`
                  : t(route.noPricedRoute ? 'Kein Vorschlag mit vollständig berechenbaren Preisen.' : 'LTI-Startbasis selbst wählen')}</small></span>
              <span className="fleet-prices">
                <span><small>{t(payments.openCount || list.issues.length ? 'Bekanntes Frischgeld' : 'Frischgeld')}</small><strong className="fleet-cash">{hasKnown ? cash(payments.cashTotal, payments.cashCurrency, payments.approximate) : '—'}</strong></span>
                <span><small>Store Credits</small><strong className="fleet-credit">{hasKnown ? credits(payments.creditUsed, payments.creditCurrency) : '—'}</strong></span>
              </span>
              <span className="fleet-card-status"><span>{list.issues.length ? t('Kette prüfen') : `${list.items.length} ${t('fehlende CCUs')}`}</span>
                <span className={payments.openCount || list.issues.length ? 'fleet-open' : undefined}>{list.issues.length ? t('Preisstand offen')
                  : `${payments.openCount} ${t(payments.openCount === 1 ? 'Preis offen' : 'Preise offen')}`}</span></span>
            </span>
          </button>;
        })}
      </div>
      {activeCombined && first && <section className="panel fleet-comparison" aria-label={t('Vorrang und Mehrkosten')}>
        <div>
          <h2>{t('So wird der Bestand bei mehreren Zielen verteilt')}</h2>
          {comparison.assignments.length === 0 && <p>{t('Kein gemeinsam benötigtes Exemplar erkannt.')}</p>}
          {comparison.assignments.map(({ target, shared, route }) => {
            const replacement = route.plan?.steps.find(step => step.kind === 'owned' && !target.plan?.steps.some(solo => solo.ccu?.key === step.ccu?.key));
            return <div key={target.targetId}>
              <p>{shared.map(resource => <span key={resource.key} className="fleet-resource"><strong>{resource.label}</strong> {t('geht an')} {resource.winner.name} ({t('Vorrang')} {resource.winner.rank})</span>)}</p>
              {combined.list.issues.some(issue => issue.target === target.name) ? <p>{target.name} · {t('Kette prüfen')}</p>
                : <details><summary>{t('Ersatzweg')} · {target.name}{replacement && ` · ${replacement.from.name} → ${replacement.to.name}`}</summary>
                  <p>{[route.plan?.base?.model.name, ...(route.plan?.steps.map(step => step.to.name) ?? [])].filter(Boolean).join(' → ')}</p></details>}
            </div>;
          })}
        </div>
        <div className="fleet-difference">
          <h2>{t('Zusätzlich zu')} {first.routes[0]!.name}</h2>
          {combined.list.issues.length || first.list.issues.length || combined.payments.openCount || first.payments.openCount ? <p>{t('Mehrkosten offen · Kette prüfen')}</p> : <>
            <strong>≈ {signed(combined.payments.cashTotal - first.payments.cashTotal, combined.payments.cashCurrency)} {t('Frischgeld')}
              {' · '}{signed(combined.payments.creditUsed - first.payments.creditUsed, combined.payments.creditCurrency)} Store Credits</strong>
            <p>{t('Bekannter Zukauf')}{combined.payments.openCount > 0 && <> · {combined.payments.openCount} {t(combined.payments.openCount === 1 ? 'Preis offen' : 'Preise offen')}</>}</p>
          </>}
        </div>
      </section>}
      <div className="fleet-next"><p>{t('Frischgeld')} {tax}. {t('Offene Preise fehlen in den Summen.')}
        {(display.settings.currency==='EUR'||selected?.payments.convertedCredit)&&<> {planningRateLabel(display)}.</>}
        {balance && !selected?.payments.canUseCredit && <> {t('Für das EUR-Guthaben fehlt ein aktueller Wechselkurs.')}</>}</p>
        <button type="button" className="primary" disabled={blocked || saving} onClick={() => {
          if (blocked || !selected) return;
          onApply(DEFAULT_PRIORITIES.map(slot => selected.routes.find(route => route.slot === slot)?.targetId ?? null), selected.routes[0]!.slot);
        }}>{t('Variante übernehmen')}</button></div>
    </>}
  </section>;
}
