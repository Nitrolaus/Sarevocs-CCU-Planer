import test from 'node:test';
import assert from 'node:assert/strict';
import { parseImport } from '../src/importers/files';
import { prepareChains, buildChain } from '../src/planner/chain';
import { anchorFromStep, emptyDraft } from '../src/planner/draft';
import { manualChain } from '../src/planner/manual';
import { observedStandaloneCcu } from '../src/planner/observation';
import { basePledge } from './fixtures';
import type { CatalogueShip, TargetOffer } from '../src/market/model';

const observation = { kind: 'rsi-hangar' as const, observedAt: new Date().toISOString() };
const ships: CatalogueShip[] = ['Demo Alpha', 'Demo Gamma', 'Demo Delta', 'Alternative'].map((name, i) =>
  ({ id: i + 1, name, chassisId: null, manufacturer: 'Synthetic', manufacturerCode: 'TEST', status: 'unknown', focus: '', length: null }));
const offers: TargetOffer[] = ships.map((s, i) => ({ key: 'test:' + i, name: 'Upgrade to ' + s.name, targetName: s.name,
  toShipId: s.id, toSkuId: 100 + i, regularMinor: [1000, 2000, 4000, 5000][i]!, warbondMinor: null, warbond: false,
  currency: 'USD', taxBasis: 'net', verification: 'target-observation', firstSeenAt: observation.observedAt, lastSeenAt: observation.observedAt,
  change: 'current', previousRegularMinor: null, previousWarbondMinor: null }));
function upgrade(id = 'synthetic-1', from = 'Demo Alpha', to = 'Demo Gamma') {
  return parseImport(JSON.stringify({ type: 'hangarexport', version: 2, handle: 'SYNTHETIC', pledges: [{ pledgeId: id,
    pledgeName: 'Upgrade - ' + from + ' to ' + to, items: [], alsoContains: [], upgrade: { from, to },
    upgradeEvidence: { resolution: 'structured-unique', sourceCandidates: 1, targetCandidates: 1 } }] })).document.pledges[0]!;
}
test('structured standalone hangar CCU enters a draft without rewriting status, protection or applicability', () => {
  const p = upgrade(), before = JSON.stringify(p);
  assert.equal(p.ccus[0]!.status, 'unverified');
  assert.equal(prepareChains([p], ships, offers, true).ccus.length, 0);
  const pool = prepareChains([p], ships, offers, true, observation);
  assert.equal(pool.ccus.length, 1); assert.equal(pool.ccus[0]!.observedAt, observation.observedAt);
  assert.equal(pool.ccus[0]!.applicabilityConfirmed, false); assert.equal(pool.ccus[0]!.protected, true);
  assert.equal(JSON.stringify(p), before);
  const accepted = prepareChains([p, upgrade('other-pledge')], ships, offers, true,
    { kind: 'rsi-imports', observations: { [p.pledgeId]: observation.observedAt } });
  assert.equal(accepted.ccus.length, 1); assert.equal(accepted.ccus[0]!.observedAt, observation.observedAt);
});
test('title guesses, mismatched evidence, corrupt fields, mixed pledges and future observations stay excluded', () => {
  for (const change of [
    (p: ReturnType<typeof upgrade>) => { delete p.sourceValues.upgradeEvidence; },
    (p: ReturnType<typeof upgrade>) => { p.sourceValues.upgrade = JSON.stringify({ from: 'Other', to: 'Demo Gamma' }); },
    (p: ReturnType<typeof upgrade>) => { p.sourceValues.upgradeEvidence = JSON.stringify({ resolution: 'structured-unique', sourceCandidates: 2, targetCandidates: 1 }); },
    (p: ReturnType<typeof upgrade>) => { p.sourceValues.upgradeEvidence = '{'; },
    (p: ReturnType<typeof upgrade>) => { p.sourceValues.upgradeIssue = 'ambiguous'; },
    (p: ReturnType<typeof upgrade>) => { p.ships = basePledge().ships; },
    (p: ReturnType<typeof upgrade>) => { p.ccus[0]!.instanceId = 'unrelated'; },
    (p: ReturnType<typeof upgrade>) => { p.ccus[0]!.status = 'applied'; },
    (p: ReturnType<typeof upgrade>) => { p.ccus[0]!.applicability = 'rejected'; },
  ]) {
    const p = upgrade(); change(p); assert.equal(observedStandaloneCcu(p, observation), false);
    assert.equal(prepareChains([p], ships, offers, true, observation).ccus.length, 0);
  }
  assert.equal(observedStandaloneCcu(upgrade(), { ...observation, observedAt: 'bad' }), false);
  assert.equal(observedStandaloneCcu(upgrade(), { ...observation, observedAt: new Date(Date.now() + 600_000).toISOString() }), false);
});
test('a newly acquired CCU recomputes arbitrary target alternatives without consuming a shared instance', () => {
  const initial = [basePledge(), upgrade()]; const before = JSON.stringify(initial);
  const firstPool = prepareChains(initial, ships, offers, true, observation);
  const first = buildChain(firstPool, ships[2]!, offers, true)!;
  assert.deepEqual([first.ownedCount, first.gapCount], [1, 1]);
  const later = [...initial, upgrade('synthetic-2', 'Demo Gamma', 'Demo Delta')];
  const pool = prepareChains(later, ships, offers, true, observation);
  const target = buildChain(pool, ships[2]!, offers, true)!;
  const alternative = buildChain(pool, ships[3]!, offers, true)!;
  assert.deepEqual([target.ownedCount, target.gapCount, target.additionalMinor], [2, 0, 0]);
  assert.deepEqual([alternative.ownedCount, alternative.gapCount], [2, 1]);
  assert.equal(target.steps[0]!.key, alternative.steps[0]!.key); // independent alternatives, not two reservations
  assert.equal(new Set(target.steps.map(s => s.key)).size, target.steps.length);
  assert.equal(JSON.stringify(initial), before);
  assert.equal(prepareChains([upgrade(), upgrade()], ships, offers, true, observation).ccus.length, 0);
});

