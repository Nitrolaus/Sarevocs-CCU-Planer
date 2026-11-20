import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { commandSchema } from '../src/main/commands';
import { mayReadUpgradeHistory } from '../src/main/upgrade-history-access';
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
