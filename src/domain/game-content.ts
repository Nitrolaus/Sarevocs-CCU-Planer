import type { Pledge } from './model';
import { gameAccessEvidence } from './game-access';

/** Classifies imported contents, not the account's selected Protected Game Access Pledge.
 * A name, price, crown or local protection flag cannot prove RSI's Game Library assignment. */
export function gameContentKind(pledge: Pledge): 'package' | 'copy' | null {
  const access = gameAccessEvidence(pledge);
  if ((!access.starCitizen && !access.squadron42) || pledge.ccus.length ||
      pledge.sourceValues.upgradeState === 'unresolved') return null;
  return pledge.ships.length ? 'package' : 'copy';
}
