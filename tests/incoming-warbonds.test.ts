import test from 'node:test';
import assert from 'node:assert/strict';
import { incomingWarbondCandidates } from '../src/planner/incoming-warbonds';
import { prepareChains } from '../src/planner/chain';
import { approveStartBase } from '../src/planner/bases';
import { emptyDraft, anchorFromStep } from '../src/planner/draft';
import { manualChain } from '../src/planner/manual';
import { analyseReservations, availableForTarget, blockedForTarget } from '../src/planner/reservations';
import { reportFixture } from './fixtures/report-data';

function fixture() {
  const f = reportFixture(), market = f.market!, ships = market.catalogue!.ships, offers = market.offers!.items;
  ships[3]!.name = 'Eclipse'; offers[3]!.targetName = 'Eclipse'; offers[3]!.regularMinor = 30000; offers[3]!.warbondMinor = 28000;
  offers[1]!.warbond = true; offers[1]!.warbondMinor = 9000;
  // Would skip the existing A -> B CCU, so is not a suitable purchase for this route.
  offers[2]!.warbond = true; offers[2]!.warbondMinor = 18000;
  // Outgoing upgrades FROM Eclipse used to be the bug.
  offers[4]!.warbond = true; offers[4]!.warbondMinor = 55000;
  ships.push({ ...ships[0]!, id: 6, name: 'Meteor' });
  offers.push({ ...offers[0]!, key: 'test-meteor', toShipId: 6, targetName: 'Meteor', regularMinor: 26000 });
  market.values = { schemaVersion: 1, source: 'rsi-from-ships', currency: 'USD', taxBasis: 'net', fetchedAt: new Date().toISOString(),
    items: offers.map(o => ({ id: o.toShipId, name: o.targetName, minor: o.regularMinor })) };
  const pool = prepareChains(f.inventory.items.slice(0, 2).map(i => i.pledge), ships, offers, true, undefined, market.values);
  const base = pool.bases[0]!, ccu = pool.ccus[0]!, target = ships[3]!;
  const draft = { ...approveStartBase(pool, emptyDraft(), base.key), mode: 'manual' as const, initialized: true,
    anchors: [anchorFromStep({ key: ccu.key, kind: 'owned', from: ccu.from, to: ccu.to, ccu })] };
  const plan = manualChain(pool, target, ships, offers, true, draft);
  return { target, draft, plan, pool, market };
}
const pairs = (input: ReturnType<typeof fixture>) => incomingWarbondCandidates(input).candidates.map(c => [c.from.name, c.target.name]);

test('Schiff 1 is the destination: planned purchase pairs stay consistent, never upgrades away from Eclipse', () => {
  const f = fixture(), before = structuredClone(f);
  assert.deepEqual(pairs(f), [['Starter', 'A'], ['B', 'Eclipse']]);
  assert.deepEqual(f, before, 'advice must not change drafts, reservations, inventory or offers');
  assert.ok(!incomingWarbondCandidates(f).candidates.some(c => c.fromId === f.target.id || c.toId === 5));
});

test('owned chain segments are preserved rather than skipped for another discounted CCU', () => {
  const f = fixture();
  assert.equal(f.plan.steps.find(s => s.kind === 'owned')?.to.name, 'B');
  assert.ok(!pairs(f).some(([, to]) => to === 'B'));
  f.plan = manualChain(f.pool, f.target, f.market.catalogue!.ships, f.market.offers!.items, true,
    { ...f.draft, anchors: [...f.draft.anchors, { kind: 'purchase', fromKey: 'matrix:3', toKey: 'matrix:4', fromName: 'B', toName: 'Eclipse' }] });
  assert.deepEqual(pairs(f), [['Starter', 'A'], ['B', 'Eclipse']], 'an explicit manual purchase anchor keeps its source');
});

