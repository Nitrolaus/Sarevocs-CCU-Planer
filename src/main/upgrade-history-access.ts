import type { AccountInventory, Pledge } from '../domain/model';
import type { LastSeen } from '../storage/last-seen';
import type { CatalogueShip } from '../market/model';
import { sameStandaloneShip, standaloneModel } from '../pricing/inventory-values';

export function mayReadObservedRevision(selectedId: string | null, inventory: AccountInventory, view: LastSeen | null | undefined,
  request: { accountId: string; revision: string }): view is LastSeen {
  if (selectedId !== request.accountId || inventory.account.id !== request.accountId || inventory.account.mode !== 'real' ||
      !view || view.accountId !== request.accountId || view.document.dataMode !== 'real' || view.revision !== request.revision) return false;
  const acceptedAt = inventory.items.reduce((latest, item) => Math.max(latest, Date.parse(item.importedAt) || 0),
    Date.parse(inventory.account.lastComplete ?? '') || 0);
  return Date.parse(view.observedAt) > acceptedAt;
}

/** Only current observed ship pledges may select a fixed history read; imported IDs are not capabilities. */
export function mayReadUpgradeHistory(selectedId: string | null, inventory: AccountInventory, view: LastSeen | null | undefined,
  request: { accountId: string; revision: string; pledgeId: string }): boolean {
  if (!mayReadObservedRevision(selectedId, inventory, view, request)) return false;
  const pledge = view.document.pledges.find(value => value.pledgeId === request.pledgeId);
  return !!pledge && pledge.ships.length > 0 && pledge.ccus.length === 0 && pledge.sourceValues.upgradeState !== 'unresolved';
}

export function purchaseCandidates(view: LastSeen, catalogue: readonly CatalogueShip[]) {
  const bases: Pledge[] = [], histories: string[] = [];
  const seen = new Set<string>(), duplicates = new Set<string>();
  for (const { pledgeId } of view.document.pledges) {
    if (seen.has(pledgeId)) duplicates.add(pledgeId);
    seen.add(pledgeId);
  }
  for (const pledge of view.document.pledges) {
    const id = pledge.pledgeId;
    if (!/^[1-9]\d{0,15}$/.test(id) || !Number.isSafeInteger(Number(id)) || duplicates.has(id) ||
        (!pledge.ships.length && !pledge.ccus.length) || pledge.rsiPurchase?.status === 'excluded') continue;
    if (pledge.rsiPurchase?.source !== 'order') bases.push(pledge);
    if (!view.appliedPurchaseHistories?.[id] && pledge.ships.length === 1 && !pledge.ccus.length &&
        pledge.sourceValues.upgradeState !== 'unresolved' && standaloneModel(pledge) && !sameStandaloneShip(pledge, catalogue)) histories.push(id);
  }
  return { bases, histories };
}
