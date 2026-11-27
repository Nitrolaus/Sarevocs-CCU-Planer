import type { LastSeen } from '../storage/last-seen';

/** Stock absence needs a completed observation, not permission to remove older imported items. */
export function observedCcuInventoryKnown(view: Pick<LastSeen, 'document' | 'hangarRead'>): boolean {
  const { document, hangarRead } = view;
  const traversed = hangarRead?.kind === 'reached-end' && hangarRead.pagesRead > 0
    && hangarRead.pagesRead === document.scope.pagesRead && hangarRead.pledgesRead === document.pledges.length;
  const fullExport = document.scope.kind === 'full-hangar' && document.scope.exportComplete;
  return (traversed || fullExport) && !document.pledges.some(p => p.sourceValues.upgradeState === 'unresolved');
}
