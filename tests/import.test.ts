import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseImport, MAX_FILE_BYTES } from '../src/importers/files';
import { demoDocument, foreignDocument } from './fixtures';
const parse = (x: unknown) => parseImport(JSON.stringify(x));
test('Eigenes Schema: 5 Pledges, 3 konkrete CCUs, getrenntes Buyback; Demo bleibt Demo', () => {
  const r = parse(demoDocument());
  assert.equal(r.completeness, 'complete'); assert.equal(r.document.dataMode, 'demo');
  assert.equal(r.document.pledges.length, 5); assert.equal(r.document.pledges.flatMap(x => x.ccus).length, 3);
  assert.equal(r.document.buybacks.length, 1); assert.ok(r.warnings.some(x => x.startsWith('DEMO')));
});
test('Unbekannte, neuere, leere und beschädigte Formate werden abgewiesen', () => {
  for (const raw of ['[]', '{}', '{', '<script>evil()</script>', '{"type":"sarevocs-ccu-inventory","schemaVersion":2}']) assert.throws(() => parseImport(raw));
});
test('Fehlende Seiten und widersprechende Gesamtzahl sind niemals vollständig', () => {
  const d = demoDocument(); d.scope.pagesExpected = 3; d.scope.pagesRead = 2;
  assert.equal(parse(d).completeness, 'partial'); d.scope.pagesRead = 3; d.scope.expectedPledges = 6;
  assert.equal(parse(d).completeness, 'partial');
});
test('Geldbeträge verlangen ganzzahlige sichere Untereinheiten und Nachweis', () => {
  for (const n of [0.1, -1, Number.MAX_SAFE_INTEGER + 1]) {
    const d = demoDocument(); d.pledges[0]!.acquisitionCost = { minor: n, currency: 'USD', taxBasis: 'net', evidence: 'Synthetic' }; assert.throws(() => parse(d));
  }
});
test('Unbekannt ist nicht Null; LTI verlangt einen Nachweis', () => {
  const d = demoDocument(); d.pledges[0]!.unknownCostReason = null; assert.throws(() => parse(d));
  const raw = JSON.parse(JSON.stringify(demoDocument())); raw.pledges[0].insurance = { kind: 'lti' }; assert.throws(() => parse(raw));
});
test('Doppelte Pledge-, Kind- und CCU-IDs werden abgewiesen', () => {
  const a = demoDocument(); a.pledges.push(a.pledges[0]!); assert.throws(() => parse(a));
  const b = demoDocument(); b.pledges[0]!.ships.push(b.pledges[0]!.ships[0]!); assert.throws(() => parse(b));
  const c = demoDocument(); c.pledges[3]!.ccus[0]!.instanceId = c.pledges[2]!.ccus[0]!.instanceId; assert.throws(() => parse(c));
});
test('Dateigröße, UTF-8, unbekannte eigene Felder und ungültige Datentypen geprüft', () => {
  assert.throws(() => parseImport(Buffer.alloc(MAX_FILE_BYTES + 1)));
  assert.throws(() => parseImport(Buffer.from([0xff, 0xfe, 0xfa])));
  assert.throws(() => parse({ ...demoDocument(), sessionToken: 'SYNTHETIC_NOT_A_TOKEN' }));
});
test('HangarLink v2: Paketkinder, Versicherung und Buyback separat; keine Preisannahme', () => {
  const r = parse(foreignDocument()); const p = r.document.pledges[0]!;
  assert.equal(r.completeness, 'partial'); assert.equal(p.ships.length, 2); assert.equal(p.insurance.kind, 'lti');
  assert.equal(p.acquisitionCost, null); assert.equal(p.meltValue, null); assert.equal(p.sourceValues.pledgeValue, '3500');
  assert.equal(r.document.buybacks[0]!.entryId, '80001'); assert.equal(r.document.pledges[1]!.ccus[0]!.status, 'unverified');
});
test('HangarLink v2: identische CCUs bleiben getrennte Exemplare; Variante wird nicht zusammengeführt', () => {
  const d = foreignDocument(); const c = structuredClone(d.pledges[1]!); c.pledgeId = 'fixture-102'; d.pledges.push(c);
  const r = parse(d); assert.notEqual(r.document.pledges[1]!.ccus[0]!.instanceId, r.document.pledges[2]!.ccus[0]!.instanceId);
  assert.equal(r.document.pledges[0]!.ships[0]!.identity, 'unresolved');
});
test('HangarLink v2: strukturiertes Upgrade gilt bei lokalisiertem oder widersprechendem Titel', () => {
  for (const pledgeName of ['Aufwertung - Demo Alpha auf Demo Gamma', 'Upgrade - Demo Beta to Demo Delta']) {
    const d = foreignDocument();
    d.pledges[1] = { ...d.pledges[1]!, pledgeName, ...{ upgrade: { from: ' Demo Alpha ', to: ' Demo Gamma ' } } };
    const p = parse(d).document.pledges[1]!;
    assert.equal(p.ccus.length, 1);
    assert.deepEqual(p.ccus[0], { instanceId: 'fixture-101:ccu', from: 'Demo Alpha', to: 'Demo Gamma',
      status: 'unverified', applicability: 'unverified', insurance: p.insurance });
    assert.equal(p.insurance.kind, 'unknown');
    assert.equal(p.sourceValues.upgrade, JSON.stringify({ from: 'Demo Alpha', to: 'Demo Gamma' }));
  }
});
test('HangarLink v2: gleiche strukturierte Upgrades behalten getrennte Exemplarkennungen', () => {
  const d = foreignDocument();
  const c = { ...d.pledges[1]!, pledgeName: 'Synthetische Aufwertung', upgrade: { from: 'Demo Alpha', to: 'Demo Gamma' } };
  d.pledges[1] = c; d.pledges.push({ ...c, pledgeId: 'fixture-102' });
  const ccus = parse(d).document.pledges.flatMap(p => p.ccus);
  assert.equal(ccus.length, 2);
  assert.deepEqual(ccus.map(c => c.instanceId), ['fixture-101:ccu', 'fixture-102:ccu']);
  assert.deepEqual(ccus.map(c => [c.from, c.to]), [['Demo Alpha', 'Demo Gamma'], ['Demo Alpha', 'Demo Gamma']]);
});
test('HangarLink v2: leere und fehlerhafte strukturierte Upgrades werden statt Titel-Fallback abgewiesen', () => {
  for (const upgrade of [null, '', [], {}, { from: 'Demo Alpha' }, { from: '', to: 'Demo Gamma' },
    { from: 'Demo Alpha', to: '   ' }, { from: 1, to: 'Demo Gamma' },
    { from: 'A'.repeat(501), to: 'Demo Gamma' }, { from: 'Demo Alpha', to: 'B'.repeat(501) },
    { from: 'Demo Alpha', to: 'Demo Gamma', extra: true }]) {
    const d = foreignDocument(); d.pledges[1] = { ...d.pledges[1]!, ...{ upgrade } };
    assert.throws(() => parse(d), /HangarLink-Export passt nicht/);
  }
});
test('HangarLink v2: Upgrade-Titel bleibt Fallback ohne strukturiertes Feld', () => {
  const p = parse(foreignDocument()).document.pledges[1]!;
  assert.equal(p.ccus.length, 1);
  assert.deepEqual(p.ccus[0], { instanceId: 'fixture-101:ccu', from: 'Demo Alpha', to: 'Demo Gamma',
    status: 'unverified', applicability: 'unverified', insurance: p.insurance });
  assert.equal(p.sourceValues.upgrade, undefined);
});
test('HangarLink v2: unklare strukturierte CCUs erhalten den Pledge ohne Titel-Fallback', () => {
  for (const upgradeIssue of ['ambiguous', 'unreadable'] as const) {
    for (const upgrade of [undefined, { from: 'Wrong Alpha', to: 'Wrong Beta' }]) {
      const d = foreignDocument();
      d.pledges[1] = { ...d.pledges[1]!, ...{ upgradeIssue, ...(upgrade ? { upgrade } : {}) } };
      const result = parse(d), p = result.document.pledges[1]!;
      assert.equal(p.name, 'Upgrade - Demo Alpha to Demo Gamma');
      assert.equal(p.pledgeId, 'fixture-101'); assert.equal(result.document.pledges.length, 2);
      assert.deepEqual(p.ccus, []); assert.equal(p.sourceValues.upgradeState, 'unresolved');
      assert.equal(p.sourceValues.upgrade, undefined);
      assert.ok(p.restrictions.some(text => /CCU-Zuordnung ungeklärt/.test(text)));
      assert.ok(result.warnings.some(text => /CCU-Zuordnung ist ungeklärt/.test(text)));
      assert.equal(result.completeness, 'partial'); assert.equal(p.protected, true);
    }
  }
});
test('HangarLink v2: bekannte und ungeklärte CCUs sowie normale Pledges bleiben zusammen erhalten', () => {
  const d = foreignDocument();
  d.pledges.push({ ...d.pledges[1]!, pledgeId: 'fixture-unresolved', ...{ upgradeIssue: 'unreadable',
    privateUpgradeJson: 'SYNTHETIC_UNKNOWN_UPGRADE_CANARY' } });
  const result = parse(d);
  assert.equal(result.document.pledges.length, 3);
  assert.equal(result.document.pledges[0]!.ships.length, 2);
  assert.equal(result.document.pledges[1]!.ccus.length, 1);
  assert.deepEqual(result.document.pledges[2]!.ccus, []);
  assert.equal(result.document.pledges[2]!.sourceValues.upgradeState, 'unresolved');
  assert.equal(JSON.stringify(result).includes('SYNTHETIC_UNKNOWN_UPGRADE_CANARY'), false);
});
test('HangarLink v2: nur feste Upgrade-Issue-Kennungen sind zulässig', () => {
  for (const upgradeIssue of ['unknown', 'SYNTHETIC_RAW_ERROR', 1, null, {}]) {
    const d = foreignDocument(); d.pledges[1] = { ...d.pledges[1]!, ...{ upgradeIssue } };
    assert.throws(() => parse(d), /HangarLink-Export passt nicht/);
  }
});
test('120 Monate und Warbond sind kein LTI', () => {
  const d = foreignDocument(); d.pledges[0]!.alsoContains = [{ title: '120 Month Insurance' }, { title: 'Warbond' }];
  assert.deepEqual(parse(d).document.pledges[0]!.insurance, { kind: 'months', months: 120, evidence: '120 Month Insurance' });
  d.pledges[0]!.alsoContains = [{ title: 'Warbond' }]; assert.equal(parse(d).document.pledges[0]!.insurance.kind, 'unknown');
});
test('Fremde Skripte und ungewöhnliche URLs bleiben Daten; keine Ausführung oder URL-Übernahme', () => {
  const d = foreignDocument(); d.pledges[0]!.pledgeName = '<img src=x onerror=process.exit(1)>';
  d.buybacks[0]!.buybackHref = 'javascript:evil()'; d.buybacks[0]!.pledgeId = 'synthetic-safe-id';
  const r = parse(d); assert.equal(r.document.pledges[0]!.name, d.pledges[0]!.pledgeName);
  assert.equal('buybackHref' in r.document.buybacks[0]!, false);
});
