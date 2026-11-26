import React, { useEffect, useMemo, useState } from 'react';
import type { CatalogueShip, MarketSnapshot } from '../market/model';
import { offersAreStale } from '../market/model';
import type { OwnedCcu } from '../planner/chain';
import type { Reservations } from '../planner/reservations';
import { outgoingWarbondCandidates, outgoingWarbondQuote, outgoingWarbondStock } from '../planner/outgoing-warbonds';
import type { PricingSnapshot } from '../pricing/model';
import { displayShopMinor, euroRateIsStale, formatMinor } from '../pricing/money';
import type { ShopAmount } from '../market/shop-prices';
import type { PlannerInventory } from './ChainBuilder';
import { useShopPricePairs } from './useShopPrices';
import { useText } from './i18n';

export function OutgoingWarbonds({ from, accountId, inventory, ccus, excluded, reservations, reservationsReady,
  market, display }: { from?: CatalogueShip; accountId: string | null; inventory: PlannerInventory | null;
  ccus: readonly OwnedCcu[]; excluded: readonly string[]; reservations: Reservations; reservationsReady: boolean;
  market?: MarketSnapshot; display: PricingSnapshot }) {
  const t = useText();
  const [now, setNow] = useState(Date.now);
  const [error, setError] = useState(false);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1500); return () => clearInterval(timer); }, []);
  useEffect(() => {
    setError(false);
    if (!from || !accountId) return;
    const check = () => { void window.ccu.request({ action: 'market.checkOffers' }).catch(() => {}); };
    check();
    const timer = setInterval(check, 5 * 60_000);
    return () => clearInterval(timer);
  }, [accountId, from?.id]);
  const candidates = useMemo(() => outgoingWarbondCandidates(from, market, now), [from, market, now]);
  const pairs = useMemo(() => candidates.map(({ fromId, toId }) => ({ fromId, toId })), [candidates]);
  useShopPricePairs(pairs, true);
  const quotes = candidates.flatMap(candidate => {
    const quote = outgoingWarbondQuote(candidate, market?.shopPrices ?? [], display.settings.currency, now);
    if (!quote?.saving || quote.saving.minor <= 0) return [];
    const stock = outgoingWarbondStock(candidate, { catalogue: market?.catalogue?.ships ?? [],
      pledges: inventory?.accountId === accountId ? inventory.pledges : [], ccus,
      inventoryKnown: !!inventory && inventory.accountId === accountId, complete: inventory?.complete === true,
      reservations, reservationsReady, excluded });
    // Ownership includes copies reserved for another target or explicitly locked by the user.
    return stock.state === 'missing' ? [{ candidate, stock, ...quote }] : [];
  });
  const freshRate = display.rate && !euroRateIsStale(display.rate, now) ? display.rate : null;
  function money(amount: ShopAmount) {
    const minor = displayShopMinor(amount, display.settings, freshRate);
    return minor === null ? formatMinor(amount.minor, amount.currency, display.settings.language)
      : (amount.currency !== display.settings.currency ? '≈ ' : '') + formatMinor(minor, display.settings.currency, display.settings.language);
  }
  async function openShop() {
    try { const result = await window.ccu.request({ action: 'market.openUpgrades' }); setError(!result.ok); }
    catch { setError(true); }
  }
  return <div className="outgoing-warbonds" aria-labelledby="outgoing-warbonds-title">
    <div className="outgoing-head"><h3 id="outgoing-warbonds-title">{t('Warbond-Angebote ab')} {from?.name ?? '—'} · {t('Schiff 1')}</h3>
      <small>{t('Nur kaufbare Warbond-CCUs mit Rabatt, die dir noch fehlen')}</small></div>
    {quotes.length > 0 ? <div className="outgoing-scroll"><table className="outgoing-table" aria-label={t('Passende Warbond-CCUs')}>
      <thead><tr><th>{t('Upgrade')}</th><th>{t('CCU-Preis')}</th><th>{t('Warbond-Rabatt')}</th><th>{t('Bestandsstatus')}</th><th>{t('Aktion')}</th></tr></thead>
      <tbody>{quotes.map(({ candidate, stock, price, saving }) => {
        const tax = price.amount.taxMode === 'gross' ? `${t('inkl.')} ${price.amount.vatBasisPoints / 100} % ${t('MwSt.')}` : t('vor Steuer');
        return <tr key={candidate.toId} className="outgoing-purchase">
          <td><strong>{from?.name} → {candidate.target.name}</strong><small className="outgoing-warbond-label">Warbond-CCU</small></td>
          <td><strong>{money(price.amount)}</strong><small title={t('Geprüfter RSI-Shoppreis')}>{tax}</small></td>
          <td>{saving ? <strong>{money(saving)}</strong> : <small>{t('Rabatt nicht beziffert')}</small>}</td>
          <td><strong className="outgoing-stock">{t('Noch nicht gekauft')}</strong>
            {stock.consumed > 0 && <small>{stock.consumed} {t('bereits verbraucht · nicht frei')}</small>}
          </td>
          <td><button onClick={() => void openShop()}>{t('Im Shop ansehen ↗')}</button></td>
        </tr>;
      })}</tbody>
    </table></div> : <p className="outgoing-status" role="status">{t(!from ? 'Wähle Schiff 1, um passende Warbond-CCUs zu prüfen.'
      : !market || market.pending ? 'Angebote und CCU-Preise werden automatisch geprüft …'
      : offersAreStale(market, now) ? 'Angebotsstand veraltet. Aktuelle Warbonds sind nicht bestätigt.'
      : !inventory || inventory.accountId !== accountId || !inventory.complete || !reservationsReady ? 'Zuerst den Bestand vollständig einlesen. Bereits vorhandene CCUs werden nicht angeboten.'
      : 'Aktuell keine bestätigten Warbond-CCUs mit Rabatt gefunden, die dir noch fehlen.')}</p>}
    {error && <p role="alert">{t('RSI-Seite konnte nicht geöffnet werden.')}</p>}
    {quotes.length > 0 && <small className="outgoing-foot">{t('Abgleich mit dem zuletzt eingelesenen Bestand. Vorhandene CCUs bleiben ausgeblendet, auch belegte. Du kaufst selbst.')}</small>}
  </div>;
}