test('a selected and approved LTI base and a current usable route are required', () => {
  for (const kind of ['unapproved', 'no-base', 'missing-owned', 'invalid-route', 'other-base', 'already-at-goal'] as const) {
    const f = fixture();
    if (kind === 'unapproved') delete f.draft.baseApprovedKey;
    if (kind === 'no-base') f.pool.bases = [];
    if (kind === 'missing-owned') f.pool.ccus = [];
    if (kind === 'invalid-route') f.plan.steps[0]!.kind = 'conflict';
    if (kind === 'other-base') f.plan.base = { ...f.plan.base!, key: 'another-base' };
    if (kind === 'already-at-goal') { f.plan.base!.model = { ...f.plan.base!.model, key: 'matrix:4', name: 'Eclipse', nominalUsd: 30000 }; f.plan.steps = []; }
    assert.deepEqual(incomingWarbondCandidates(f).candidates, [], kind);
  }
  assert.equal(incomingWarbondCandidates({ ...fixture(), target: undefined }).state, 'target-required');
});

test('exclusions and higher-priority reservations cannot lend a base or owned anchor to the advice', () => {
  const f = fixture(), ccu = f.pool.ccus[0]!;
  const reservations = analyseReservations([{ slot: 1, targetId: 999, name: 'Higher goal', plan: { base: null,
    steps: [{ key: ccu.key, kind: 'owned', from: ccu.from, to: ccu.to, ccu }] } },
    { slot: 0, targetId: f.target.id, name: f.target.name, plan: f.plan }], [1, 0, 2]);
  assert.deepEqual(incomingWarbondCandidates({ ...f, pool: availableForTarget(f.pool, blockedForTarget(reservations, f.target.id)) }).candidates, []);
  assert.deepEqual(incomingWarbondCandidates({ ...f, pool: { ...f.pool, ccus: [] } }).candidates, []);
});

test('stale/missing/ambiguous/non-discounted/zero-priced offers never discover purchase pairs', () => {
  for (const kind of ['stale', 'missing', 'variant', 'ambiguous', 'equal', 'zero'] as const) {
    const f = fixture();
    if (kind === 'stale') f.market.offers!.sourceAt = new Date(Date.now() - 7 * 3600000).toISOString();
    for (const offer of f.market.offers!.items) {
      if (kind === 'missing') offer.change = 'missing';
      if (kind === 'variant') offer.targetName += ' Unknown Variant';
      if (kind === 'equal') offer.warbondMinor = offer.regularMinor;
      if (kind === 'zero') offer.warbondMinor = 0;
    }
    if (kind === 'ambiguous') f.market.catalogue!.ships.push(...f.market.catalogue!.ships.map(s => ({ ...s, id: s.id + 100 })));
    assert.deepEqual(incomingWarbondCandidates(f).candidates, [], kind);
  }
  const f = fixture(); f.market.offers!.items.push({ ...f.market.offers!.items[3]!, key: 'duplicate-sku' });
  assert.equal(incomingWarbondCandidates(f).candidates.length, 2, 'multiple SKUs do not duplicate one CCU pair');
});

test('stale from-list falls back to the known chain source, never a guessed minimal purchase', () => {
  const f = fixture(); f.market.values!.fetchedAt = new Date(Date.now() - 7 * 86400000).toISOString();
  assert.deepEqual(pairs(f), [['Starter', 'A'], ['B', 'Eclipse']]);
});

test('a fully owned route needs no purchase', () => {
  const f = fixture(), model = (i: number) => ({ key: 'matrix:' + i, name: f.market.catalogue!.ships.find(s => s.id === i)!.name,
    catalogueConfirmed: true, nominalUsd: f.market.offers!.items.find(o => o.toShipId === i)!.regularMinor });
  for (const [from, to] of [[1, 2], [3, 4]]) f.pool.ccus.push({ ...f.pool.ccus[0]!, key: 'physical:' + from, instanceId: 'one:' + from, from: model(from!), to: model(to!) });
  f.plan = manualChain(f.pool, f.target, f.market.catalogue!.ships, f.market.offers!.items, true, f.draft);
  assert.equal(f.plan.gapCount, 0);
  assert.deepEqual(pairs(f), []);
});

