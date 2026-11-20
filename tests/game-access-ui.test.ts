import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gameAccessEvidence } from '../src/domain/game-access';
import { gameAccessRowStatus, gameAccessTitle, hasGameAccess } from '../src/ui/game-access';
import { basePledge } from './fixtures';

const field = (...titles: string[]) => JSON.stringify(titles.map(title => ({ title })));
function combined() {
  const pledge = basePledge(); pledge.sourceValues = { items: field('Star Citizen Digital Download'), alsoContains: field('Squadron 42 Digital Download') };
  return pledge;
}

test('Spielzugang bleibt nach Modell- oder ursprünglichem Namenswechsel am belegten Pledge', () => {
  const pledge = combined();
  assert.equal(gameAccessRowStatus(pledge, gameAccessEvidence(pledge)), 'Nur upgraden');
  pledge.ships[0]!.modelName = 'Synthetic Future Ship'; pledge.name = 'A different original pledge';
  assert.equal(hasGameAccess(gameAccessEvidence(pledge)), true);
  assert.equal(gameAccessRowStatus(pledge, gameAccessEvidence(pledge)), 'Nur upgraden');
});

test('Unbelegte oder beschädigte Felder liefern weder Krone noch neuen Status oder Tooltip', () => {
  const pledge = basePledge(); pledge.name = 'Star Citizen Digital Download'; pledge.ships[0]!.modelName = 'Prospector';
  const fields: Record<string, string>[] = [{}, { items: '{' }, { items: field('Star Citizen') }, { items: JSON.stringify([{ title: 'Star Citizen Digital Download' }, null]) }];
  for (const sourceValues of fields) {
    pledge.sourceValues = sourceValues;
    const access = gameAccessEvidence(pledge);
    assert.equal(hasGameAccess(access), false); assert.equal(gameAccessRowStatus(pledge, access), null);
    assert.equal(gameAccessTitle(pledge, 'ORIGINAL', access), 'ORIGINAL');
  }
});

test('CCU und ungeklärtes Upgrade erhalten aus Spielbelegen keinen irreführenden Upgrade-Status', () => {
  const pledge = combined();
  for (const kind of ['ccu', 'unresolved']) {
    if (kind === 'ccu') pledge.ccus = [{ instanceId: 'synthetic', from: 'Synthetic A', to: 'Synthetic B', status: 'unverified', applicability: 'unverified', insurance: { kind: 'unknown', reason: 'Synthetic' } }];
    else { pledge.ccus = []; pledge.sourceValues.upgradeState = 'unresolved'; }
    const access = gameAccessEvidence(pledge);
    assert.equal(gameAccessRowStatus(pledge, access), null);
    assert.ok(!gameAccessTitle(pledge, 'ORIGINAL', access).includes('Nur upgraden'));
  }
});

test('Einzelne Kopien und schifflose Pledges heißen Spielzugang ohne behauptete Serverauswahl', () => {
  const pledge = basePledge(); pledge.sourceValues = { items: field('Star Citizen Digital Download') };
  assert.equal(gameAccessRowStatus(pledge, gameAccessEvidence(pledge)), 'Spielzugang');
  pledge.ships = [];
  assert.equal(gameAccessRowStatus(pledge, gameAccessEvidence(pledge)), 'Spielzugang');
  const title = gameAccessTitle(pledge, 'ORIGINAL', gameAccessEvidence(pledge));
  assert.ok(title.includes('Star Citizen') && !title.includes('Planer-Schutz'));
});

test('Spielkopienhinweis bewahrt vorhandenen zweistufigen Upgrade-Verlauf unverändert', () => {
  const pledge = combined();
  const existing = 'Pledge: Synthetic Package\nAktuell: Synthetic C\nUpgrade-Schritte im RSI-Pledge-Protokoll (älteste zuerst):\nSynthetic A → Synthetic B · 01.11.2026 10:00\nSynthetic B → Synthetic C · 02.11.2026 11:00';
  const title = gameAccessTitle(pledge, existing, gameAccessEvidence(pledge));
  assert.ok(title.endsWith(existing)); assert.ok(title.startsWith('Spielkopien: Star Citizen + Squadron 42\n'));
  assert.ok(!/einzig|Game Library|ausgewählt/i.test(title));
});

test('Kronenstatus ändert keine Versicherung, Bestandswerte oder Schutzfreigaben', () => {
  const pledge = combined(); pledge.insurance = { kind: 'months', months: 6, evidence: 'Synthetic six-month insurance' };
  const before = structuredClone(pledge), access = gameAccessEvidence(pledge);
  gameAccessRowStatus(pledge, access); gameAccessTitle(pledge, 'ORIGINAL', access);
  assert.deepEqual(pledge, before);
});
