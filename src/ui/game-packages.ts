import type { Pledge } from '../domain/model';
import type { GameAccessEvidence } from '../domain/game-access';

export const NPC_UNCONFIRMED_LABEL = 'Nicht bestätigt';
export const NPC_UNCONFIRMED_NOTE = 'Zusätzliche Charakter-/NPC-Nutzung von RSI 2013 angekündigt; kein aktivierter Platz aus Hangardaten belegt.';

/** These reasons explain evidence limits, never an assigned or additional character slot. */
export function npcEvidenceNote(pledge: Pledge, access: GameAccessEvidence): string {
  if (!access.starCitizen) {
    return access.squadron42
      ? 'Hier ist nur ein SQ42-Spielzugang belegt. Daraus folgt kein zusätzlicher SC-Charakter-/NPC-Platz; die RSI-Paketankündigung vom 27.09.2013 belegt keine heutige Zuteilung.'
      : 'Kein SC-Spielzugang belegt. Ein zusätzlicher Charakter-/NPC-Platz lässt sich aus diesem Bestandseintrag nicht bestätigen.';
  }
  const name = pledge.name.replace(/\s+/g, ' ').trim().toLowerCase();
  if (/(?:^|[^a-z0-9])giveaway(?:$|[^a-z0-9])/.test(name)) {
    return 'Dieses Aktionspaket enthält einen SC-Spielzugang. Zusätzliche Charakter-/NPC-Plätze sind für diese Aktion nicht belegt; kostenlos bedeutet weder Ausschluss noch Anspruch. Das RSI-Paketkonzept vom 27.09.2013 ist keine heutige Zuteilungsbestätigung.';
  }
  if (name === 'vip high admiral' && pledge.ships.length === 0) {
    return 'CIG bestätigt für High Admiral den SC-PU-Zugang (Concierge-FAQ, 28.08.2026). Ein zusätzlicher Charakter-/NPC-Platz ist damit nicht belegt.';
  }
  if (pledge.ships.length > 0) {
    return 'Dieser Eintrag belegt SC-Spielzugang und ein Schiff. Nach dem historischen RSI-Paketkonzept vom 27.09.2013 waren zusätzliche Charaktere mit möglicher NPC-Nutzung vorgesehen. Das ist hier eine bedingte Ableitung, kein Nachweis einer heutigen Zuteilung.';
  }
  return 'Ein SC-Spielzugang ist belegt. Der Download allein bestätigt keinen zusätzlichen Charakter-/NPC-Platz; eine heutige Zuteilungsbestätigung fehlt.';
}

export function gameCopyLabel(access: GameAccessEvidence): string {
  return access.starCitizen && access.squadron42 ? 'SC + SQ42' : access.starCitizen ? 'SC' : access.squadron42 ? 'SQ42' : '';
}
export function gamePackageModelLabel(pledge: Pick<Pledge, 'ships'>): string {
  return pledge.ships.length ? 'Aktuell: ' + pledge.ships.map(ship => ship.modelName).join(', ') : 'Kein Schiff im Bestandseintrag';
}
