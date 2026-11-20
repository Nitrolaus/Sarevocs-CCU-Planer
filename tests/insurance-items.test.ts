import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseImport } from '../src/importers/files';

type Item = { title: string; kind: string };
function pledge(items: Item[], alsoContains: { title: string }[] = [], extra: Record<string, unknown> = {}) {
  return parseImport(JSON.stringify({ type: 'hangarexport', version: 2, handle: 'SYNTHETIC_INSURANCE_TEST',
    pledges: [{ pledgeId: 'synthetic-pledge', pledgeName: 'SYNTHETIC SHIP PACKAGE',
      items, alsoContains, ...extra }] })).document.pledges[0]!;
}
const ship = { title: 'Synthetic Alpha', kind: 'Ship' };

test('Explizite Insurance-Items belegen LTI auch ohne alsoContains', () => {
  for (const kind of ['Insurance', 'insurance', ' INSURANCE ']) {
    const p = pledge([ship, { title: ' Lifetime Insurance ', kind }]);
    assert.deepEqual(p.insurance, { kind: 'lti', evidence: 'Lifetime Insurance' });
    assert.equal(p.ships.length, 1);
    assert.equal(p.ships[0]!.modelName, ship.title);
  }
});

test('Insurance-Items erhalten begrenzte Monatsversicherung statt LTI', () => {
  for (const months of [6, 24, 120]) {
    const title = `${months} Month Insurance`;
    assert.deepEqual(pledge([ship, { title, kind: 'Insurance' }]).insurance,
      { kind: 'months', months, evidence: title });
  }
});

test('Versicherungsbelege beider Speicherorte werden zusammen ausgewertet', () => {
  const p = pledge([ship, { title: '24 Month Insurance', kind: 'Insurance' }],
    [{ title: '6 Month Insurance' }]);
  assert.deepEqual(p.insurance, { kind: 'months', months: 24, evidence: '24 Month Insurance' });
  const reversed = pledge([ship, { title: '6 Month Insurance', kind: 'Insurance' }],
    [{ title: '24 Month Insurance' }]);
  assert.deepEqual(reversed.insurance, { kind: 'months', months: 24, evidence: '24 Month Insurance' });
});

test('Exaktes LTI hat wie bisher Vorrang vor Monatsbelegen an beiden Orten', () => {
  const fromItems = pledge([ship, { title: 'Lifetime Insurance', kind: 'Insurance' }],
    [{ title: '120 Month Insurance' }]);
  const fromAdditional = pledge([ship, { title: '120 Month Insurance', kind: 'Insurance' }],
    [{ title: 'Lifetime Insurance' }]);
  const legacy = pledge([ship], [{ title: 'Lifetime Insurance' }]);
  for (const p of [fromItems, fromAdditional, legacy]) assert.deepEqual(p.insurance,
    { kind: 'lti', evidence: 'Lifetime Insurance' });
});

test('Warbond, ungefähre Titel und fremde Itemarten beweisen kein LTI', () => {
  for (const item of [
    { title: 'Lifetime Insurance', kind: 'Ship' },
    { title: 'Lifetime Insurance', kind: 'Paint' },
    { title: 'Lifetime Insurance', kind: '' },
    { title: 'Lifetime Insurance', kind: 'Insurance Bonus' },
    { title: 'Lifetime Insurance Bonus', kind: 'Insurance' },
    { title: 'Warbond', kind: 'Insurance' },
  ]) assert.equal(pledge([ship, item], [],
    { pledgeName: 'LTI Warbond Edition', contains: 'Lifetime Insurance' }).insurance.kind, 'unknown');
});

test('Mehrschiffpledges behalten ihre Kinder und den gemeinsamen expliziten LTI-Beleg', () => {
  const p = pledge([ship, { title: 'Synthetic Rover', kind: 'Vehicle' },
    { title: 'Lifetime Insurance', kind: 'Insurance' }]);
  assert.equal(p.insurance.kind, 'lti');
  assert.deepEqual(p.ships.map(child => child.modelName), ['Synthetic Alpha', 'Synthetic Rover']);
  assert.equal(new Set(p.ships.map(child => child.childId)).size, 2);
  assert.ok(p.ships.every(child => child.identity === 'unresolved' && child.role === 'unverified'));
});

test('Versicherungslesung ändert Schutz, Restriktionen, Kosten und CCU-Anwendbarkeit nicht', () => {
  const items = [ship, { title: 'Lifetime Insurance', kind: 'Insurance' }];
  const p = pledge(items, [], { giftable: false, meltable: false, pledgeValue: '1000',
    upgrade: { from: 'Synthetic Alpha', to: 'Synthetic Beta' } });
  assert.equal(p.insurance.kind, 'lti');
  assert.equal(p.ccus[0]!.insurance.kind, 'lti');
  assert.equal(p.ccus[0]!.status, 'unverified');
  assert.equal(p.ccus[0]!.applicability, 'unverified');
  assert.equal(p.protected, true); assert.equal(p.baseReleased, false);
  assert.equal(p.acquisitionCost, null); assert.equal(p.meltValue, null);
  assert.ok(p.restrictions.includes('Laut Export nicht einschmelzbar.'));
  assert.ok(p.restrictions.includes('Laut Export nicht verschenkbar.'));
  assert.equal(p.sourceValues.pledgeValue, '1000');
  assert.deepEqual(JSON.parse(p.sourceValues.items!), items);
});
