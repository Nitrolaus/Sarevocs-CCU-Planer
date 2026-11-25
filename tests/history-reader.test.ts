import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { upgradeHistoryRequestSchema, upgradeHistoryResultSchema, verifiedUpgradePurchasesSchema, unavailableHistory } from '../src/domain/upgrade-history';

test('Upgradehistorien-DTOs lassen ausschließlich begrenzte bekannte Felder durch', () => {
  const valid = { status: 'loaded', steps: [{ from: 'Alpha', to: 'Beta', appliedAt: '2026-11-15 13:30' }], partial: false };
  assert.equal(upgradeHistoryResultSchema.safeParse(valid).success, true);
  for (const bad of [{ ...valid, html: '<script>' }, { ...valid, token: 'SYNTHETIC' }, { ...valid, steps: [{ ...valid.steps[0], price: 5 }] },
    { ...valid, steps: [{ from: 'Alpha\nSecret', to: 'Beta', appliedAt: null }] }, { ...valid, steps: Array.from({ length: 129 }, () => valid.steps[0]) },
    { ...valid, steps: [{ from: 'A'.repeat(201), to: 'Beta', appliedAt: null }] }, { ...valid, steps: [{ from: 'Alpha', to: 'Beta', appliedAt: '2026-02-31 25:99' }] }, { ...valid, status: 'unavailable' }]) assert.equal(upgradeHistoryResultSchema.safeParse(bad).success, false);
  assert.deepEqual(unavailableHistory('auth-required'), { status: 'auth-required', steps: [], partial: false });
});

test('Ein bestätigter Leerverlauf benötigt eine ausdrückliche widerspruchsfreie Antwort', () => {
  const empty = {status: 'loaded', steps: [], partial: false};
  assert.equal(verifiedUpgradePurchasesSchema.safeParse(empty).success, false);
  const explicit = {...empty, confirmedEmpty: true};
  assert.equal(verifiedUpgradePurchasesSchema.safeParse(explicit).success, true);
  for (const contradiction of [{status:'auth-required'}, {partial:true}, {confirmedEmpty:false},
    {steps:[{from:'Alpha', to:'Beta', appliedAt:'2026-11-15 13:30'}]},
    {purchases:[{ccuPledgeId:'5', price:{status:'excluded'}}]}]) {
    assert.equal(upgradeHistoryResultSchema.safeParse({...explicit, ...contradiction}).success, false);
    assert.equal(verifiedUpgradePurchasesSchema.safeParse({...explicit, ...contradiction}).success, false);
  }
});

test('Upgradehistorien-Anfrage verlangt Profil, Revision und eine positive sichere numerische Pledge-ID', () => {
  const valid = { accountId: randomUUID(), pledgeId: 123, revisionKey: randomUUID() };
  assert.equal(upgradeHistoryRequestSchema.safeParse(valid).success, true);
  for (const pledgeId of ['123', '123abc', 0, -1, 0.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.equal(upgradeHistoryRequestSchema.safeParse({ ...valid, pledgeId }).success, false);
  assert.equal(upgradeHistoryRequestSchema.safeParse({ ...valid, url: 'https://example.invalid' }).success, false);
});
