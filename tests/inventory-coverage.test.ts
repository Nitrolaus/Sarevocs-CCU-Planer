import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readHangarPages } from '../src/importers/hangar-read';
import { parseImport } from '../src/importers/files';
import { LastSeenStore } from '../src/storage/last-seen';
import { observedCcuInventoryKnown } from '../src/planner/inventory-coverage';
import { warbondStock } from '../src/planner/warbond-offers';
import { analyseReservations } from '../src/planner/reservations';
import type { Account } from '../src/domain/model';

const account: Account = { id: '11111111-1111-4111-8111-111111111111', name: 'Synthetic', mode: 'real',
  reference: null, identityKind: null, identityStatus: 'unbound', lastComplete: null };
const page = (n: number, count: number) => ({ ok: true, handle: 'Synthetic', activePage: n,
  pledges: Array.from({ length: count }, (_, i) => ({ pledgeId: `synthetic-${n}-${i}`, pledgeName: 'Synthetic item', items: [], alsoContains: [] })) });
const store = () => new LastSeenStore(path.resolve('work/temp/coverage-tests', randomUUID()));

test('29-page live traversal enables stock absence after persistence without declaring a destructive full import', async () => {
  const result = await readHangarPages({ accountId: account.id, initial: page(1, 10), restartAtFirst: false,
    assertActive: () => {}, sleep: async () => {}, loadPage: async n => page(n, n === 29 ? 1 : 10) });
  result.candidate.adapter = 'rsi-dom-probe/1';
  assert.deepEqual(result.candidate.hangarRead, { kind: 'reached-end', pagesRead: 29, pledgesRead: 281 });
  assert.equal(result.candidate.completeness, 'partial');
  assert.equal(result.candidate.document.scope.exportComplete, false);
  const cache = store(), view = cache.save(account, result.candidate);
  assert.equal(observedCcuInventoryKnown(view), true);
  assert.deepEqual(new LastSeenStore(cache.directory).load(account), view);
  assert.equal(observedCcuInventoryKnown(cache.load(account)!), true);
  assert.equal(account.lastComplete, null);
  assert.equal(warbondStock({ fromId: 1, toId: 2 }, { catalogue: [], pledges: view.document.pledges, ccus: [],
    inventoryKnown: true, complete: observedCcuInventoryKnown(view), reservations: analyseReservations([]),
    reservationsReady: true, excluded: [] }).state, 'missing');
});

test('old caches and ordinary partial files cannot acquire traversal evidence from page counts alone', async () => {
  const { candidate } = await readHangarPages({ accountId: account.id, initial: page(1, 2), restartAtFirst: false,
    assertActive: () => {}, loadPage: async () => { throw Error('Unexpected page'); } });
  const imported = parseImport(JSON.stringify(candidate.document));
  const cache = store();
  assert.equal(cache.save(account, imported).hangarRead, undefined);
  assert.equal(observedCcuInventoryKnown(cache.load(account)!), false);
  imported.hangarRead = candidate.hangarRead;
  assert.equal(cache.save(account, imported).hangarRead, undefined);
});

test('a new observation drops prior coverage and rejects mismatching evidence without replacing the cache', async () => {
  const { candidate } = await readHangarPages({ accountId: account.id, initial: page(1, 2), restartAtFirst: false,
    assertActive: () => {}, loadPage: async () => { throw Error('Unexpected page'); } });
  candidate.adapter = 'rsi-dom-probe/1';
  const cache = store(), original = cache.save(account, candidate);
  assert.throws(() => cache.save(account, { ...candidate, hangarRead: { ...candidate.hangarRead!, pledgesRead: 3 } }));
  assert.deepEqual(cache.load(account), original);
  const next = cache.save(account, { ...candidate, hangarRead: undefined });
  assert.equal(next.hangarRead, undefined);
  assert.equal(observedCcuInventoryKnown(next), false);
  const unresolved = structuredClone(original);
  unresolved.document.pledges[0]!.sourceValues.upgradeState = 'unresolved';
  assert.equal(observedCcuInventoryKnown(unresolved), false);
  unresolved.document.pledges[0]!.sourceValues.upgradeState = '';
  unresolved.hangarRead!.pagesRead++;
  assert.equal(observedCcuInventoryKnown(unresolved), false);
});

test('a short first page with a next link is followed before a successful traversal is recorded', async () => {
  const requests: number[] = [];
  const result = await readHangarPages({ accountId: account.id, initial: { ...page(1, 2), navigation: 'next' }, restartAtFirst: false,
    assertActive: () => {}, sleep: async () => {}, loadPage: async n => {
      requests.push(n); return { ...page(n, 2), navigation: n === 1 ? 'next' : 'last' };
    } });
  assert.deepEqual(requests, [1, 2]);
  assert.equal(result.candidate.hangarRead!.pledgesRead, 4);
  assert.equal(result.candidate.hangarRead!.pagesRead, 2);
});

test('failed page traversal cannot publish coverage or replace a valid saved observation', async () => {
  const { candidate } = await readHangarPages({ accountId: account.id, initial: page(1, 2), restartAtFirst: false,
    assertActive: () => {}, loadPage: async () => { throw Error('Unexpected page'); } });
  candidate.adapter = 'rsi-dom-probe/1';
  const cache = store(), original = cache.save(account, candidate);
  const before = fs.readFileSync(path.join(cache.directory, account.id + '.json'));
  await assert.rejects(() => readHangarPages({ accountId: account.id, initial: page(1, 10), restartAtFirst: false,
    assertActive: () => {}, sleep: async () => {}, loadPage: async n => n === 1 ? page(1, 10) : { ok: false } }));
  assert.deepEqual(cache.load(account), original);
  assert.deepEqual(fs.readFileSync(path.join(cache.directory, account.id + '.json')), before);
});

test('conflicting page totals may remain an additive observation but cannot prove stock absence', async () => {
  const result = await readHangarPages({ accountId: account.id, initial: page(1, 10), restartAtFirst: false,
    assertActive: () => {}, sleep: async () => {}, loadPage: async n => ({ ...page(n, n === 3 ? 1 : 10),
      totalPages: n === 1 ? 2 : 3, navigation: n === 3 ? 'last' : 'next' }) });
  assert.equal(result.candidate.document.pledges.length, 21);
  assert.equal(result.candidate.completeness, 'partial');
  assert.equal(result.candidate.hangarRead, undefined);
  result.candidate.adapter = 'rsi-dom-probe/1';
  assert.equal(observedCcuInventoryKnown(store().save(account, result.candidate)), false);
});
