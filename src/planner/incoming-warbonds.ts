import { offersAreStale, type CatalogueShip, type MarketSnapshot } from '../market/model';
import { catalogueIdentity, nominalValue } from '../market/ship-values';
import type { ShopPair } from '../market/shop-prices';
import { canonicalPlan } from './advisor';
import { selectedStartBase } from './bases';
import type { ChainModel, ChainPool } from './chain';
import type { PlannerDraft } from './draft';
import type { ReservablePlan } from './reservations';
import { purchaseCandidates } from './warbond-tier';
import { purchasePriceReader } from './shopping-list';

export type IncomingCandidate = ShopPair & { from: CatalogueShip; target: CatalogueShip;
  relation: 'planned-warbond' | 'planned-link' | 'fits-gap' };
export type IncomingAdvice = { state: 'target-required' | 'base-required' | 'chain-unavailable' | 'market-unavailable' | 'ready';
  candidates: IncomingCandidate[] };

/** Discover Warbonds inside missing links of the selected route TO Schiff 1.
 * Owned steps and manual purchase anchors stay intact. Only a fresh exact pair quote
 * subsequently proves availability and discount; ship values alone never do that.
 */
export function incomingWarbondCandidates(input: { target?: CatalogueShip; draft?: PlannerDraft;
  plan: ReservablePlan | null; pool: ChainPool; market?: MarketSnapshot }, now = Date.now()): IncomingAdvice {
  const { target, draft, pool, market } = input;
  if (!target) return { state: 'target-required', candidates: [] };
  const base = draft && selectedStartBase(pool, draft);
  if (!base) return { state: 'base-required', candidates: [] };
  const plan = pool.limited ? null : canonicalPlan(input.plan, target, pool);
  if (!plan || plan.base.key !== base.key) return { state: 'chain-unavailable', candidates: [] };
  if (!market?.catalogue || offersAreStale(market, now)) return { state: 'market-unavailable', candidates: [] };
  const ships = market.catalogue.ships, offers = market.offers!.items;
  const plannedPrice = purchasePriceReader(offers, market.values, true, now, market.shopPrices);
  const resolve = (model: ChainModel) => {
    const ship = catalogueIdentity(model.name, ships);
    return ship && model.key === 'matrix:' + ship.id && model.nominalUsd !== null &&
      nominalValue(ship, offers, true, market.values) === model.nominalUsd ? ship : null;
  };
  const result = new Map<string, IncomingCandidate>();
  for (const step of plan.steps) {
    if (step.kind !== 'purchase') continue;
    const gapFrom = resolve(step.from), gapTo = resolve(step.to);
    if (!gapFrom || !gapTo) continue;
    for (const offer of offers) {
      if (offer.change === 'missing' || !offer.warbond || !offer.warbondMinor ||
        offer.warbondMinor >= offer.regularMinor || offer.regularMinor > step.to.nominalUsd! ||
        offer.warbondMinor <= step.from.nominalUsd!) continue;
      const to = catalogueIdentity(offer.targetName, ships);
      if (!to || to.id !== offer.toShipId || nominalValue(to, offers, true, market.values) !== offer.regularMinor) continue;
      // Keep an existing purchase pair instead of suggesting an equivalent different ship.
      // For a new intermediate, use a short CCU wholly inside the still-unbought gap.
      const starts = [gapFrom, ...purchaseCandidates({ current: true, pool: { values: market.values } }, offer, now).rows
        .flatMap(row => { const ship = catalogueIdentity(row.ship.name, ships); return ship?.id === row.ship.id ? [ship] : []; })]
        .filter(ship => {
          const value = nominalValue(ship, offers, true, market.values);
          return value !== null && (value > step.from.nominalUsd! || ship.id === gapFrom.id) && value < offer.warbondMinor! &&
            (draft!.mode !== 'manual' || step.anchorIndex === undefined || ship.id === gapFrom.id && to.id === gapTo.id);
        }).sort((a, b) => Number(b.id === gapFrom.id && to.id === gapTo.id) - Number(a.id === gapFrom.id && to.id === gapTo.id)
          || nominalValue(b, offers, true, market.values)! - nominalValue(a, offers, true, market.values)!
          || a.name.localeCompare(b.name) || a.id - b.id);
      const from = starts[0];
      if (from) {
        const exact = from.id === gapFrom.id && to.id === gapTo.id;
        const relation = exact ? plannedPrice(step).kind === 'warbond' ? 'planned-warbond' : 'planned-link' : 'fits-gap';
        result.set(from.id + ':' + to.id, { fromId: from.id, toId: to.id, from, target: to, relation });
      }
    }
  }
  return { state: 'ready', candidates: [...result.values()].sort((a, b) =>
    nominalValue(a.target, offers, true, market.values)! - nominalValue(b.target, offers, true, market.values)!
    || a.target.name.localeCompare(b.target.name) || a.from.name.localeCompare(b.from.name)) };
}
