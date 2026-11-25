import type { InventoryItem, Pledge, RsiPurchase } from './model';
import type { UpgradeHistoryStep } from './upgrade-history';
import type { CatalogueShip } from '../market/model';
import { sameModelName } from '../market/ship-values';

type DocumentedPurchase = Extract<RsiPurchase, { status: 'documented' }>;

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
  return sameModelName(ccu.from, step.from, catalogue) && sameModelName(ccu.to, step.to, catalogue)
    ? pledge.rsiPurchase : undefined;
}
