import type { StoreCredit } from '../domain/store-credit';
import type { TargetOffer } from '../market/model';
import { shipValuesStale, type ShipValues } from '../market/ship-values';
import { euroRateIsStale, matchesShopAmount, planPayment } from '../pricing/money';
import { SHOP_PRICE_MAX_AGE, type ShopAmount, type ShopPrice } from '../market/shop-prices';
import type { PricingSnapshot } from '../pricing/model';
import { purchaseCandidates } from './warbond-tier';
import type { ChainModel, ChainStep } from './chain';
import { analyseReservations, blockedForTarget, blockingPlanResources, type PriorityOrder, type ReservationTarget } from './reservations';

type Price = { kind: 'open' } | { kind: 'standard' | 'warbond'; usdMinor: number; cashOnly?: boolean; shop?: ShopAmount };
export type PurchasePriceReader = (step: ChainStep) => Price;
type EuroBuyback = { kind: 'standard'; eurMinor: number; cashOnly: boolean };
type Item = { key: string; target: string; from: string; to: string; price: Price | EuroBuyback };
type Owned = { target: string; steps: { from: string; to: string }[] };
type Issue = { target: string; reason: 'base' | 'no-priced-route' | 'conflict' | 'invalid' };
export type ShoppingList = { items: Item[]; owned: Owned[]; issues: Issue[] };

/** Only current store targets and exact ship identities can support a price estimate. */
export function purchasePriceReader(offers: readonly TargetOffer[], values: ShipValues | null | undefined,
  current: boolean, now = Date.now(), quotes: readonly ShopPrice[] = []): PurchasePriceReader {
  const ready = current && !shipValuesStale(values, now);
  const fromModels = new Map(ready ? values!.items.map(ship => ['matrix:' + ship.id, ship]) : []);
  const store = new Map<string, TargetOffer[]>();
  if (current) for (const offer of offers) {
    if (offer.change === 'missing') continue;
    const key = 'matrix:' + offer.toShipId;
    const matches = store.get(key) ?? [];
    matches.push(offer);
    store.set(key, matches);
  }
  const warbondStarts = new Map<string, Map<string, number>>();
  const official = new Map(quotes.filter(quote => now >= quote.checkedAt && now - quote.checkedAt < SHOP_PRICE_MAX_AGE)
    .map(quote => [`matrix:${quote.fromId}:matrix:${quote.toId}:${quote.edition}`, quote.amount]));

  function matchingOffers(model: ChainModel) {
    const matches = store.get(model.key)?.filter(offer => offer.targetName === model.name) ?? [];
    return matches.every(offer => offer.regularMinor === model.nominalUsd) ? matches : [];
  }

  return function estimate(step: ChainStep): Price {
    if (step.kind !== 'purchase' || step.validity === 'invalid') return { kind: 'open' };
    const knownFrom = fromModels.get(step.from.key);
    const base = step.from.nominalUsd;
    if (base === null || base <= 0 || (knownFrom
      ? knownFrom.name !== step.from.name || knownFrom.minor !== base
      : !matchingOffers(step.from).length)) return { kind: 'open' };
    const matches = matchingOffers(step.to);
    const standard = step.to.nominalUsd;
    if (standard === null || standard <= base || !matches.length) return { kind: 'open' };

    let warbond = Infinity;
    for (const offer of matches) {
      if (!ready || !offer.warbond) continue;
      let starts = warbondStarts.get(offer.key);
      if (!starts) {
        const { rows } = purchaseCandidates({ current: ready, pool: { values } }, offer, now);
        starts = new Map(rows.map(row => [row.from.key, row.usdMinor]));
        warbondStarts.set(offer.key, starts);
      }
      warbond = Math.min(warbond, starts.get(step.from.key) ?? Infinity);
    }
    const kind = Number.isFinite(warbond) ? 'warbond' : 'standard';
    const shop = official.get(`${step.from.key}:${step.to.key}:${kind}`);
    const usdMinor = shop?.currency === 'USD' && shop.taxMode === 'net' ? shop.minor : kind === 'warbond' ? warbond : standard - base;
    return shop ? { kind, usdMinor, shop } : { kind, usdMinor };
  };
}

