import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { StoreCredit } from '../src/domain/store-credit';
import type { TargetOffer } from '../src/market/model';
import type { ShipValues } from '../src/market/ship-values';
import type { ChainBase, ChainModel, ChainStep } from '../src/planner/chain';
import { DEFAULT_PRIORITIES, type ReservationTarget } from '../src/planner/reservations';
import { purchasePriceReader, shoppingList, shoppingPayments, type ShoppingList } from '../src/planner/shopping-list';
import { chainCosts } from '../src/planner/costs';
import type { PricingSnapshot } from '../src/pricing/model';

const at = new Date().toISOString();
const display: PricingSnapshot = {
  settings: { schemaVersion: 1, language: 'de', currency: 'EUR', taxMode: 'gross', vatBasisPoints: 1900 },
  configured: true, settingsError: false, pending: false, rateError: false,
  rate: { source: 'ECB', sourceDate: at.slice(0, 10), usdPerEurMicros: 1_100_000, fetchedAt: at },
};
const credit = (minor: number, currency: 'USD' | 'EUR' = 'USD'): StoreCredit => ({ source: 'rsi-credit-ledger', minor, currency, observedAt: at });
const part = (key: string, target: string, price: ShoppingList['items'][number]['price']): ShoppingList['items'][number] =>
  ({ key, target, from: 'A', to: 'B', price });

test('the approved example taxes only the cash remainder and keeps open prices outside both totals', () => {
  const list: ShoppingList = { owned: [], issues: [], items: [
    part('wb', 'Galaxy', { kind: 'warbond', usdMinor: 500 }),
    part('g', 'Galaxy', { kind: 'standard', usdMinor: 4500 }),
    part('l1', 'Liberator', { kind: 'standard', usdMinor: 1000 }),
    part('l2', 'Liberator', { kind: 'standard', usdMinor: 3500 }),
    part('open', 'Liberator', { kind: 'open' }),
  ] };
  const plan = shoppingPayments(list, display, credit(6000));
  assert.deepEqual(plan.rows.map(({ cash, credit }) => [cash, credit]), [[541,0],[0,4500],[0,1000],[3245,500],[null,null]]);
  assert.deepEqual([plan.cashTotal, plan.creditUsed, plan.creditLeft, plan.openCount], [3786,6000,0,1]);
  const limited = shoppingPayments(list, display, credit(6000), 4000);
  assert.deepEqual([limited.cashTotal, limited.creditUsed, limited.creditLeft], [5950,4000,2000]);
  assert.equal(shoppingPayments(list, display, credit(6000), 100_000).creditUsed, 6000);
  assert.equal(shoppingPayments(list, display, credit(6000), -1).creditUsed, 0);
});

const model = (id: number, nominalUsd: number): ChainModel => ({ key: 'matrix:' + id, name: 'Test ' + id, nominalUsd, catalogueConfirmed: true });
const a = model(1, 5000), b = model(2, 6000), c = model(3, 10_000), d = model(4, 13_000);
const values: ShipValues = { schemaVersion: 1, source: 'rsi-from-ships', fetchedAt: at, currency: 'USD', taxBasis: 'net',
  items: [a,b,c,d].map((ship, index) => ({ id: index + 1, name: ship.name, minor: ship.nominalUsd! })) };
const offer = (id: number, regularMinor: number, warbondMinor: number | null = null): TargetOffer => ({
  key: `openh:${id}:${id}`, name: 'Upgrade to Test ' + id, targetName: 'Test ' + id, toShipId: id, toSkuId: id, regularMinor, warbondMinor,
  warbond: warbondMinor !== null, currency: 'USD', taxBasis: 'net', verification: 'target-observation', firstSeenAt: at,
  lastSeenAt: at, change: 'current', previousRegularMinor: null, previousWarbondMinor: null,
});
const gap = (from: ChainModel, to: ChainModel): ChainStep => ({ key: `${from.key}:${to.key}`, kind: 'purchase', from, to });
function target(slot: number, name: string, baseModel: ChainModel, ...steps: ChainStep[]): ReservationTarget {
  const base: ChainBase = { key: 'base-' + slot, model: baseModel, pledgeId: 'test', childId: 'ship', pledgeName: 'Test',
    insurance: { kind: 'lti', evidence: 'test' }, protected: false, released: true, multiShip: false, identityConfirmed: true };
  return { slot, targetId: slot + 100, name, plan: { base, steps } };
}

