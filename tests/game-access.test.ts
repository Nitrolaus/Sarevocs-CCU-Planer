import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gameAccessEvidence } from '../src/domain/game-access';
import { basePledge } from './fixtures';

const field = (...titles: string[]) => JSON.stringify(titles.map(title => ({ title })));
test('Game-copy evidence combines exact content titles from items and alsoContains', () => {
  const pledge = basePledge();
  pledge.sourceValues = { items: field('Star Citizen Digital Download'), alsoContains: field('Squadron 42 Digital Download') };
  assert.deepEqual(gameAccessEvidence(pledge), { starCitizen: true, squadron42: true, upgradeOnly: true });
  pledge.name = 'An entirely different original name'; pledge.ships[0]!.modelName = 'Synthetic Future Ship';
  assert.equal(gameAccessEvidence(pledge).upgradeOnly, true, 'A later model upgrade must retain the marker');
});
test('Single game copies are distinct and do not claim a combined package', () => {
  assert.deepEqual(gameAccessEvidence({ sourceValues: { items: field('Star Citizen Digital Download') } }), { starCitizen: true, squadron42: false, upgradeOnly: false });
  assert.deepEqual(gameAccessEvidence({ sourceValues: { alsoContains: field('Squadron 42 Digital Download') } }), { starCitizen: false, squadron42: true, upgradeOnly: false });
});
test('Only exact names count, with whitespace/case normalization and no name/description inference', () => {
  assert.equal(gameAccessEvidence({ sourceValues: { items: field(' STAR   CITIZEN digital DOWNLOAD ') } }).starCitizen, true);
  for (const title of ['Star Citizen', 'Star Citizen Digital Download Poster', 'Not Star Citizen Digital Download', 'Digital Star Citizen Manual', 'Squadron 42 Manual']) {
    assert.deepEqual(gameAccessEvidence({ sourceValues: { items: field(title) } }), { starCitizen: false, squadron42: false, upgradeOnly: false });
  }
  const pledge = basePledge(); pledge.name = 'Star Citizen Digital Download'; pledge.originalDescription = 'Squadron 42 Digital Download';
  assert.equal(gameAccessEvidence(pledge).starCitizen, false);
});
test('Malformed, oversized, nonarray and mixed-invalid source fields remain unproven', () => {
  for (const items of ['{', 'null', '{}', '"Star Citizen Digital Download"', field('Star Citizen Digital Download')+' '.repeat(4000), JSON.stringify([{ title: 'Star Citizen Digital Download' }, { title: 42 }]), JSON.stringify(Array.from({ length: 101 }, () => ({ title: 'Star Citizen Digital Download' }))), field('X'.repeat(501))]) {
    assert.equal(gameAccessEvidence({ sourceValues: { items } }).starCitizen, false);
  }
  assert.equal(gameAccessEvidence({ sourceValues: { items: '{', alsoContains: field('Squadron 42 Digital Download') } }).squadron42, true);
});
test('Doubled entries and unrelated fields cannot imply uniqueness or reset access evidence', () => {
  const sourceValues = { items: field('Star Citizen Digital Download', 'Star Citizen Digital Download'), alsoContains: field('Squadron 42 Digital Download') };
  Object.defineProperty(sourceValues, 'secret', { get() { throw Error('Unrelated field must not be inspected'); } });
  assert.deepEqual(gameAccessEvidence({ sourceValues }), { starCitizen: true, squadron42: true, upgradeOnly: true });
  assert.equal('unique' in gameAccessEvidence({ sourceValues }), false);
});
test('Local release flags cannot remove the combined-package preservation classification', () => {
  const pledge = basePledge(); pledge.protected = false; pledge.baseReleased = true;
  pledge.sourceValues = { items: field('Star Citizen Digital Download', 'Squadron 42 Digital Download') };
  assert.equal(gameAccessEvidence(pledge).upgradeOnly, true);
});
