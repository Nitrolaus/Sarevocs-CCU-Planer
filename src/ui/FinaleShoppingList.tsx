import React, { useMemo, useState } from 'react';
import type { StoreCredit } from '../domain/store-credit';
import { offersAreStale, type MarketSnapshot } from '../market/model';
import type { PriorityOrder, ReservationTarget } from '../planner/reservations';
import { shoppingList, shoppingPayments } from '../planner/shopping-list';
import { formatMinor } from '../pricing/money';
import type { PricingSnapshot } from '../pricing/model';
import { useText } from './i18n';
import { vatLabel } from './vat-label';
import { planningRateLabel } from './planning-rate-label';
import './shopping-list.css';

export function FinaleShoppingList({ targets, order, market, display, balance, ready,
  budgetMinor, budgetEditable, budgetError, budgetCurrencyChanged, onBudget }: {
  targets: readonly ReservationTarget[]; order: PriorityOrder; market?: MarketSnapshot; display: PricingSnapshot;
  balance?: StoreCredit; ready: boolean; budgetMinor: number; budgetEditable: boolean; budgetError: string;
  budgetCurrencyChanged: boolean; onBudget: (minor: number) => void;
}) {
  const t = useText();
  const [budget, setBudget] = useState<string | null>(null);
  const [linkFailed, setLinkFailed] = useState(false);
  const { language, taxMode, vatBasisPoints } = display.settings;
  const current = !!market && !offersAreStale(market);
  const list = useMemo(() => shoppingList(ready ? targets : [], order, market?.offers?.items ?? [], market?.values, current, market?.shopPrices),
    [targets, order, market?.offers, market?.values, market?.shopPrices, current, ready]);
  const available = balance?.minor ?? 0;
  const requested = budget === null ? budgetMinor : Math.max(0, Math.min(available, Math.round(Number(budget) * 100) || 0));
  const result = shoppingPayments(list, display, balance, requested);
  const hasPlan = ready && targets.length > list.issues.length;
  const hasCash = hasPlan && (!result.rows.length || result.rows.some(row => row.cash !== null));
  const priority = order.map(slot => targets.find(target => target.slot === slot)?.name).filter(Boolean).join(' → ');
  const creditMoney = (minor: number) => formatMinor(minor, result.creditCurrency, language);
  const cashMoney = (minor: number) => formatMinor(minor, result.cashCurrency, language);
  const cashDisplay = (minor: number, approximate: boolean) => (minor > 0 && approximate ? '≈ ' : '') + cashMoney(minor);
  const taxLabel = taxMode === 'gross' ? vatLabel(vatBasisPoints, language) : t('vor Steuer');
  const rows = [...result.rows.filter(row => row.price.kind === 'warbond'), ...result.rows.filter(row => row.price.kind !== 'warbond')];
  const seenAt = balance && new Intl.DateTimeFormat(language === 'de' ? 'de-DE' : 'en-GB', {
    dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Berlin',
  }).format(new Date(balance.observedAt));

  async function openRules() {
    setLinkFailed(false);
    try {
      const response = await window.ccu.request({ action: 'help.openRsi', topic: 'storeCredit' });
      if (!response.ok) setLinkFailed(true);
    } catch { setLinkFailed(true); }
  }

  return <section className="finale-shopping panel" aria-labelledby="finale-shopping-title">
    <header className="shopping-head">
      <div><h2 id="finale-shopping-title">{t('Einkaufsliste fürs Messefinale')}</h2>
        {priority && <p>{t('Vorrang')}: {priority}</p>}</div>
      <div className="shopping-budget">
        <label htmlFor="shopping-credit-budget">{t('Store Credits einplanen')}</label>
        <input id="shopping-credit-budget" type="number" min="0" step="0.01" max={available / 100} disabled={!budgetEditable || !result.canUseCredit}
          value={budget ?? (budgetMinor / 100).toFixed(2)} aria-describedby="shopping-credit-available"
          onChange={event => setBudget(event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}
          onBlur={() => { if (budget !== null) { onBudget(requested); setBudget(null); } }} />
        <span>{result.creditCurrency}</span>
        <small id="shopping-credit-available" title={seenAt || undefined} role={budgetError ? 'alert' : undefined}>{budgetError ? t(budgetError)
          : budgetCurrencyChanged ? t('Währung des Guthabens hat sich geändert. Budget neu eingeben.')
          : balance ? t('Zuletzt gelesenes Guthaben') + ': ' + creditMoney(available) : t('Noch kein Store-Credit-Guthaben gelesen.')}</small>
      </div>
    </header>
    <div className="shopping-totals" aria-live="polite">
      <div><small>{t(result.openCount || list.issues.length ? 'Bekanntes Frischgeld' : 'Frischgeld')}</small><output className="shopping-cash-total">{hasCash ? cashDisplay(result.cashTotal, result.approximate) : '—'}</output><span>{taxLabel}</span></div>
      <div><small>{t('Store Credits eingesetzt')}</small><output className="shopping-credit-total">{creditMoney(result.creditUsed)}</output>
        {balance && <span>{creditMoney(result.creditLeft)} {t('übrig')}</span>}</div>
      <div><small>{t('Offene Preise')}</small><output className="shopping-open-total">{hasPlan ? `${result.openCount} CCU${result.openCount === 1 ? '' : 's'}` : '—'}</output>
        {result.openCount > 0 && <span>{t('Fehlen in den Summen')}</span>}</div>
    </div>
    {!ready && targets.length > 0 && <p className="shopping-note" role="status">{t('Planungsdaten werden geladen …')}</p>}
    {ready && !targets.length && <p className="shopping-note">{t('Wähle ein Zielschiff und eine Startbasis.')}</p>}
    {list.issues.map(({ target, reason }) => <p key={target} className="shopping-issue" role="status"><strong>{target}</strong> · {t({
      base: 'Planung ohne verfügbare Startbasis', 'no-priced-route': 'Kein Vorschlag mit vollständig berechenbaren Preisen.',
      conflict: 'Kettenkonflikt · Zukauf bleibt offen', invalid: 'Kette prüfen · Zukauf bleibt offen',
    }[reason])}</p>)}
    {rows.length > 0 && <table className="shopping-table" aria-label={t('Benötigte CCUs')}>
      <thead><tr><th scope="col">CCU / {t('Status')}</th><th scope="col">{t('Zielkette')}</th><th scope="col">{t('Frischgeld')}</th><th scope="col">Store Credits</th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.key} data-kind={row.price.kind}>
        <td><strong>{row.from} → {row.to}</strong><small className={'shopping-type shopping-' + row.price.kind}>{t({
          warbond: 'Warbond · heute prüfen', standard: 'Standard-CCU · Richtwert', open: 'Shoppreis offen',
        }[row.price.kind])}</small></td>
        <td>{row.target}</td><td className="shopping-cash">{row.cash === null ? t('offen') : cashDisplay(row.cash,!row.exact)}
          {row.exact && <small>{t('RSI-Shoppreis')}</small>}</td>
        <td className="shopping-credit">{row.credit === null ? t('offen') : row.credit > 0 ? creditMoney(row.credit) : '—'}</td>
      </tr>)}</tbody>
    </table>}
    {hasPlan && !rows.length && <p className="shopping-note">{t('Für die ausgewerteten Ketten ist kein Zukauf nötig.')}</p>}
    {list.owned.length > 0 && <div className="shopping-owned"><strong>{t('Bereits eingeplant')}</strong>
      {list.owned.map(group => <span key={group.target} title={group.steps.map(step => step.from + ' → ' + step.to).join('\n')}>
        {group.target} · {group.steps.length} CCU{group.steps.length === 1 ? '' : 's'}
      </span>)}</div>}
    <p className="shopping-note">{t('Kaufbarkeit und Endbetrag bei RSI prüfen.')}
      {' '}{t('MwSt. fällt auf Frischgeld an.')}{' '}
      {(display.settings.currency==='EUR'||result.convertedCredit)&&<>{planningRateLabel(display)}.{' '}</>}
      {balance && !result.canUseCredit && <>{t('Für das EUR-Guthaben fehlt ein aktueller Wechselkurs.')}{' '}</>}
      <button className="shopping-rules" type="button" onClick={() => void openRules()}>{t('RSI-Zahlungsregeln')} ↗</button>
    </p>
    {linkFailed && <p className="shopping-issue" role="alert">{t('Die RSI-Hilfeseite konnte nicht geöffnet werden.')}</p>}
  </section>;
}
