import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { InventoryStore } from '../src/storage/database';
import { parseImport } from '../src/importers/files';
import { demoDocument } from './fixtures';
import type { InventoryDocument } from '../src/domain/model';
import initSqlJs from 'sql.js';
const root = path.resolve('work/temp/storage-tests', randomUUID());
const parse = (d: InventoryDocument) => parseImport(JSON.stringify(d));
async function store() { return InventoryStore.open(path.join(root, randomUUID(), 'inventory.sqlite')); }

test('Targeted demo deletion removes only its dependent rows, preserves real profiles and persists', async () => {
  let s = await store(); const file = s.file;
  const demo = s.createAccount('Synthetic demo', 'demo'), real = s.createAccount('Synthetic real', 'real');
  const c = parse(demoDocument()); s.commit(demo.id, c, true);
  const d = demoDocument(); d.dataMode = 'real'; d.account.reference = 'synthetic-real';
  s.commit(real.id, parse(d), true);
  const before = s.inventory(real.id), bytes = fs.readFileSync(file);
  assert.throws(() => s.deleteDemoAccount(real.id), /Echte/);
  assert.deepEqual(fs.readFileSync(file), bytes);
  s.deleteDemoAccount(demo.id);
  assert.throws(() => s.account(demo.id), /nicht gefunden/);
  assert.deepEqual(s.inventory(real.id), before);
  s.close(); s = await InventoryStore.open(file);
  try {
    assert.deepEqual(s.accounts().map(a => a.id), [real.id]);
    assert.deepEqual(s.inventory(real.id), before);
    const sql = await initSqlJs(), db = new sql.Database(fs.readFileSync(file));
    try {
      assert.deepEqual(db.exec('PRAGMA foreign_key_check'), []);
      for (const table of ['items','snapshots','buybacks']) {
        const q = db.prepare(`SELECT COUNT(*) FROM ${table} WHERE accountId = ?`);
        try { q.bind([demo.id]); q.step(); assert.equal(q.get()[0], 0); } finally { q.free(); }
      }
    } finally { db.close(); }
  } finally { s.close(); }
});

test('A failed demo deletion restores the in-memory profile and the original disk file', async () => {
  const s = await store(), rename = fs.renameSync;
  try {
    const a = s.createAccount('Synthetic demo', 'demo'); s.commit(a.id, parse(demoDocument()), true);
    const before = s.inventory(a.id), bytes = fs.readFileSync(s.file);
    fs.renameSync = (from,to) => { if (to === s.file) throw Error('SIMULATED DELETE WRITE FAILURE'); rename(from,to); };
    assert.throws(() => s.deleteDemoAccount(a.id), /SIMULATED/);
    assert.deepEqual(s.inventory(a.id), before); assert.deepEqual(fs.readFileSync(s.file), bytes);
  } finally { fs.renameSync = rename; s.close(); }
});
test('Kein Import ohne ausdrückliche Kontozuordnung; getrennte Profile', async () => {
  const s = await store(); try {
    const a = s.createAccount('Demo A', 'demo'), b = s.createAccount('Real', 'real'); const c = parse(demoDocument());
    assert.throws(() => s.commit(a.id, c, false), /bestätigt/); assert.throws(() => s.commit(b.id, c, true), /Demo/);
    s.commit(a.id, c, true); assert.equal(s.inventory(a.id).items.length, 5); assert.equal(s.inventory(b.id).items.length, 0);
    const other = s.createAccount('Demo B', 'demo'); assert.throws(() => s.commit(other.id, c, true), /anderen/);
  } finally { s.close(); }
});
test('DOM-Fallback verlangt bei jeder Übernahme ausdrückliche manuelle Zuordnung und schützt fremde Profile', async () => {
  const s = await store(); try {
    const a = s.createAccount('Synthetic DOM A', 'real'), b = s.createAccount('Synthetic DOM B', 'real');
    const d = demoDocument(); d.dataMode = 'real';
    d.account = { reference: `rsi-local:${a.id}`, identityKind: 'manual-reference' };
    d.scope = { kind: 'partial', exportComplete: false, expectedPledges: null, pagesExpected: null, pagesRead: 1 };
    const candidate = parse(d); candidate.adapter = 'rsi-dom-probe/1';
    assert.equal(s.preview(a.id, candidate).bindingRequired, true);
    assert.throws(() => s.commit(a.id, candidate, false), /bestätigt/);
    assert.equal(s.inventory(a.id).items.length, 0);
    assert.equal(s.commit(a.id, candidate, true).repeated, false);
    assert.equal(s.account(a.id).identityKind, 'manual-reference');
    assert.equal(s.account(a.id).reference, `rsi-local:${a.id}`);
    assert.equal(s.preview(a.id, candidate).bindingRequired, true);
    assert.throws(() => s.commit(a.id, candidate, false), /bestätigt/);
    assert.equal(s.commit(a.id, candidate, true).repeated, true);
    const next = structuredClone(d); next.createdAt = '2026-11-16T10:00:00Z'; next.pledges[0]!.name = 'Synthetic next observation';
    const nextCandidate = parse(next); nextCandidate.adapter = 'rsi-dom-probe/1';
    assert.equal(s.preview(a.id, nextCandidate).bindingRequired, true);
    assert.throws(() => s.commit(a.id, nextCandidate, false), /bestätigt/);
    assert.equal(s.inventory(a.id).items[0]!.pledge.name, d.pledges[0]!.name);
    assert.throws(() => s.commit(b.id, candidate, true), /anderen lokalen Profil/);
    const other = structuredClone(d); other.account.reference = `rsi-local:${b.id}`;
    const otherCandidate = parse(other); otherCandidate.adapter = 'rsi-dom-probe/1';
    s.commit(b.id, otherCandidate, true);
    assert.throws(() => s.preview(b.id, candidate), /anderen Kontoreferenz/);
    assert.throws(() => s.commit(b.id, candidate, true), /anderen Kontoreferenz/);
    assert.equal(s.account(b.id).reference, `rsi-local:${b.id}`);
  } finally { s.close(); }
});

