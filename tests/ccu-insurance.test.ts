import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Insurance, Pledge } from '../src/domain/model';
import { ccuInsuranceDisplay } from '../src/ui/ccu-insurance';
import { basePledge } from './fixtures';

const unknown: Insurance = { kind: 'unknown', reason: 'Synthetic' };
const lti: Insurance = { kind: 'lti', evidence: 'Synthetic acquired LTI bonus' };
const months = (count: number): Insurance => ({ kind: 'months', months: count, evidence: 'Synthetic acquired monthly bonus' });
function withCcus(...insurance: Insurance[]): Pledge {
  const p = basePledge();
  p.ccus = insurance.map((value, index) => ({ instanceId: 'synthetic-' + index, from: 'Synthetic A', to: 'Synthetic B', status: 'unverified', applicability: 'unverified', insurance: value }));
  return p;
}

test('Normale Schiffe behalten ihre bisherige Versicherungsanzeige', () => {
  const p = basePledge();
  for (const insurance of [unknown, lti, months(6)]) { p.insurance = insurance; assert.equal(ccuInsuranceDisplay(p), null); }
});

test('CCU ohne Bonusbeleg zeigt Basis gilt neutral statt Unbekannt', () => {
  for (const p of [withCcus(unknown), withCcus(unknown, unknown)]) {
    const shown = ccuInsuranceDisplay(p)!;
    assert.equal(shown.label, 'Basis gilt'); assert.equal(shown.tone, 'neutral');
    assert.ok(shown.title.includes('Basisversicherung erhalten') && shown.title.includes('nicht addiert'));
  }
});

test('Explizite einzelne LTI- oder Monatsboni bleiben sichtbar', () => {
  assert.equal(ccuInsuranceDisplay(withCcus(lti))?.label, '+LTI');
  assert.equal(ccuInsuranceDisplay(withCcus(months(120)))?.label, '+120 Mon.');
  assert.equal(ccuInsuranceDisplay(withCcus(months(120), months(120)))?.label, '+120 Mon.');
});

test('Unabhängige unterschiedliche oder teilweise unbekannte CCUs werden nicht maximiert', () => {
  for (const p of [withCcus(months(6), months(120)), withCcus(lti, months(120)), withCcus(lti, unknown)]) {
    const shown = ccuInsuranceDisplay(p)!;
    assert.equal(shown.label, 'Zusatz prüfen'); assert.equal(shown.tone, 'check');
    assert.ok(shown.title.includes('Exemplare einzeln prüfen'));
    assert.ok(!shown.label.includes('120') && !shown.label.includes('LTI'));
  }
});

test('Pledge-Basis wird nicht als CCU-Bonus missverstanden', () => {
  const p = withCcus(unknown); p.insurance = lti;
  assert.equal(ccuInsuranceDisplay(p)?.label, 'Basis gilt');
  p.insurance = months(120); assert.equal(ccuInsuranceDisplay(p)?.label, 'Basis gilt');
});

test('Ungeklärte CCU ohne Endpunkte behält Basis und leitet keinen Bonus aus Pledge ab', () => {
  const p = basePledge(); p.insurance = lti; p.sourceValues.upgradeState = 'unresolved';
  const shown = ccuInsuranceDisplay(p)!;
  assert.equal(shown.label, 'Basis gilt'); assert.ok(shown.title.includes('CCU-Zuordnung ungeklärt'));
  assert.ok(shown.title.includes('Vorhandener Pledge-Beleg: LTI'));
});

test('Ungeklärte Zuordnung mit CCU-Einträgen behauptet keinen gesicherten Zusatz', () => {
  const p = withCcus(lti); p.sourceValues.upgradeState = 'unresolved';
  assert.equal(ccuInsuranceDisplay(p)?.label, 'Zusatz prüfen');
});

test('Anzeige verändert weder Daten noch Versicherung, Schutz oder Anwendbarkeit', () => {
  const p = withCcus(months(120)); p.insurance = months(6);
  const before = structuredClone(p); ccuInsuranceDisplay(p); assert.deepEqual(p, before);
});
