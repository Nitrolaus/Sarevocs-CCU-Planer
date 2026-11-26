import type { Pledge } from '../domain/model';
import { offersAreStale, type CatalogueShip, type MarketSnapshot } from '../market/model';
import { catalogueIdentity, nominalValue } from '../market/ship-values';
import { SHOP_PRICE_MAX_AGE, type ShopAmount, type ShopPair, type ShopPrice } from '../market/shop-prices';
import type { OwnedCcu } from './chain';
import type { Reservations, ResourceOwner } from './reservations';

export type OutgoingCandidate = ShopPair & { target: CatalogueShip };
/** Target observations only discover pairs. Only an exact, fresh RSI pair quote confirms a purchasable CCU. */
export function outgoingWarbondCandidates(from: CatalogueShip | undefined, market: MarketSnapshot | undefined,
  now = Date.now()): OutgoingCandidate[] {
  if (!from || !market?.catalogue || offersAreStale(market, now)) return [];
  const value = nominalValue(from, market.offers!.items, true, market.values);
  if (value === null) return [];
  const result = new Map<number, OutgoingCandidate>();
  for (const offer of market.offers!.items) {
    if (offer.change === 'missing' || !offer.warbond || !offer.warbondMinor ||
      offer.warbondMinor <= value || offer.regularMinor <= offer.warbondMinor || offer.toShipId === from.id) continue;
    const target = catalogueIdentity(offer.targetName, market.catalogue.ships);
    if (!target || target.id !== offer.toShipId || nominalValue(target, market.offers!.items, true, market.values) === null) continue;
    result.set(target.id, { fromId: from.id, toId: target.id, target });
  }
  return [...result.values()].sort((a, b) => a.target.name.localeCompare(b.target.name));
}

export function outgoingWarbondQuote(pair: ShopPair, prices: readonly ShopPrice[], preferred: 'EUR' | 'USD',
  now = Date.now()): { price: ShopPrice; saving: ShopAmount | null } | null {
  const fresh = prices.filter(p => p.fromId === pair.fromId && p.toId === pair.toId && p.amount.minor > 0 &&
    p.checkedAt <= now && now - p.checkedAt < SHOP_PRICE_MAX_AGE);
  const warbonds = fresh.filter(p => p.edition === 'warbond')
    .sort((a, b) => Number(b.amount.currency === preferred) - Number(a.amount.currency === preferred) || b.checkedAt - a.checkedAt);
  const price = warbonds[0];
  if (!price) return null;
  const standard = fresh.find(p => p.edition === 'standard' && p.amount.currency === price.amount.currency &&
    p.amount.taxMode === price.amount.taxMode && p.amount.vatBasisPoints === price.amount.vatBasisPoints);
  // Different tax bases or currencies do not establish a discount. No ship-value arithmetic here.
  if (standard && standard.amount.minor <= price.amount.minor) return null;
  const saving = standard ? { ...price.amount, minor: standard.amount.minor - price.amount.minor } : null;
  return { price, saving };
}

export type OutgoingStock = { state: 'free' | 'reserved' | 'locked' | 'missing' | 'unknown';
  free: number; locked: number; consumed: number; reserved: ResourceOwner[] };
export function outgoingWarbondStock(pair: ShopPair, input: {
  catalogue: readonly CatalogueShip[]; pledges: readonly Pledge[]; ccus: readonly OwnedCcu[];
  inventoryKnown: boolean; complete: boolean; reservations: Reservations; reservationsReady: boolean; excluded: readonly string[];
}): OutgoingStock {
  const matches = (from: string, to: string) => catalogueIdentity(from, input.catalogue)?.id === pair.fromId &&
    catalogueIdentity(to, input.catalogue)?.id === pair.toId;
  const result: OutgoingStock = { state: 'unknown', free: 0, locked: 0, consumed: 0, reserved: [] };
  if (!input.inventoryKnown) return result;
  const claims = new Map(input.reservations.resources.filter(c => c.kind === 'ccu').map(c => [c.key, c.winner]));
  const seen = new Set<string>(), excluded = new Set(input.excluded);
  const owned = input.ccus.filter(c => c.from.key === 'matrix:' + pair.fromId && c.to.key === 'matrix:' + pair.toId);
  let uncertain = false;
  for (const ccu of owned) {
    if (seen.has(ccu.key)) { uncertain = true; continue; }
    seen.add(ccu.key);
    const owner = claims.get(ccu.key);
    if (owner) result.reserved.push(owner);
    else if (excluded.has(ccu.key)) result.locked++;
    else result.free++;
  }
  const consumed = new Set<string>();
  for (const pledge of input.pledges) for (const ccu of pledge.ccus) {
    if (!matches(ccu.from, ccu.to)) continue;
    if (ccu.status === 'applied') consumed.add(JSON.stringify([pledge.pledgeId, ccu.instanceId]));
    else if (!seen.has(JSON.stringify([pledge.pledgeId, ccu.instanceId]))) uncertain = true;
  }
  result.consumed = consumed.size;
  if (!input.reservationsReady) return { ...result, state: 'unknown', free: 0, reserved: [] };
  result.state = result.free && !uncertain ? 'free' : result.reserved.length ? 'reserved' : result.locked ? 'locked'
    : input.complete && !uncertain ? 'missing' : 'unknown';
  return result;
}
