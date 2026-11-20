import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { LastSeenStore } from '../src/storage/last-seen';
import { parseImport } from '../src/importers/files';
import { demoDocument } from './fixtures';
import type { Account, ImportCandidate } from '../src/domain/model';

const root = path.resolve('work/temp/last-seen-tests', randomUUID());
function profile(name = 'Synthetic profile'): Account {
  return { id: randomUUID(), name, mode: 'real', reference: null, identityKind: null, identityStatus: 'unbound', lastComplete: null };
}
function candidate(account: Account, reference = `rsi-local:${account.id}`, kind: 'manual-reference' | 'rsi-handle' = 'manual-reference'): ImportCandidate {
  const document = demoDocument(); document.dataMode = 'real'; document.account = { reference, identityKind: kind };
  document.scope = { kind: 'partial', exportComplete: false, expectedPledges: null, pagesExpected: null, pagesRead: 1 };
  const value = parseImport(JSON.stringify(document)); value.adapter = 'rsi-dom-probe/1'; return value;
}
function cache() { return new LastSeenStore(path.join(root, randomUUID())); }

test('Letzter Stand überlebt Neustart mit stabiler Revision und vollständigem Cache-Payload', () => {
  const account = profile(), first = cache(), source = candidate(account);
  assert.equal(first.load(account), null);
  const saved = first.save(account, source);
  assert.match(saved.revision, /^[0-9a-f-]{36}$/i); assert.ok(Number.isFinite(Date.parse(saved.observedAt)));
  const restarted = new LastSeenStore(first.directory);
  assert.deepEqual(restarted.load(account), saved);
  assert.deepEqual(saved.document, source.document);
  assert.equal(saved.document.account.identityKind, 'manual-reference');
  assert.equal(account.reference, null); assert.equal(account.identityStatus, 'unbound'); assert.equal(account.lastComplete, null);
  const changed = structuredClone(source); changed.document.pledges[0]!.name = 'Synthetic next observation';
  const newer = restarted.save(account, changed, restarted.load(account));
  assert.notEqual(newer.revision, saved.revision);
  assert.equal(new LastSeenStore(first.directory).load(account)?.document.pledges[0]!.name, 'Synthetic next observation');
});

test('Sitzungsablage verlangt einen gelesenen Handle und berücksichtigt Cache oder bestätigte Bindung', () => {
  const store = cache(), a = profile();
  const handle = (reference: string) => ({reference, identityKind: 'rsi-handle' as const});
  assert.equal(store.canRemember(a, candidate(a).document.account), false);
  assert.equal(store.canRemember(a, handle('synthetic-one')), true);
  store.save(a, candidate(a, 'synthetic-one', 'rsi-handle'));
  assert.equal(store.canRemember(a, handle('synthetic-two')), false);
  assert.equal(store.canRemember(a, handle('synthetic-one')), true);
  assert.equal(store.canRemember({...a, reference: 'synthetic-two', identityKind: 'rsi-handle'}, handle('synthetic-one')), false);
  assert.equal(store.canRemember({...a, mode: 'demo'}, handle('synthetic-one')), false);
});
test('Cache trennt UUID-Profile und weist unter fremdem Dateinamen abgelegte Bestände ab', () => {
  const store = cache(), a = profile('Synthetic same name'), b = profile('Synthetic same name');
  const ca = candidate(a), cb = candidate(b); ca.document.pledges[0]!.name = 'Synthetic A'; cb.document.pledges[0]!.name = 'Synthetic B';
  store.save(a, ca); store.save(b, cb);
  assert.equal(store.load(a)?.document.pledges[0]!.name, 'Synthetic A');
  assert.equal(store.load(b)?.document.pledges[0]!.name, 'Synthetic B');
  const fileA = path.join(store.directory, a.id + '.json'), fileB = path.join(store.directory, b.id + '.json');
  const originalA = fs.readFileSync(fileA);
  fs.copyFileSync(fileA, fileB);
  assert.throws(() => store.load(b), /Profil/);
  assert.deepEqual(fs.readFileSync(fileA), originalA);
});

test('Gebundene Kontoreferenz und Identitätsart dürfen vom Cache weder geändert noch umgangen werden', () => {
  const store = cache(), account = profile(); account.reference = 'SYNTHETIC_HANDLE'; account.identityKind = 'rsi-handle';
  const saved = store.save(account, candidate(account, 'SYNTHETIC_HANDLE', 'rsi-handle'));
  const file = path.join(store.directory, account.id + '.json'), before = fs.readFileSync(file);
  for (const next of [candidate(account, 'SYNTHETIC_OTHER', 'rsi-handle'), candidate(account)]) {
    assert.throws(() => store.save(account, next, saved), /Profil|ueberein/);
    assert.deepEqual(fs.readFileSync(file), before);
  }
  assert.throws(() => store.load({ ...account, reference: 'SYNTHETIC_OTHER' }), /Profil/);
  assert.deepEqual(store.load(account), saved);
});

test('Vorheriger RSI-Handle schützt auch ein noch ungebundenes Profil vor anderem oder fehlendem Handle', () => {
  const store = cache(), account = profile();
  const saved = store.save(account, candidate(account, 'SYNTHETIC_HANDLE', 'rsi-handle'));
  const previous = new LastSeenStore(store.directory).load(account);
  for (const incoming of [candidate(account, 'SYNTHETIC_OTHER', 'rsi-handle'), candidate(account)]) {
    assert.throws(() => store.save(account, incoming, previous), /Konto hat sich geaendert/);
    assert.deepEqual(store.load(account), saved);
  }
});

