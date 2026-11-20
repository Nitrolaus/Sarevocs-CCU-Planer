import type { Pledge } from '../domain/model';
import type { GameAccessEvidence } from '../domain/game-access';

export function hasGameAccess(evidence: GameAccessEvidence): boolean {
  return evidence.starCitizen || evidence.squadron42;
}
function normalShip(pledge: Pledge): boolean {
  return pledge.ships.length > 0 && pledge.ccus.length === 0 && pledge.sourceValues.upgradeState !== 'unresolved';
}
export function gameAccessRowStatus(pledge: Pledge, evidence: GameAccessEvidence): 'Nur upgraden' | 'Spielzugang' | null {
  if (!hasGameAccess(evidence) || pledge.ccus.length || pledge.sourceValues.upgradeState === 'unresolved') return null;
  return normalShip(pledge) && evidence.upgradeOnly ? 'Nur upgraden' : 'Spielzugang';
}
export function gameAccessTitle(pledge: Pledge, existing: string, evidence: GameAccessEvidence): string {
  if (!hasGameAccess(evidence)) return existing;
  const copies = [evidence.starCitizen ? 'Star Citizen' : null, evidence.squadron42 ? 'Squadron 42' : null].filter(Boolean);
  const protection = evidence.upgradeOnly
    ? 'Planer-Schutz: ' + (normalShip(pledge) ? 'Nur upgraden. ' : '') + 'Nicht einschmelzen oder verschenken.'
    : 'Krone: Spielkopie im Pledge belegt.';
  return 'Spielkopien: ' + copies.join(' + ') + '\n' + protection + '\n' + existing;
}
