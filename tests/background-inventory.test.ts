import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { BackgroundInventory } from '../src/main/background-inventory';
import { LastSeenStore } from '../src/storage/last-seen';
import { InventoryStore } from '../src/storage/database';
import { parseImport } from '../src/importers/files';
import { demoDocument } from './fixtures';
import type { Account, ImportCandidate } from '../src/domain/model';

const root = path.resolve('work/temp/background-inventory-tests', randomUUID());
function profile(): Account { return { id: randomUUID(), name: 'Synthetic background', mode: 'real', reference: null, identityKind: null, identityStatus: 'unbound', lastComplete: null }; }
function candidate(account: Account, name = 'Synthetic cached observation'): ImportCandidate {
  const document = demoDocument(); document.dataMode = 'real'; document.account = { reference: `rsi-local:${account.id}`, identityKind: 'manual-reference' };
  document.scope = { kind: 'partial', exportComplete: false, expectedPledges: null, pagesExpected: null, pagesRead: 1 };
  document.pledges[0]!.name = name;
  const value = parseImport(JSON.stringify(document)); value.adapter = 'rsi-dom-probe/1'; return value;
}
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
class CountingCache extends LastSeenStore {
  writes = 0;
  override save(...args: Parameters<LastSeenStore['save']>) { this.writes++; return super.save(...args); }
}
function setup(account = profile()) {
  const cache = new CountingCache(path.join(root, randomUUID()));
  const accounts = new Map([[account.id, account]]);
  const lookup = (id: string) => { const value = accounts.get(id); if (!value) throw new Error('Synthetic unknown profile'); return value; };
  return { account, accounts, lookup, cache };
}

test('Cache erscheint sofort während Restore; Erfolg ersetzt Revision und unveränderte Payload wird nicht wiederholt', { timeout: 5000 }, async () => {
  const { account, cache, lookup } = setup(), pending = deferred<ImportCandidate | null>();
  const saved = cache.save(account, candidate(account)); cache.writes = 0;
  let restores = 0;
  const coordinator = new BackgroundInventory(cache, lookup, () => { restores++; return pending.promise; }, async () => {});
  const job = coordinator.refresh(account.id);
  const connecting = coordinator.snapshot(account.id);
  assert.equal(connecting.status, 'connecting'); assert.equal(connecting.revision, saved.revision);
  assert.equal(connecting.changed, true); assert.deepEqual(connecting.view, saved);
  const unchanged = coordinator.snapshot(account.id, saved.revision);
  assert.equal(unchanged.status, 'connecting'); assert.equal(unchanged.changed, false); assert.equal('view' in unchanged, false);
  await tick();
  assert.equal(restores, 1); assert.equal(cache.writes, 0);
  pending.resolve(candidate(account, 'Synthetic refreshed observation')); await job;
  const connected = coordinator.snapshot(account.id, saved.revision);
  assert.equal(connected.status, 'connected'); assert.equal(connected.changed, true); assert.notEqual(connected.revision, saved.revision);
  assert.equal(connected.view?.document.pledges[0]!.name, 'Synthetic refreshed observation'); assert.equal(cache.writes, 1);
  const next = coordinator.snapshot(account.id, connected.revision!);
  assert.equal(next.changed, false); assert.equal('view' in next, false);
  assert.equal(new LastSeenStore(cache.directory).load(account)?.revision, connected.revision);
});

test('Keine Sitzung, Auth-Anforderung und Netzfehler behalten denselben Cache ohne Schreibversuch', { timeout: 5000 }, async () => {
  const cases = [{ result: 'none', status: 'auth-required' }, { result: 'auth', status: 'auth-required' }, { result: 'network', status: 'unavailable' }] as const;
  for (const scenario of cases) {
    const { account, cache, lookup } = setup(), saved = cache.save(account, candidate(account)); cache.writes = 0;
    const file = path.join(cache.directory, account.id + '.json'), bytes = fs.readFileSync(file);
    const coordinator = new BackgroundInventory(cache, lookup, async () => {
      if (scenario.result === 'auth') throw { code: 'auth-required' };
      if (scenario.result === 'network') throw new Error('SYNTHETIC_NETWORK_FAILURE');
      return null;
    }, async () => {});
    await coordinator.refresh(account.id);
    const snapshot = coordinator.snapshot(account.id);
    assert.equal(snapshot.status, scenario.status); assert.equal(snapshot.revision, saved.revision); assert.deepEqual(snapshot.view, saved);
    assert.equal(cache.writes, 0); assert.deepEqual(fs.readFileSync(file), bytes);
    assert.equal(coordinator.snapshot(account.id, saved.revision).changed, false);
  }
});