test('Wiederimport erzeugt keine Duplikate, Vorschau mutiert nichts, SQLite überlebt Neustart', async () => {
  let s = await store(); const file = s.file; const a = s.createAccount('Demo', 'demo'); const c = parse(demoDocument());
  assert.equal(s.preview(a.id, c).changes.added, 5); assert.equal(s.inventory(a.id).items.length, 0);
  s.commit(a.id, c, true); assert.equal(s.commit(a.id, c, true).repeated, true);
  assert.equal(s.inventory(a.id).items.length, 5); s.close(); s = await InventoryStore.open(file);
  try { assert.equal(s.inventory(a.id).items.length, 5); assert.equal(s.inventory(a.id).buybacks.length, 1); }
  finally { s.close(); }
});
test('Fehlende Seite entfernt nichts; vollständiger Folgesnapshot markiert entfernt und erhält Historie', async () => {
  const s = await store(); try {
    const a = s.createAccount('Demo', 'demo'); s.commit(a.id, parse(demoDocument()), true);
    const d = demoDocument(); d.createdAt = '2026-11-15T09:00:00Z'; d.pledges.pop(); d.scope.pagesExpected = 3; d.scope.pagesRead = 2;
    s.commit(a.id, parse(d), true); assert.equal(s.inventory(a.id).items.filter(x => x.availability === 'present').length, 5);
    const oldComplete = s.account(a.id).lastComplete; assert.ok(oldComplete);
    d.createdAt = '2026-11-16T09:00:00Z'; d.scope.pagesRead = 3; d.scope.expectedPledges = 4;
    s.commit(a.id, parse(d), true); assert.equal(s.inventory(a.id).items.filter(x => x.availability === 'present').length, 4);
    assert.equal(s.inventory(a.id).items.filter(x => x.availability === 'removed').length, 1);
    assert.equal(s.commit(a.id, parse(demoDocument()), true).repeated, true);
    assert.equal(s.inventory(a.id).items.filter(x => x.availability === 'present').length, 4);
  } finally { s.close(); }
});
test('Kontoabweichung und ältere geänderte Datei werden nicht still übernommen', async () => {
  const s = await store(); try {
    const a = s.createAccount('Demo', 'demo'); s.commit(a.id, parse(demoDocument()), true);
    const d = demoDocument(); d.account.reference = 'different'; assert.throws(() => s.commit(a.id, parse(d), true), /andere/);
    d.account.reference = 'demo-account-alpha'; d.createdAt = '2026-11-13T00:00:00Z'; d.pledges.pop(); assert.throws(() => s.commit(a.id, parse(d), true), /älter/);
    assert.equal(s.inventory(a.id).items.length, 5);
  } finally { s.close(); }
});
test('Zukünftiges Dateidatum bleibt bei Vorschau und Übernahme gesperrt, alte Fehldaten blockieren keine Wiederherstellung', async () => {
  let s = await store();
  try {
    const file = s.file, a = s.createAccount('Demo', 'demo'), doc = demoDocument();
    doc.createdAt = '2010-01-02T00:00:00Z';
    s.commit(a.id, parse(doc), true);
    doc.createdAt = '2099-01-02T00:00:00Z';
    const future = parse(doc);
    assert.throws(() => s.preview(a.id, future), /Zukunft/);
    assert.throws(() => s.commit(a.id, future, true), /Zukunft/);
    s.close();
    const sql = await initSqlJs(), prior = new sql.Database(fs.readFileSync(file));
    prior.run('UPDATE snapshots SET sourceCreatedAt = ?', [doc.createdAt]);
    fs.writeFileSync(file, prior.export());
    prior.close();
    s = await InventoryStore.open(file);
    doc.createdAt = '2010-03-10T12:00:00+02:00';
    assert.equal(s.commit(a.id, parse(doc), true).repeated, false);
    doc.createdAt = '2010-03-10T11:00:00Z';
    assert.equal(s.commit(a.id, parse(doc), true).repeated, false);
    doc.createdAt = '2010-03-10T12:30:00+02:00';
    assert.throws(() => s.commit(a.id, parse(doc), true), /älter/);
  } finally { s.close(); }
});
test('Angewendetes CCU wird bei vollständigem Wiederimport nicht mehr frei angezeigt', async () => {
  const s = await store(); try {
    const a = s.createAccount('Demo', 'demo'); s.commit(a.id, parse(demoDocument()), true);
    const d = demoDocument(); d.createdAt = '2026-11-15T00:00:00Z'; d.pledges[2]!.ccus[0]!.status = 'applied';
    s.commit(a.id, parse(d), true);
    const free = s.inventory(a.id).items.flatMap(x => x.pledge.ccus).filter(x => x.status === 'unused'); assert.equal(free.length, 2);
  } finally { s.close(); }
});
test('Konsistente SQLite-Sicherung und portabler Export lassen sich separat öffnen; keine Sitzungen', async () => {
  const s = await store(); try {
    const a = s.createAccount('Demo', 'demo'); s.commit(a.id, parse(demoDocument()), true);
    const backup = s.backup('test'); const restored = await InventoryStore.open(backup);
    try { assert.deepEqual(restored.inventory(a.id), s.inventory(a.id)); } finally { restored.close(); }
    const exported = s.export(a.id); const c = parse(exported); assert.equal(c.document.pledges.length, 5);
    assert.equal(c.completeness, 'partial'); assert.ok(!JSON.stringify(exported).includes('cookie'));
    const second = await store(); try { const b = second.createAccount('Restored demo', 'demo'); second.commit(b.id, c, true);
      assert.deepEqual(second.inventory(b.id).items.map(x => x.pledge), s.inventory(a.id).items.map(x => x.pledge)); } finally { second.close(); }
  } finally { s.close(); }
});
test('Fehler beim atomaren Speichern verändert weder dauerhaften noch geöffneten Bestand', async () => {
  const s = await store(); const originalRename = fs.renameSync;
  try {
    const a = s.createAccount('Demo', 'demo'); s.commit(a.id, parse(demoDocument()), true);
    const before = fs.readFileSync(s.file); const d = demoDocument(); d.createdAt = '2026-11-15T00:00:00Z'; d.pledges[0]!.name = 'Synthetic change';
    fs.renameSync = (from, to) => { if (to === s.file) throw new Error('SIMULATED DISK FAILURE'); originalRename(from, to); };
    assert.throws(() => s.commit(a.id, parse(d), true), /SIMULATED/);
    assert.deepEqual(fs.readFileSync(s.file), before);
    assert.equal(s.inventory(a.id).items.find(x => x.pledge.pledgeId === 'demo-base-alpha')!.pledge.name, 'Demo-Basisschiff Alpha');
  } finally { fs.renameSync = originalRename; s.close(); }
});
test('Bestehendes SQLite v0 wird vor Migration gesichert; neuere Version unverändert abgewiesen', async () => {
  const sql = await initSqlJs(); const folder = path.join(root, randomUUID()); fs.mkdirSync(folder, { recursive: true });
  const file = path.join(folder, 'old.sqlite'); const old = new sql.Database(); old.run('CREATE TABLE preserved (value TEXT); INSERT INTO preserved VALUES ("SYNTHETIC");');
  fs.writeFileSync(file, old.export()); old.close(); const before = fs.readFileSync(file);
  const s = await InventoryStore.open(file); s.close();
  const backup = path.join(folder, 'backups', fs.readdirSync(path.join(folder, 'backups'))[0]!);
  assert.deepEqual(fs.readFileSync(backup), before);
  const upgraded = new sql.Database(fs.readFileSync(file)); assert.equal(upgraded.exec('SELECT value FROM preserved')[0]!.values[0]![0], 'SYNTHETIC'); upgraded.close();
  const futureFile = path.join(folder, 'future.sqlite'); const future = new sql.Database(); future.run('PRAGMA user_version=2');
  fs.writeFileSync(futureFile, future.export()); future.close(); const futureBefore = fs.readFileSync(futureFile);
  await assert.rejects(() => InventoryStore.open(futureFile), /neuer/); assert.deepEqual(fs.readFileSync(futureFile), futureBefore);
});