test('uses the exactly matching Warbond tier without replacing routes and plans highest priority first', () => {
  const launcher = target(0, 'Galaxy', a, gap(a, c));
  const followup = target(1, 'Liberator', b, gap(b, c), gap(c, d));
  const list = shoppingList([followup, launcher], DEFAULT_PRIORITIES, [offer(3, 10_000, 9500), offer(4, 13_000)], values, true);
  assert.deepEqual(list.items.map(row => [row.target, row.price]), [
    ['Galaxy',{kind:'standard',usdMinor:5000}], ['Liberator',{kind:'warbond',usdMinor:3500}], ['Liberator',{kind:'standard',usdMinor:3000}],
  ]);
  const plan = shoppingPayments(list, display, credit(6000));
  assert.deepEqual(plan.rows.map(row=>row.credit), [5000,0,1000]);
});

test('chain and fleet agree on the amount before credits and keep the same gaps open', () => {
  const route = target(0, 'Galaxy', b, gap(b, c), gap(c, d));
  const offers = [offer(3, 10_000, 9500)];
  const priceFor = purchasePriceReader(offers, values, true, Date.parse(at));
  const chain = chainCosts(route.plan!, [], display, true, priceFor);
  const fleet = shoppingPayments(shoppingList([route], DEFAULT_PRIORITIES, offers, values, true), display);
  assert.equal(chain.additional.knownMinor, 3786);
  assert.equal(chain.additional.knownMinor, fleet.cashTotal);
  assert.equal(chain.additional.missing, 1);
  assert.equal(chain.additional.missing, fleet.openCount);
  assert.equal(chain.investment, null);
});

test('unambiguous current values for both ships allow a standard estimate without the RSI value cache', () => {
  const route = target(0, 'Galaxy', b, gap(b, c));
  const offers = [offer(2, 6000), offer(3, 10_000, 9500)];
  assert.deepEqual(shoppingList([route], DEFAULT_PRIORITIES, offers, null, true).items[0]?.price,
    { kind: 'standard', usdMinor: 4000 });
  assert.deepEqual(shoppingList([route], DEFAULT_PRIORITIES, [offer(2, 6001), offers[1]!], null, true).items[0]?.price,
    { kind: 'open' });
});

test('keeps missing, outdated or ambiguously matched shop prices open', () => {
  const first = target(0, 'Galaxy', a, gap(a, c));
  const known = offer(3, 10_000);
  for (const offers of [[], [{ ...known, change: 'missing' as const }], [{ ...known, targetName: 'Other model' }], [offer(3, 11_000)],
    [known, { ...offer(3, 11_000), key: 'openh:3:4', toSkuId: 4 }]]) {
    assert.equal(shoppingList([first], DEFAULT_PRIORITIES, offers, values, true).items[0]?.price.kind, 'open');
  }
  assert.equal(shoppingList([first], DEFAULT_PRIORITIES, [known], values, false).items[0]?.price.kind, 'open');
  assert.equal(shoppingList([first], DEFAULT_PRIORITIES, [known], { ...values, fetchedAt: '2021-01-01T00:00:00Z' }, true).items[0]?.price.kind, 'open');
});