test('Pro Profil läuft genau ein Restore; verschiedene UUID-Profile dürfen unabhängig laden', { timeout: 5000 }, async () => {
  const { account: a, accounts, cache, lookup } = setup(), b = profile(); accounts.set(b.id, b);
  const ga = deferred<ImportCandidate | null>(), gb = deferred<ImportCandidate | null>(), calls: string[] = [];
  const coordinator = new BackgroundInventory(cache, lookup, id => { calls.push(id); return id === a.id ? ga.promise : gb.promise; }, async () => {});
  const first = coordinator.refresh(a.id), duplicate = coordinator.refresh(a.id), other = coordinator.refresh(b.id);
  await tick();
  assert.equal(first, duplicate); assert.notEqual(first, other); assert.deepEqual(calls, [a.id, b.id]);
  ga.resolve(candidate(a, 'Synthetic A')); gb.resolve(candidate(b, 'Synthetic B')); await Promise.all([first, other]);
  assert.equal(coordinator.snapshot(a.id).view?.document.pledges[0]!.name, 'Synthetic A');
  assert.equal(coordinator.snapshot(b.id).view?.document.pledges[0]!.name, 'Synthetic B');
  await coordinator.refresh(a.id); assert.deepEqual(calls, [a.id, b.id, a.id]);
});

test('Synchron werfendes Restore hinterlässt keinen erledigten Job und erlaubt einen echten Retry', { timeout: 5000 }, async () => {
  const { account, cache, lookup } = setup(); let restores = 0;
  const coordinator = new BackgroundInventory(cache, lookup, () => {
    restores++; if (restores === 1) throw new Error('SYNTHETIC_SYNC_FAILURE');
    return Promise.resolve(candidate(account, 'Synthetic retry observation'));
  }, async () => {});
  await coordinator.refresh(account.id); assert.equal(coordinator.snapshot(account.id).status, 'unavailable');
  await coordinator.refresh(account.id);
  assert.equal(restores, 2); assert.equal(coordinator.snapshot(account.id).status, 'connected');
  assert.equal(coordinator.snapshot(account.id).view?.document.pledges[0]!.name, 'Synthetic retry observation');
});

test('Live beobachteter Concierge-Rang bleibt beim gelesenen Profil im Arbeitsspeicher', async () => {
  const { account, accounts, cache, lookup } = setup();
  const other = profile(); accounts.set(other.id, other);
  const rank = { status: 'loaded', rank: 'Space Marshal', nextRank: 'Wing Commander', progress: 93 } as const;
  const coordinator = new BackgroundInventory(cache, lookup, async () => null, async () => {});
  coordinator.observe(account.id, candidate(account), rank);
  assert.deepEqual(coordinator.conciergeRank(account.id), rank);
  assert.equal(coordinator.conciergeRank(other.id), undefined);
  const file = path.join(cache.directory, account.id + '.json');
  assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /Space Marshal|conciergeRank/);
  const restarted = new BackgroundInventory(cache, lookup, async () => null, async () => {});
  assert.equal(restarted.conciergeRank(account.id), undefined);
  await coordinator.cancel(account.id);
  assert.equal(coordinator.conciergeRank(account.id), undefined);
  coordinator.observe(account.id, candidate(account), rank);
  await coordinator.refresh(account.id);
  assert.equal(coordinator.conciergeRank(account.id), undefined);
});

test('Abbruch wartet auf Close und Restore; verspätete Completion schreibt nichts und erzeugt keine neue Ansicht', { timeout: 5000 }, async () => {
  const { account, cache, lookup } = setup(), pending = deferred<ImportCandidate | null>(), closing = deferred<void>();
  const saved = cache.save(account, candidate(account)); cache.writes = 0;
  let closes = 0, cancelled = false, restores = 0;
  const coordinator = new BackgroundInventory(cache, lookup, () => { restores++; return restores === 1 ? pending.promise : Promise.resolve(candidate(account, 'Synthetic next refresh')); },
    () => { closes++; return closing.promise; });
  const job = coordinator.refresh(account.id); await tick();
  const cancellation = coordinator.cancel(account.id).then(() => { cancelled = true; });
  try {
    await tick(); assert.equal(cancelled, false); assert.equal(closes, 1); assert.equal(coordinator.snapshot(account.id).status, 'idle');
    pending.resolve(candidate(account, 'Synthetic stale completion')); await job;
    assert.equal(cancelled, false); assert.equal(cache.writes, 0);
    const retained = coordinator.snapshot(account.id, saved.revision);
    assert.equal(retained.changed, false); assert.equal('view' in retained, false); assert.equal(retained.revision, saved.revision);
  } finally { pending.resolve(null); closing.resolve(); await cancellation; }
  await coordinator.refresh(account.id);
  assert.equal(restores, 2); assert.equal(cache.writes, 1); assert.equal(coordinator.snapshot(account.id).view?.document.pledges[0]!.name, 'Synthetic next refresh');
});

test('Direkte Beobachtung bei aktivem Restore ist gesperrt; nach abgewartetem Abbruch bleibt neuer Stand erhalten', { timeout: 5000 }, async () => {
  const { account, cache, lookup } = setup(), pending = deferred<ImportCandidate | null>();
  const coordinator = new BackgroundInventory(cache, lookup, () => pending.promise, async () => {});
  const job = coordinator.refresh(account.id); await tick();
  assert.throws(() => coordinator.observe(account.id, candidate(account, 'Synthetic forbidden overlap')), /active/);
  assert.equal(cache.writes, 0);
  const cancellation = coordinator.cancel(account.id);
  pending.resolve(candidate(account, 'Synthetic older restore')); await Promise.all([job, cancellation]);
  assert.equal(cache.writes, 0);
  const newest = coordinator.observe(account.id, candidate(account, 'Synthetic newer direct observation'));
  assert.equal(coordinator.snapshot(account.id).revision, newest.revision);
  assert.equal(coordinator.snapshot(account.id).view?.document.pledges[0]!.name, 'Synthetic newer direct observation');
  assert.equal(cache.writes, 1);
});