test('Gespeicherter RSI-Handle bleibt auch nach Neustart ohne mitgegebenes previous gegen Wechsel geschützt', () => {
  const store = cache(), account = profile();
  const saved = store.save(account, candidate(account, 'SYNTHETIC_HANDLE', 'rsi-handle'));
  const file = path.join(store.directory, account.id + '.json'), bytes = fs.readFileSync(file);
  for (const incoming of [candidate(account, 'SYNTHETIC_OTHER', 'rsi-handle'), candidate(account)]) {
    const restarted = new LastSeenStore(store.directory);
    assert.throws(() => restarted.save(account, incoming));
    assert.deepEqual(fs.readFileSync(file), bytes);
    assert.deepEqual(restarted.load(account), saved);
  }
});

test('Bestätigte Bindung erlaubt nur passenden frischen Cache als Ersatz einer älteren abgeleiteten Identität', () => {
  const store = cache(), account = profile();
  const old = store.save(account, candidate(account, 'SYNTHETIC_HANDLE_A', 'rsi-handle'));
  const bound: Account = { ...account, reference: 'SYNTHETIC_HANDLE_B', identityKind: 'rsi-handle', identityStatus: 'manual-confirmed' };
  const file = path.join(store.directory, account.id + '.json'), bytes = fs.readFileSync(file);
  assert.throws(() => store.save(bound, candidate(account, 'SYNTHETIC_HANDLE_A', 'rsi-handle'), old));
  assert.deepEqual(fs.readFileSync(file), bytes);
  const newer = new LastSeenStore(store.directory).save(bound, candidate(account, 'SYNTHETIC_HANDLE_B', 'rsi-handle'), old);
  assert.equal(newer.document.account.reference, bound.reference);
  assert.notEqual(newer.revision, old.revision);
  assert.deepEqual(new LastSeenStore(store.directory).load(bound), newer);
});

test('Bestellpreis bleibt bei Teilausfall zum Pledge erhalten, bis neuer Ausschluss oder anderer Erwerb vorliegt', () => {
  const store = cache(), a = profile();
  const first = candidate(a, 'synthetic-handle', 'rsi-handle');
  const price = { status: 'documented', source: 'order', minor: 2099, currency: 'EUR' } as const;
  first.document.pledges[0]!.rsiPurchase = price;
  store.save(a, first);
  const next = candidate(a, 'synthetic-handle', 'rsi-handle');
  assert.deepEqual(store.save(a, next).document.pledges[0]!.rsiPurchase, price);
  next.document.pledges[0]!.rsiPurchase = { ...price, source: 'log', minor: 2500, currency: 'USD' };
  assert.deepEqual(store.save(a, next).document.pledges[0]!.rsiPurchase, price);
  next.document.pledges[0]!.rsiPurchase = { status: 'excluded' };
  assert.deepEqual(store.save(a, next).document.pledges[0]!.rsiPurchase, { status: 'excluded' });
  delete next.document.pledges[0]!.rsiPurchase;
  next.document.pledges[0]!.sourceValues.date = 'Dec 02, 2026';
  assert.equal(store.save(a, next).document.pledges[0]!.rsiPurchase, undefined);
  store.save(a, first);
  const other: Account = { ...a, reference: 'other-handle', identityKind: 'rsi-handle' };
  assert.equal(store.save(other, candidate(a, 'other-handle', 'rsi-handle')).document.pledges[0]!.rsiPurchase, undefined);
});

test('Manuelle Referenzen gehören genau zu einer UUID; Demo und ungültige Cache-Dokumente werden abgewiesen', () => {
  const store = cache(), a = profile(), b = profile();
  assert.throws(() => store.save(a, candidate(b)), /Profil/);
  const demo = candidate(a); demo.document.dataMode = 'demo'; assert.throws(() => store.save(a, demo), /Profil/);
  assert.throws(() => store.save({ ...a, mode: 'demo' }, candidate(a)), /Profil/);
  assert.throws(() => store.save({ ...a, id: '../outside' }, candidate(a)));
  const invalid = candidate(a); invalid.document.pledges[0]!.acquisitionCost = { minor: -1, currency: 'USD', taxBasis: 'net', evidence: 'Synthetic' };
  assert.throws(() => store.save(a, invalid)); assert.equal(store.load(a), null);
});

test('Ausgewähltes Profil bleibt nach Neustart erhalten; ungültige Auswahl fällt nur auf vorhandene Profile zurück', () => {
  const store = cache(), a = profile('Synthetic A'), b = profile('Synthetic B'), demo = { ...profile('Synthetic demo'), mode: 'demo' as const };
  store.select(b.id);
  assert.equal(new LastSeenStore(store.directory).selected([demo, a, b]), b.id);
  store.select(randomUUID()); assert.equal(store.selected([demo, a, b]), a.id);
  fs.writeFileSync(path.join(store.directory, 'selected.json'), '{'); assert.equal(store.selected([demo, a, b]), a.id);
  fs.writeFileSync(path.join(store.directory, 'selected.json'), JSON.stringify({ accountId: '../outside' }));
  assert.equal(store.selected([demo, a, b]), a.id);
  assert.equal(store.selected([demo]), demo.id); assert.equal(store.selected([]), null);
  assert.throws(() => store.select('../outside'));
});

test('Beschädigter oder profilfremder gespeicherter Cache wird nicht als letzter Stand ausgegeben', () => {
  const store = cache(), account = profile(); store.save(account, candidate(account));
  const file = path.join(store.directory, account.id + '.json');
  fs.writeFileSync(file, '{'); assert.throws(() => store.load(account), /nicht lesbar/);
  fs.writeFileSync(file, JSON.stringify({ schemaVersion: 99 })); assert.throws(() => store.load(account), /nicht lesbar/);
});