test('changing the approved start base removes purchases below that base from the advice', () => {
  const f = fixture();
  f.pool.bases[0]!.model = f.pool.ccus[0]!.to;
  f.draft.anchors = [];
  f.plan = manualChain(f.pool, f.target, f.market.catalogue!.ships, f.market.offers!.items, true, f.draft);
  assert.deepEqual(pairs(f), [['B', 'Eclipse']]);
});

test('200 ships and 500 stock copies do not multiply requests into catalogue-wide pair combinations', () => {
  const f = fixture();
  f.pool.bases.push(...Array.from({ length: 199 }, (_, i) => ({ ...f.pool.bases[0]!, key: 'other-base:' + i })));
  f.pool.ccus.push(...Array.from({ length: 499 }, (_, i) => ({ ...f.pool.ccus[0]!, key: 'copy:' + i })));
  assert.deepEqual(pairs(f), [['Starter', 'A'], ['B', 'Eclipse']]);
});

test('an existing Sentinel-type pair wins over an alphabetically earlier Blade-type tie in either catalogue order', () => {
  for (const reverse of [false, true]) {
    const f = fixture(), ships = f.market.catalogue!.ships;
    ships.push({ ...ships[0]!, id: 7, name: 'Blade' });
    f.market.values!.items.push({ id: 7, name: 'Blade', minor: 26000 });
    if (reverse) { ships.reverse(); f.market.values!.items.reverse(); }
    f.draft.anchors.push({ kind: 'purchase', fromKey: 'matrix:3', toKey: 'matrix:6', fromName: 'B', toName: 'Meteor' });
    f.plan = manualChain(f.pool, f.target, ships, f.market.offers!.items, true, f.draft);
    const before = structuredClone(f);
    const candidates = incomingWarbondCandidates(f).candidates;
    assert.deepEqual(candidates.map(c => [c.from.name, c.target.name]), [['Starter', 'A'], ['Meteor', 'Eclipse']]);
    assert.equal(candidates[1]!.relation, 'planned-warbond');
    assert.ok(!candidates.some(c => c.from.name === 'Blade'));
    assert.deepEqual(f, before, 'advice must not replace a draft, its anchors or a stock copy');
  }
});

test('the existing pair is retained even when a shorter CCU needs an extra purchase to reach its source', () => {
  const f = fixture(), rows = incomingWarbondCandidates(f).candidates;
  assert.equal(rows[1]!.from.name, 'B');
  assert.equal(rows[1]!.relation, 'planned-link', 'a standard-priced planned link must not claim its discount is already counted');
  assert.equal(rows[0]!.relation, 'planned-warbond');
});

test('a genuinely new intermediate remains a missing-link option without claiming a proven whole-chain saving', () => {
  const f = fixture(), meteor = f.market.offers!.items.find(o => o.toShipId === 6)!;
  meteor.warbond = true; meteor.warbondMinor = 25000;
  const rows = incomingWarbondCandidates(f).candidates;
  const intermediate = rows.find(c => c.toId === 6)!;
  assert.ok(intermediate);
  assert.equal(intermediate.from.name, 'B');
  assert.equal(intermediate.relation, 'fits-gap');
  assert.equal('additionalSaving' in intermediate, false, 'pair discount is never invented as an additional route benefit');
});

test('an equal-value different ship cannot bridge a gap whose starting model is already fixed', () => {
  const f = fixture();
  f.market.catalogue!.ships.push({ ...f.market.catalogue!.ships[2]!, id: 7, name: 'A Different B' });
  f.market.values!.items.push({ id: 7, name: 'A Different B', minor: 20000 });
  const meteor = f.market.offers!.items.find(o => o.toShipId === 6)!;
  meteor.warbond = true; meteor.warbondMinor = 25000;
  const rows = incomingWarbondCandidates(f).candidates;
  assert.equal(rows.find(c => c.toId === 6)?.from.name, 'B');
  assert.ok(!rows.some(c => c.fromId === 7));
});

test('stale pricing basis cannot label a pair discount as already included in the chain', () => {
  const f = fixture();
  f.market.values!.fetchedAt = new Date(Date.now() - 7 * 86400000).toISOString();
  assert.ok(incomingWarbondCandidates(f).candidates.every(c => c.relation !== 'planned-warbond'));
});
