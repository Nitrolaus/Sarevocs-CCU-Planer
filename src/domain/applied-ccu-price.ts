import type { InventoryItem, Pledge, RsiPurchase } from './model';
import type { UpgradeHistoryResult, UpgradeHistoryStep } from './upgrade-history';
import type { CatalogueShip } from '../market/model';
import { catalogueIdentity, sameModelName } from '../market/ship-values';

type DocumentedPurchase = Extract<RsiPurchase, { status: 'documented' }>;

const firebirdSubscriberTitle = /^Sabre Firebird Imperator Subscribers Edition$/i;

/** The January 2026 subscriber SKU grants the Firebird model under a separate upgrade title. */
export function sameHistoryModelName(a: string, b: string, catalogue: readonly CatalogueShip[]): boolean {
  if (sameModelName(a, b, catalogue)) return true;
  const shipName = (name: string) => firebirdSubscriberTitle.test(name.trim()) && !catalogueIdentity(name, catalogue) ? 'Sabre Firebird' : name;
  return sameModelName(shipName(a), shipName(b), catalogue);
}

/** Only records read directly from RSI on this profile can document local costs. */
export function historicCcuPurchases(items: readonly InventoryItem[], currentPledges: readonly Pledge[]) {
  const stillOwned = new Set(currentPledges.map(pledge => pledge.pledgeId));
  const purchases = new Map<string, Pledge>();
  for (const { pledge, source } of items) {
    if (source === 'rsi-dom-probe/1' && !stillOwned.has(pledge.pledgeId) &&
        pledge.ccus.length === 1 && pledge.rsiPurchase?.status === 'documented') {
      purchases.set(pledge.pledgeId, pledge);
    }
  }
  return purchases;
}

export function appliedCcuPrice(step: UpgradeHistoryStep, purchases: ReadonlyMap<string, Pledge>,
  catalogue: readonly CatalogueShip[] = []): DocumentedPurchase | undefined {
  const pledge = step.ccuPledgeId ? purchases.get(step.ccuPledgeId) : undefined;
  if (!pledge || pledge.rsiPurchase?.status !== 'documented' || pledge.ccus.length !== 1) return undefined;
  const ccu = pledge.ccus[0]!;
  return sameHistoryModelName(ccu.from, step.from, catalogue) && sameHistoryModelName(ccu.to, step.to, catalogue)
    ? pledge.rsiPurchase : undefined;
}

export function pricedUpgradeSteps(steps: readonly UpgradeHistoryStep[], purchases: ReadonlyMap<string, Pledge>,
  catalogue: readonly CatalogueShip[] = [], confirmed: UpgradeHistoryResult['purchases'] = []) {
  const byId = new Map(confirmed.map(({ ccuPledgeId, price }) => [ccuPledgeId, price]));
  return [...steps].sort((a, b) => {
    if (a.appliedAt === b.appliedAt) return 0;
    if (!a.appliedAt) return 1;
    if (!b.appliedAt) return -1;
    return a.appliedAt.localeCompare(b.appliedAt);
  }).map(step => ({ step, price: byId.get(step.ccuPledgeId ?? '') ?? appliedCcuPrice(step, purchases, catalogue) }));
}
