import type { Buyback, BuybackObservation } from '../domain/model';
import type { StoreCredit } from '../domain/store-credit';
import { offersAreStale, type CatalogueShip, type MarketSnapshot } from '../market/model';
import { catalogueIdentity, nominalValue } from '../market/ship-values';
import type { PricingSnapshot } from '../pricing/model';
import { buildChain, type ChainBase, type ChainPool } from './chain';
import { availableForTarget, DEFAULT_PRIORITIES, type ResourceClaim } from './reservations';
import { shoppingList, shoppingPayments } from './shopping-list';

/** A single identified LTI model is required for a hypothetical upgrade base. */
export function buybackBase(entry: Buyback, market: MarketSnapshot): ChainBase | null {
  const name = entry.originalShips?.[0];
  if (entry.insurance?.kind !== 'lti' || entry.originalShips?.length !== 1 || !name) return null;
  const ship = catalogueIdentity(name, market.catalogue?.ships ?? []);
  if (!ship) return null;
  const nominalUsd = nominalValue(ship, market.offers?.items ?? [], !offersAreStale(market), market.values);
  return {
    key: JSON.stringify(['buyback', entry.entryId]), pledgeId: entry.entryId, childId: 'buyback',
    model: { key: 'matrix:' + ship.id, name: ship.name, catalogueConfirmed: true, nominalUsd },
    pledgeName: entry.name, insurance: entry.insurance, protected: true, released: false, multiShip: false, identityConfirmed: false,
  };
}

export function startBasisRoute(input: {
  base: ChainBase; target: CatalogueShip; pool: ChainPool; blocked: readonly ResourceClaim[];
  market: MarketSnapshot; display: PricingSnapshot; balance?: StoreCredit; budgetMinor: number;
  buyback?: Buyback; observation?: BuybackObservation;
}) {
  const { base, target, market, buyback, observation } = input;
  const offers = market.offers?.items ?? [], current = !offersAreStale(market);
  const available = availableForTarget({ ...input.pool, bases: [base] }, input.blocked);
  const plan = buildChain(available, target, offers, current, base.key, { ...input.display, shopPrices: market.shopPrices });
  if (!plan) return null;
  const list = shoppingList([{ slot: 0, targetId: target.id, name: target.name, plan }], DEFAULT_PRIORITIES, offers, market.values, current, market.shopPrices);
  if (list.issues.length) return { plan, payment: null, purchases: [] };
  if (buyback) {
    const price = buyback.currentPrice;
    // A gross or unclassified amount cannot be added to a net CCU budget.
    const cashOnly = !observation?.current || observation.token !== 'available';
    list.items.unshift({ key: 'buyback', target: target.name, from: base.model.name, to: base.model.name,
      price: price?.taxBasis === 'net' && price.minor <= 100_000_000
        ? price.currency === 'EUR' ? { kind: 'standard', eurMinor: price.minor, cashOnly } : { kind: 'standard', usdMinor: price.minor, cashOnly }
        : { kind: 'open' } });
  }
  const payment = shoppingPayments(list, input.display, input.balance, input.budgetMinor);
  return { plan, payment, purchases: payment.rows.filter(row => row.key !== 'buyback') };
}