export function shoppingList(targets: readonly ReservationTarget[], order: PriorityOrder,
  offers: readonly TargetOffer[], values: ShipValues | null | undefined, current: boolean, quotes?: readonly ShopPrice[]): ShoppingList {
  const reservations = analyseReservations(targets, order);
  const items: Item[] = [], owned: Owned[] = [], issues: Issue[] = [];
  const estimate = purchasePriceReader(offers, values, current, Date.now(), quotes);
  for (const slot of order) {
    const target = targets.find(entry => entry.slot === slot);
    if (!target) continue;
    const { plan, name } = target;
    const blocking = blockedForTarget(reservations, target.targetId);
    const reason = !plan?.base ? (target.noPricedRoute ? 'no-priced-route' : 'base')
      : blockingPlanResources(plan, blocking).length ? 'conflict'
      : plan.steps.some(step => step.kind === 'conflict' || step.kind === 'missing' || step.validity === 'invalid') ? 'invalid' : null;
    if (reason || !plan) {
      issues.push({ target: name, reason: reason ?? 'base' });
      continue;
    }
    const included: Owned['steps'] = [];
    for (const [index, step] of plan.steps.entries()) {
      const from = step.from.name, to = step.to.name;
      if (step.kind === 'owned') included.push({ from, to });
      if (step.kind === 'purchase') items.push({ key: `${slot}:${index}`, target: name, from, to, price: estimate(step) });
    }
    if (included.length) owned.push({ target: name, steps: included });
  }
  return { items, owned, issues };
}

/** Allocate one credit balance in goal order. Tax is applied after credit is deducted. */
export function shoppingPayments(list: ShoppingList, display: PricingSnapshot, balance?: StoreCredit, budgetMinor?: number) {
  const rate = display.rate && !euroRateIsStale(display.rate) ? display.rate : null;
  const hasFx = !!rate;
  const hasNative = list.items.some(({ price }) => 'eurMinor' in price || ('shop' in price && matchesShopAmount(display.settings, price.shop)));
  const cashCurrency: 'EUR' | 'USD' = display.settings.currency === 'EUR' && (hasFx || hasNative) ? 'EUR' : 'USD';
  const creditCurrency = balance?.currency ?? 'USD';
  const available = balance?.minor ?? 0;
  const budget = Number.isSafeInteger(budgetMinor) ? Math.max(0, Math.min(available, budgetMinor!)) : available;
  const canUseCredit = !!balance && (creditCurrency === 'USD' || hasFx);
  const settings = { ...display.settings, currency: cashCurrency } as const;
  let creditUsed = 0, cashTotal = 0, openCount = 0;
  const rows = list.items.map(item => {
    if (item.price.kind === 'open') {
      openCount++;
      return { ...item, cash: null, credit: null, exact: false };
    }
    const remaining = canUseCredit && item.price.kind === 'standard' && !item.price.cashOnly ? budget - creditUsed : 0;
    const payment = 'eurMinor' in item.price
      ? planPayment(item.price.eurMinor, 'EUR', settings, rate, creditCurrency, remaining)
      : planPayment(item.price.usdMinor, 'USD', settings, rate, creditCurrency, remaining);
    const shop = 'shop' in item.price ? item.price.shop : undefined;
    const exact = (remaining === 0 || payment.credit === 0) && matchesShopAmount(settings, shop);
    const { cash, credit } = exact && shop ? { cash: shop.minor, credit: 0 } : payment;
    if (cash === null || credit === null) openCount++;
    else { creditUsed += credit; cashTotal += cash; }
    return { ...item, cash, credit, exact };
  });
  return { rows, cashCurrency, creditCurrency, cashTotal, creditUsed, creditLeft: available - creditUsed, openCount,
    approximate: rows.some(row => row.cash !== null && row.cash > 0 && !row.exact),
    canUseCredit, convertedCredit: !!balance && creditCurrency === 'EUR' && hasFx };
}
