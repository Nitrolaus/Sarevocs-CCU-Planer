import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gameCopyLabel, gamePackageModelLabel, npcEvidenceNote, NPC_UNCONFIRMED_LABEL } from '../src/ui/game-packages';
import { gameAccessEvidence } from '../src/domain/game-access';
import { basePledge } from './fixtures';

test('Spielkopien werden als SC, SQ42 oder Kombination angezeigt, ohne unbekannte Kopie zu ergänzen', () => {
  assert.equal(gameCopyLabel({ starCitizen: true, squadron42: true, upgradeOnly: true }), 'SC + SQ42');
  assert.equal(gameCopyLabel({ starCitizen: true, squadron42: false, upgradeOnly: false }), 'SC');
  assert.equal(gameCopyLabel({ starCitizen: false, squadron42: true, upgradeOnly: false }), 'SQ42');
  assert.equal(gameCopyLabel({ starCitizen: false, squadron42: false, upgradeOnly: false }), '');
});

test('Paketmodellzeile zeigt tatsächliche Modelle, auch gleiche Kinder, oder explizit keinen Schiffseintrag', () => {
  const p = basePledge(); p.ships[0]!.modelName = 'Synthetic Model';
  p.ships.push({ ...p.ships[0]!, childId: 'other' });
  assert.equal(gamePackageModelLabel(p), 'Aktuell: Synthetic Model, Synthetic Model');
  p.ships = []; assert.equal(gamePackageModelLabel(p), 'Kein Schiff im Bestandseintrag');
});

const sc = { starCitizen: true, squadron42: false, upgradeOnly: false };
const sq42 = { starCitizen: false, squadron42: true, upgradeOnly: false };
const neither = { starCitizen: false, squadron42: false, upgradeOnly: false };

test('SC mit Schiff erhält nur eine bedingte historische Einordnung, auch bei zusätzlicher SQ42-Kopie', () => {
  const p = basePledge(); p.name = 'Package - Synthetic Starter';
  for (const access of [sc, { starCitizen: true, squadron42: true, upgradeOnly: true }]) {
    const note = npcEvidenceNote(p, access);
    assert.match(note, /historischen.*27\.09\.2013/);
    assert.match(note, /bedingte Ableitung/);
    assert.match(note, /kein Nachweis einer heutigen Zuteilung/);
    assert.doesNotMatch(note, /Hauptfigur|Hauptcharakter|\d+ (?:NPC|Plätze)/);
  }
  assert.equal(NPC_UNCONFIRMED_LABEL, 'Nicht bestätigt');
});

test('Nur exakter High-Admiral-Hinweis mit SC und ohne Schiff erklärt die Concierge-Zugangsquelle', () => {
  const p = basePledge(); p.name = '  VIP   High ADMIRAL  '; p.ships = [];
  const note = npcEvidenceNote(p, sc);
  assert.match(note, /Concierge-FAQ, 28\.08\.2026/);
  assert.match(note, /SC-PU-Zugang/);
  assert.match(note, /zusätzlicher.*nicht belegt/);
  assert.doesNotMatch(npcEvidenceNote(p, neither), /Concierge-FAQ|historischen/);
});

test('Ähnliche VIP-Namen und VIP-Einträge mit Schiff bekommen keinen vermeintlichen Concierge-Nachweis', () => {
  const p = basePledge(); p.ships = [];
  for (const name of ['VIP - High Admiral', 'VIP High Admiral Bonus', 'Synthetic High Admiral', 'High Admiral']) {
    p.name = name;
    assert.doesNotMatch(npcEvidenceNote(p, sc), /Concierge-FAQ/);
  }
  p.name = 'VIP High Admiral'; p.ships = basePledge().ships;
  assert.doesNotMatch(npcEvidenceNote(p, sc), /Concierge-FAQ/);
});

test('Giveaway mit nachgewiesenem SC erhält einen offenen Aktionsgrund und keinen Gratis-Ausschluss', () => {
  const p = basePledge(); p.name = 'Package - Synthetic GIVEAWAY';
  for (const ships of [p.ships, []]) {
    p.ships = ships;
    const note = npcEvidenceNote(p, sc);
    assert.match(note, /für diese Aktion nicht belegt/);
    assert.match(note, /weder Ausschluss noch Anspruch/);
    assert.match(note, /keine heutige Zuteilungsbestätigung/);
    assert.doesNotMatch(note, /bedingte Ableitung|Concierge-FAQ/);
  }
  p.name = 'Package - Synthetic Giveawayish';
  assert.doesNotMatch(npcEvidenceNote(p, sc), /Aktionspaket/);
});

test('VIP- oder Giveaway-Namen und behauptete Quellfelder ersetzen keinen exakten SC-Kopienbeleg', () => {
  const p = basePledge();
  p.sourceValues = { items: JSON.stringify([{ title: 'Star Citizen Game' }]), npcSlots: '9', character: 'confirmed' };
  for (const name of ['VIP High Admiral', 'Package - Synthetic Giveaway', 'Package - Synthetic Starter']) {
    p.name = name;
    const note = npcEvidenceNote(p, gameAccessEvidence(p));
    assert.match(note, /Kein SC-Spielzugang belegt/);
    assert.doesNotMatch(note, /Aktionspaket|Concierge-FAQ|bedingte Ableitung|9/);
  }
});

test('SQ42 allein ist auch mit Schiff oder besonderem Namen kein SC-NPC-Nachweis', () => {
  const p = basePledge();
  for (const name of ['VIP High Admiral', 'Package - Synthetic Giveaway', 'Package - Synthetic Starter']) {
    p.name = name;
    const note = npcEvidenceNote(p, sq42);
    assert.match(note, /nur ein SQ42-Spielzugang/);
    assert.match(note, /kein zusätzlicher SC-Charakter-\/NPC-Platz/);
    assert.doesNotMatch(note, /Aktionspaket|Concierge-FAQ|bedingte Ableitung/);
  }
});

test('Unbekannte SC-Einträge ohne Schiff bleiben ohne Paket- oder NPC-Zuteilungsbehauptung', () => {
  const p = basePledge(); p.name = 'Synthetic Access'; p.ships = [];
  const baseline = npcEvidenceNote(p, sc);
  p.sourceValues = { npcSlots: '7', character: 'confirmed', description: 'Game Character Slot' };
  assert.equal(npcEvidenceNote(p, sc), baseline);
  assert.match(baseline, /Download allein bestätigt keinen/);
  assert.doesNotMatch(baseline, /Concierge-FAQ|bedingte Ableitung|7/);
});

test('NPC-Gründe verändern weder Paketdaten noch Kopienbelege', () => {
  const p = basePledge(); p.name = 'Package - Synthetic Starter';
  const before = JSON.stringify(p);
  for (const ship of p.ships) Object.freeze(ship);
  Object.freeze(p.ships); Object.freeze(p.sourceValues); Object.freeze(p);
  const access = Object.freeze({ ...sc });
  npcEvidenceNote(p, access);
  assert.equal(JSON.stringify(p), before);
  assert.deepEqual(access, sc);
});

