import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { commandSchema } from '../src/main/commands';
import { mayReadObservedRevision, mayReadUpgradeHistory, purchaseCandidates } from '../src/main/upgrade-history-access';
import type { AccountInventory } from '../src/domain/model';
import type { LastSeen } from '../src/storage/last-seen';
import { demoDocument, basePledge } from './fixtures';

function fixture() {
  const id = randomUUID(), revision = randomUUID();
  const inventory: AccountInventory = { account: { id, mode: 'real', name: 'Synthetic', reference: null,
    identityKind: null, identityStatus: 'unbound', lastComplete: null }, items: [], buybacks: [] };
  const document = demoDocument(); document.dataMode = 'real'; document.pledges = [basePledge('12345')];
  const view: LastSeen = { schemaVersion: 1, accountId: id, revision, observedAt: '2026-11-15T13:00:00Z', document };
  const request = { accountId: id, revision, pledgeId: '12345' };
  return { id, inventory, view, request };
}
test('History capability only covers the selected real observed ship and current revision', () => {
  const f = fixture();
  assert.equal(mayReadUpgradeHistory(f.id, f.inventory, f.view, f.request), true);
  for (const mutate of [
    (x: ReturnType<typeof fixture>) => { x.id = randomUUID(); },
    (x: ReturnType<typeof fixture>) => { x.inventory.account.mode = 'demo'; },
    (x: ReturnType<typeof fixture>) => { x.view.accountId = randomUUID(); },
    (x: ReturnType<typeof fixture>) => { x.view.revision = randomUUID(); },
    (x: ReturnType<typeof fixture>) => { x.view.document.dataMode = 'demo'; },
    (x: ReturnType<typeof fixture>) => { x.request.pledgeId = '99999'; },
    (x: ReturnType<typeof fixture>) => { x.view.document.pledges[0]!.ships = []; },
    (x: ReturnType<typeof fixture>) => { x.view.document.pledges[0]!.sourceValues.upgradeState = 'unresolved'; },
    (x: ReturnType<typeof fixture>) => { x.view.document.pledges[0]!.ccus = demoDocument().pledges[2]!.ccus; },
    (x: ReturnType<typeof fixture>) => { x.inventory.account.lastComplete = x.view.observedAt; },
  ]) {
    const changed = fixture(); mutate(changed);
    assert.equal(mayReadUpgradeHistory(changed.id, changed.inventory, changed.view, changed.request), false);
  }
  assert.equal(mayReadUpgradeHistory(f.id, f.inventory, null, f.request), false);
});
test('History command admits only bounded numeric pledge IDs and UUID profile/revision, no extra body or URL', () => {
  const { request } = fixture(), good = { action: 'rsi.upgradeHistory', ...request };
  assert.equal(commandSchema.safeParse(good).success, true);
  for (const pledgeId of ['0', '-1', '1e3', '12.5', ' 123', '9007199254740992', '../123', 'demo-ship', '1'.repeat(17)]) {
    assert.equal(commandSchema.safeParse({ ...good, pledgeId }).success, false);
  }
  for (const extra of [{ url: 'https://example.invalid' }, { body: { pledge_id: 123 } }, { token: 'SYNTHETIC' }]) {
    assert.equal(commandSchema.safeParse({ ...good, ...extra }).success, false);
  }
  assert.equal(commandSchema.safeParse({ ...good, revision: 'old' }).success, false);
  assert.equal(commandSchema.safeParse({ ...good, accountId: 'other' }).success, false);
});

test('Die automatische Prüfung akzeptiert ausschließlich Profil und beobachtete Revision vom Renderer', () => {
  const { id, view } = fixture();
  const command = { action: 'rsi.purchaseHistories', accountId: id, revision: view.revision };
  assert.equal(commandSchema.safeParse(command).success, true);
  for (const extra of [{ pledgeId: '123' }, { ids: ['123'] }, { bases: [basePledge('123')] },
    { histories: ['123'] }, { owner: 'synthetic' }, { url: 'https://example.invalid' }, { body: { page: 1 } }]) {
    assert.equal(commandSchema.safeParse({ ...command, ...extra }).success, false);
  }
  assert.equal(commandSchema.safeParse({ ...command, revision: undefined }).success, false);
  assert.equal(commandSchema.safeParse({ ...command, accountId: 'not-a-uuid' }).success, false);
});

test('Nur die ausgewählte echte Beobachtung nach dem neuesten Import erlaubt die Sammelprüfung', () => {
  const { id, inventory, view, request } = fixture();
  inventory.items.push({ pledge: basePledge('98765'), availability: 'present', source: 'file', importedAt: '2026-11-15T12:00:00Z' });
  assert.equal(mayReadObservedRevision(id, inventory, view, request), true);
  assert.equal(mayReadObservedRevision(null, inventory, view, request), false);
  assert.equal(mayReadObservedRevision(id, inventory, undefined, request), false);
  assert.equal(mayReadObservedRevision(id, inventory, { ...view, accountId: randomUUID() }, request), false);
  assert.equal(mayReadObservedRevision(id, inventory, view, { ...request, revision: randomUUID() }), false);
  assert.equal(mayReadObservedRevision(id, { ...inventory, account: { ...inventory.account, mode: 'demo' } }, view, request), false);
  assert.equal(mayReadObservedRevision(id, inventory, { ...view, document: { ...view.document, dataMode: 'demo' } }, request), false);
  inventory.items[0]!.importedAt = view.observedAt;
  assert.equal(mayReadObservedRevision(id, inventory, view, request), false);
  inventory.items[0]!.importedAt = '2026-11-15T14:00:00Z';
  assert.equal(mayReadObservedRevision(id, inventory, view, request), false);
});

test('Fehlende Grundbelege und CCU-Verläufe werden unabhängig aus eindeutigen beobachteten Pledge-IDs gewählt', () => {
  const { view } = fixture();
  const modelChange = (id: string) => ({ ...basePledge(id), name: 'Standalone Ships - Demo Alpha' });
  const paid = { status: 'documented', source: 'order', minor: 2300, currency: 'EUR' } as const;
  const current = modelChange('3');
  current.ships[0]!.modelName = 'Demo Alpha';
  const bundle = modelChange('6');
  bundle.ships.push({ ...bundle.ships[0]!, childId: 'second-model' });
  const upgrade = demoDocument().pledges[2]!;
  view.document.pledges = [
    { ...modelChange('1'), rsiPurchase: paid },
    { ...modelChange('2'), rsiPurchase: { ...paid, source: 'log' } },
    current, modelChange('4'), { ...modelChange('5'), name: 'Package - Demo Alpha' }, bundle,
    { ...modelChange('7'), sourceValues: { upgradeState: 'unresolved' } }, { ...upgrade, pledgeId: '8' },
    { ...modelChange('9'), ships: [] }, { ...modelChange('10'), rsiPurchase: { status: 'excluded' } },
    modelChange('11'), modelChange('11'), modelChange('01'), modelChange('9007199254740992'), modelChange('import-only'),
  ];
  view.appliedPurchaseHistories = { '4': { status: 'loaded', partial: false, steps: [], confirmedEmpty: true } };
  const original = structuredClone(view);
  const selection = purchaseCandidates(view, []);
  assert.deepEqual(selection.bases.map(pledge => pledge.pledgeId), ['2', '3', '4', '5', '6', '7', '8']);
  assert.deepEqual(selection.histories, ['1', '2']);
  assert.deepEqual(view, original);
});