test('both planners prefer the matching RSI Euro quote and fall back to ECB when its tax basis differs', () => {
  const settings = {...display.settings, shopRate: { eurPerUsdMicros: 880_000, observedOn: '2026-01-01' }};
  const displayShop = {...display, settings};
  const [zeus, taurus, steel, guardian] = [17_500, 20_000, 23_500, 25_000].map((v, i) => model(i + 1, v)) as
    [ChainModel, ChainModel, ChainModel, ChainModel];
  const offers = [zeus, taurus, steel, guardian].map((m, i) => offer(i + 1, m.nominalUsd!));
  const targets = [target(0, 'First', zeus, gap(zeus, taurus)), target(1, 'Second', steel, gap(steel, guardian))];
  const checkedAt = Date.now();
  const quotes = [{fromId:1,toId:2,minor:2618},{fromId:3,toId:4,minor:1571}].map(({fromId,toId,minor})=>({fromId,toId,
    edition:'standard' as const,checkedAt,amount:{minor,currency:'EUR' as const,taxMode:'gross' as const,vatBasisPoints:1900}}));
  const reader = purchasePriceReader(offers, null, true, checkedAt, quotes);
  const costs = targets.map(t => chainCosts(t.plan!, [], displayShop, true, reader).additional.knownMinor);
  const list = shoppingList(targets, DEFAULT_PRIORITIES, offers, null, true, quotes);
  const fleet = shoppingPayments(list, displayShop);
  assert.deepEqual(costs, [2618, 1571]);
  assert.deepEqual(fleet.rows.map(r => r.cash), costs);
  assert.equal(fleet.cashCurrency, 'EUR');
  assert.equal(fleet.cashTotal, 4189);
  assert.equal(shoppingPayments(list, {...displayShop, settings:{...settings,currency:'USD'}}).cashTotal, 4760);
  assert.equal(fleet.approximate,false);
  const fallback = shoppingPayments(list, {...displayShop, settings:{...settings,taxMode:'net'}});
  assert.equal(fallback.cashTotal, 3637);
  assert.equal(fallback.approximate,true);
  const partial = shoppingPayments(list, displayShop, credit(1000,'EUR'));
  assert.deepEqual(partial.rows.map(r=>[r.cash,r.credit]), [[1515,1000],[1571,0]]);
});

test('the rounded price in ledger cents can cover a whole standard purchase, but never a Warbond', () => {
  const displayShop = {...display, rate:{...display.rate!,usdPerEurMicros:1_136_364}};
  const list: ShoppingList = { issues:[], owned:[], items:[
    part('one','First',{kind:'standard',usdMinor:105}),part('two','Second',{kind:'warbond',usdMinor:105})
  ]};
  const full = shoppingPayments(list,displayShop,credit(200,'EUR'),92);
  assert.deepEqual(full.rows.map(r=>[r.cash,r.credit]), [[0,92],[110,0]]);
  assert.equal(full.creditLeft,108);
  const short = shoppingPayments(list,displayShop,credit(91,'EUR'));
  assert.deepEqual(short.rows.map(r=>[r.cash,r.credit]), [[2,91],[110,0]]);
  assert.equal(shoppingPayments(list,displayShop).cashTotal,220);
  const tiny = { ...list, items: ['x','y'].map(key=>part(key,'First',{kind:'standard',usdMinor:10})) };
  assert.equal(shoppingPayments(tiny,displayShop).cashTotal,20); // 10+10 cents; aggregate rounding would give 21.
  const dollars = shoppingPayments(list,{...displayShop,settings:{...displayShop.settings,currency:'USD'}},credit(92,'EUR'));
  assert.deepEqual(dollars.rows.map(r=>[r.cash,r.credit]), [[0,92],[125,0]]);
});

test('owned instances add no purchase, and a conflicting lower draft keeps its cost unresolved', () => {
  const own: ChainStep = { ...gap(a, c), kind: 'owned', ccu: { key: 'physical-1', from: a, to: c,
    pledgeId: 'p', instanceId: 'i', protected: false, warbond: true, applicabilityConfirmed: true } };
  const first = target(0, 'Galaxy', a, own);
  const second = target(1, 'Liberator', a, own, gap(c, d));
  const list = shoppingList([first,second], DEFAULT_PRIORITIES, [offer(4,13_000)], values, true);
  assert.equal(list.items.length, 0);
  assert.equal(list.owned[0]?.steps.length, 1);
  assert.deepEqual(list.issues, [{ target: 'Liberator', reason: 'conflict' }]);
});

test('handles EUR credit with bounded conversion and falls back to USD cash without a current rate', () => {
  const list: ShoppingList = { owned: [], issues: [], items: [part('one','Galaxy',{kind:'standard',usdMinor:10_000})] };
  const limited = shoppingPayments(list, display, credit(2000, 'EUR'), 1000);
  assert.deepEqual([limited.cashTotal, limited.creditUsed, limited.creditLeft], [9628,1000,1000]);
  assert.equal(limited.convertedCredit, true);
  const missing = shoppingPayments(list, { ...display, rate: null }, credit(2000, 'EUR'));
  assert.deepEqual([missing.cashCurrency, missing.cashTotal, missing.creditUsed, missing.creditLeft], ['USD',11900,0,2000]);
  assert.equal(missing.canUseCredit, false);
});