test('Shutdown verhindert Late Writes, neue Restore-Jobs und direkte neue Beobachtungen', { timeout: 5000 }, async () => {
  const { account, cache, lookup } = setup(), pending = deferred<ImportCandidate | null>();
  const saved = cache.save(account, candidate(account)); cache.writes = 0;
  let restores = 0, closes = 0;
  const coordinator = new BackgroundInventory(cache, lookup, () => { restores++; return pending.promise; }, async () => { closes++; });
  const job = coordinator.refresh(account.id); await tick();
  const shutdown = coordinator.shutdown();
  assert.throws(() => coordinator.observe(account.id, candidate(account, 'Synthetic forbidden observation')));
  await coordinator.refresh(account.id); assert.equal(restores, 1);
  pending.resolve(candidate(account, 'Synthetic late shutdown completion')); await Promise.all([job, shutdown]);
  assert.equal(closes, 1); assert.equal(cache.writes, 0); assert.equal(coordinator.snapshot(account.id).revision, saved.revision);
  assert.equal(coordinator.snapshot(account.id, saved.revision).changed, false);
  await coordinator.refresh(account.id); assert.equal(restores, 1); await coordinator.shutdown(); assert.equal(closes, 1);
});

test('Ungeprüfte manuelle Beobachtung bleibt Cache und übernimmt nichts in den kanonischen Bestand', { timeout: 5000 }, async () => {
  const file = path.join(root, randomUUID(), 'inventory.sqlite');
  let inventory = await InventoryStore.open(file);
  const account = inventory.createAccount('Synthetic canonical separation', 'real');
  const cache = new LastSeenStore(path.join(root, randomUUID()));
  const coordinator = new BackgroundInventory(cache, id => inventory.account(id), async () => null, async () => {});
  try {
    const view = coordinator.observe(account.id, candidate(account));
    assert.equal(view.document.account.identityKind, 'manual-reference');
    assert.equal(view.document.account.reference, `rsi-local:${account.id}`);
    assert.equal(inventory.inventory(account.id).items.length, 0);
    assert.equal(inventory.account(account.id).reference, null); assert.equal(inventory.account(account.id).identityStatus, 'unbound');
    inventory.close(); inventory = await InventoryStore.open(file);
    assert.equal(inventory.inventory(account.id).items.length, 0); assert.equal(inventory.account(account.id).reference, null);
    assert.deepEqual(new LastSeenStore(cache.directory).load(account), view);
  } finally { inventory.close(); }
});

test('Nach anderer Profilbindung wird eine vorher geladene RAM-Ansicht nicht mehr ausgeliefert', { timeout: 5000 }, async () => {
  const { account, accounts, cache, lookup } = setup();
  const old = candidate(account); old.document.account = { reference: 'SYNTHETIC_HANDLE_A', identityKind: 'rsi-handle' };
  const coordinator = new BackgroundInventory(cache, lookup, async () => old, async () => {});
  const view = coordinator.observe(account.id, old);
  const file = path.join(cache.directory, account.id + '.json'), bytes = fs.readFileSync(file);
  accounts.set(account.id, { ...account, reference: 'SYNTHETIC_HANDLE_B', identityKind: 'rsi-handle', identityStatus: 'manual-confirmed' });
  const changed = coordinator.snapshot(account.id, view.revision);
  assert.equal(changed.status, 'unavailable'); assert.equal(changed.revision, null);
  assert.equal(changed.changed, true); assert.equal(changed.view, null);
  const repeated = coordinator.snapshot(account.id);
  assert.equal(repeated.revision, null); assert.equal(repeated.changed, false); assert.equal('view' in repeated, false);
  assert.throws(() => coordinator.observe(account.id, old));
  await coordinator.refresh(account.id);
  assert.equal(coordinator.snapshot(account.id).revision, null);
  assert.equal(coordinator.snapshot(account.id).status, 'unavailable');
  assert.deepEqual(fs.readFileSync(file), bytes);
  const fresh = candidate(account, 'Synthetic freshly matched B');
  fresh.document.account = { reference: 'SYNTHETIC_HANDLE_B', identityKind: 'rsi-handle' };
  const recovered = coordinator.observe(account.id, fresh);
  assert.equal(coordinator.snapshot(account.id).status, 'connected');
  assert.equal(coordinator.snapshot(account.id).revision, recovered.revision);
  assert.equal(coordinator.snapshot(account.id).view?.document.account.reference, 'SYNTHETIC_HANDLE_B');
  assert.notDeepEqual(fs.readFileSync(file), bytes);
  assert.deepEqual(new LastSeenStore(cache.directory).load(lookup(account.id)), recovered);
});
