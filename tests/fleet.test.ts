import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CatalogueShip } from '../src/market/model';
import type { ChainBase, ChainModel, ChainPool, OwnedCcu } from '../src/planner/chain';
import { emptyDraft } from '../src/planner/draft';
import { fleetScenarios, planFleetRoutes, type FleetGoal, type FleetRoute } from '../src/planner/fleet';
import { DEFAULT_PRIORITIES } from '../src/planner/reservations';
import { shoppingList, shoppingPayments } from '../src/planner/shopping-list';

const at = new Date().toISOString();
const model = (id: number, name: string, nominalUsd: number): ChainModel => ({ key: `matrix:${id}`, name, nominalUsd, catalogueConfirmed: true });
const models = [model(1, 'UTV', 1000), model(2, 'MDC', 2000), model(3, 'Token', 2500),
  model(4, 'Guardian', 3000), model(5, 'Hull B', 6000), model(6, 'Apollo Medivac', 4000), model(7, 'MOLE', 6500),
  model(8, 'Galaxy', 10_000), model(9, 'Liberator', 12_000), model(10, 'Polaris', 15_000)];
const ships: CatalogueShip[] = models.map((m, index) => ({ id: index + 1, name: m.name, chassisId: null, manufacturer: 'Test',
  manufacturerCode: 'TEST', status: 'unknown', focus: '', length: null, storeUrl: null }));
const bases: ChainBase[] = models.slice(0, 3).map((m, i) => ({ key: `base-${i}`, pledgeId: `pledge-${i}`, childId: 'ship',
  model: m, pledgeName: m.name, insurance: { kind: 'lti', evidence: 'synthetic' }, protected: false, released: true,
  multiShip: false, identityConfirmed: true }));
const owned = (key: string, from: ChainModel, to: ChainModel): OwnedCcu => ({ key, from, to, pledgeId: key, instanceId: key,
  protected: false, warbond: false, applicabilityConfirmed: true });
const shared = owned('guardian-hull-a', models[3]!, models[4]!);
const alternative = owned('apollo-mole', models[5]!, models[6]!);
const pool: ChainPool = { bases, ccus: [shared, alternative], ignored: 0, limited: false,
  values: { schemaVersion: 1, source: 'rsi-from-ships', currency: 'USD', taxBasis: 'net', fetchedAt: at,
    items: models.map((m, index) => ({ id: index + 1, name: m.name, minor: m.nominalUsd! })) } };
const offers = ships.map((ship, index) => ({ key: `openh:${ship.id}:${ship.id}`, name: ship.name, targetName: ship.name,
  toShipId: ship.id, toSkuId: ship.id, regularMinor: models[index]!.nominalUsd!, warbondMinor: null, warbond: false,
  currency: 'USD' as const, taxBasis: 'net' as const, verification: 'target-observation' as const, firstSeenAt: at, lastSeenAt: at,
  change: 'current' as const, previousRegularMinor: null, previousWarbondMinor: null }));
const inputs = { pool, ships, offers, current: true };
const goal = (slot: number, ship: CatalogueShip): FleetGoal => ({ slot, ship,
  draft: { ...emptyDraft(), baseKey: bases[slot]!.key, baseApprovedKey: bases[slot]!.key } });
const ccuKeys = (route: FleetRoute) => route.plan?.steps.filter(step => step.ccu).map(step => step.ccu!.key);

test('shared CCU follows the slot when the ship names are swapped; the losing target is independent in its solo scenario', () => {
  for (const [first, second] of [[ships[7]!, ships[8]!], [ships[8]!, ships[7]!]] as const) {
    const goals = [goal(1, second), goal(0, first)];
    const before = JSON.stringify(goals);
    const joint = planFleetRoutes(goals, inputs);
    assert.deepEqual(joint.map(route => [route.name, ccuKeys(route)]), [[first.name, [shared.key]], [second.name, [alternative.key]]]);
    const comparison = fleetScenarios(goals, joint, inputs);
    assert.deepEqual(comparison.cases.map(c => c.key), ['0', '1', 'combined']);
    assert.deepEqual(ccuKeys(comparison.cases[1]!.routes[0]!), [shared.key]);
    assert.equal(comparison.assignments[0]?.shared[0]?.winner.name, first.name);
    assert.equal(comparison.assignments[0]?.route.name, second.name);
    assert.equal(JSON.stringify(goals), before);
  }
});

test('separate copies can serve two targets, and the third target gets the remaining route', () => {
  const goals = [goal(2, ships[9]!), goal(1, ships[7]!), goal(0, ships[8]!)];
  const expanded = { ...inputs, pool: { ...pool, ccus: [...pool.ccus, { ...shared, key: 'guardian-hull-b', pledgeId: 'copy-b', instanceId: 'copy-b' }] } };
  const routes = planFleetRoutes(goals, expanded);
  const all = routes.flatMap(route => ccuKeys(route) ?? []);
  assert.equal(new Set(all).size, 3);
  assert.equal(routes[2]?.slot, 2);
  assert.deepEqual(ccuKeys(routes[2]!), [alternative.key]);
  const comparison = fleetScenarios(goals, routes, expanded);
  assert.deepEqual(comparison.cases.map(item => item.key), ['0', '1', '2', 'combined']);
  assert.deepEqual(comparison.assignments.map(entry => entry.target.name), ['Polaris']);
});

test('common budget is allocated once, and a shared approved base is not silently replaced', () => {
  const goals = [goal(0, ships[8]!), goal(1, ships[7]!)];
  const routes = planFleetRoutes(goals, inputs);
  const balance = { source: 'rsi-credit-ledger' as const, minor: 6000, currency: 'USD' as const, observedAt: at };
  const display = { settings: { schemaVersion: 1 as const, language: 'en' as const, currency: 'USD' as const,
    taxMode: 'net' as const, vatBasisPoints: 0 }, configured: true, settingsError: false, pending: false, rateError: false, rate: null };
  const list = shoppingList(routes, DEFAULT_PRIORITIES, offers, pool.values, true);
  const paid = shoppingPayments(list, display, balance);
  assert.equal(paid.creditUsed, balance.minor);
  assert.ok(paid.rows.find(row => row.target === 'Liberator')!.credit! > 0);
  assert.ok(paid.rows.every(row => row.target === 'Liberator' || row.credit === 0));

  goals[1]!.draft = goals[0]!.draft;
  const conflict = planFleetRoutes(goals, inputs);
  assert.equal(conflict[1]?.plan, null);
  assert.equal(fleetScenarios(goals, conflict, inputs).assignments[0]?.shared.some(claim => claim.kind === 'base'), true);
  assert.deepEqual(shoppingList(conflict, DEFAULT_PRIORITIES, offers, pool.values, true).issues, [{ target: 'Galaxy', reason: 'base' }]);
});

test('an automatic route with no priced path supplies no purchase rows and keeps the approved base in the draft', () => {
  const goals = [goal(0, ships[8]!)];
  const routes = planFleetRoutes(goals, { ...inputs, offers: [] });
  assert.equal(routes[0]?.plan, null);
  assert.equal(goals[0]?.draft?.baseApprovedKey, bases[0]?.key);
  const list = shoppingList(routes, DEFAULT_PRIORITIES, [], pool.values, true);
  assert.deepEqual(list.items, []);
  assert.deepEqual(list.issues, [{ target: 'Liberator', reason: 'no-priced-route' }]);
});