test('a refresh fills the two Hyūn Warbond gaps despite distinct RSI Hangar names', () => {
  const models = [
    { id: 900001, name: 'MDC', minor: 5000 },
    { id: 900002, name: 'Hawk', minor: 10000 },
    { id: 154, name: 'Nova', minor: 12000, warbond: 11000 },
    { id: 10, name: '350r', minor: 12500 },
    { id: 900005, name: 'Marauder', minor: 15000, warbond: 13500 },
    { id: 900006, name: 'Zeus Mk II MR', minor: 19000 },
    { id: 900007, name: 'Hyūn', minor: 22500 },
  ];
  const catalogue = models.map(({ id, name }) => ({ ...ships[0]!, id, name }));
  const marketOffers = models.map(({ id, name, minor, warbond }) => ({
    ...offers[0]!, key: 'test:' + id, toShipId: id, toSkuId: id + 100, targetName: name,
    regularMinor: minor, warbond: warbond !== undefined, warbondMinor: warbond ?? null,
  }));
  const values = { schemaVersion: 1 as const, source: 'rsi-from-ships' as const, currency: 'USD' as const,
    taxBasis: 'net' as const, fetchedAt: observation.observedAt,
    items: models.map(({ id, name, minor }) => ({ id, name, minor })) };
  const base = basePledge();
  base.ships[0]!.modelName = 'MDC';
  const stock = [base, upgrade('to-hyun', 'Zeus Mk II MR', 'Hyūn')];
  const target = catalogue.at(-1)!;
  const initial = prepareChains(stock, catalogue, marketOffers, true, observation, values);
  const suggestion = buildChain(initial, target, marketOffers, true, initial.bases[0]!.key)!;
  assert.deepEqual([suggestion.ownedCount, suggestion.gapCount], [1, 5]);
  const draft = { ...emptyDraft(), mode: 'manual' as const, baseKey: suggestion.base.key,
    anchors: suggestion.steps.map(anchorFromStep) };

  const purchases = [upgrade('warbond-nova', 'Hawk', 'Nova Tank'), upgrade('warbond-marauder', '350r Racer', 'Marauder')];
  const later = prepareChains([...stock, ...purchases], catalogue, marketOffers, true, observation, values);
  const updated = buildChain(later, target, marketOffers, true, suggestion.base.key)!;
  const planned = manualChain(later, target, catalogue, marketOffers, true, draft);
  for (const plan of [updated, planned]) {
    assert.deepEqual([plan.ownedCount, plan.gapCount], [3, 3]);
    assert.deepEqual(plan.steps.filter(step => step.ccu?.pledgeId.startsWith('warbond-'))
      .map(({ kind, from, to, ccu }) => [kind, from.name, to.name, ccu!.pledgeId]),
    [['owned', 'Hawk', 'Nova', 'warbond-nova'], ['owned', '350r', 'Marauder', 'warbond-marauder']]);
  }
  const unavailable = manualChain(later, target, catalogue, marketOffers, true, draft,
    [{ kind: 'ccu', key: later.ccus.find(ccu => ccu.pledgeId === 'warbond-nova')!.key }]);
  assert.equal(unavailable.steps.find(step => step.from.name === 'Hawk')?.kind, 'purchase');
  assert.equal(purchases[0]!.ccus[0]!.to, 'Nova Tank');
  assert.equal(purchases[1]!.ccus[0]!.from, '350r Racer');
});
