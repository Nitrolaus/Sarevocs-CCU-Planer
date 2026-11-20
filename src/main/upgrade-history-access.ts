import type { AccountInventory } from '../domain/model';
import type { LastSeen } from '../storage/last-seen';

/** Only current observed ship pledges may select a fixed history read; imported IDs are not capabilities. */
export function mayReadUpgradeHistory(selectedId: string | null, inventory: AccountInventory, view: LastSeen | null | undefined,
  request: { accountId: string; revision: string; pledgeId: string }): boolean {
  if (selectedId !== request.accountId || inventory.account.id !== request.accountId || inventory.account.mode !== 'real' ||
      !view || view.accountId !== request.accountId || view.document.dataMode !== 'real' || view.revision !== request.revision) return false;
  const acceptedAt = inventory.items.reduce((latest, item) => Math.max(latest, Date.parse(item.importedAt) || 0),
    Date.parse(inventory.account.lastComplete ?? '') || 0);
  if (!(Date.parse(view.observedAt) > acceptedAt)) return false;
  const pledge = view.document.pledges.find(value => value.pledgeId === request.pledgeId);
  return !!pledge && pledge.ships.length > 0 && pledge.ccus.length === 0 && pledge.sourceValues.upgradeState !== 'unresolved';
}
