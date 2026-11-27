import test from 'node:test';
import assert from 'node:assert/strict';
import { warbondQuote, warbondStock } from '../src/planner/warbond-offers';
import { prepareChains } from '../src/planner/chain';
import { analyseReservations } from '../src/planner/reservations';
import { SHOP_PRICE_MAX_AGE, type ShopPrice } from '../src/market/shop-prices';
import { reportFixture } from './fixtures/report-data';
import { basePledge } from './fixtures';

const market = () => reportFixture().market!;
const pair = { fromId: 3, toId: 4 };
const quote = (edition: 'standard' | 'warbond', minor: number): ShopPrice => ({ ...pair, edition, checkedAt: Date.now(),
  amount: { minor, currency: 'EUR', taxMode: 'gross', vatBasisPoints: 1900 } });
function stockFixture() {
  const m = market(), p = basePledge('owned'); p.ships = []; p.name = 'Synthetic Warbond';
  p.ccus = [{ instanceId: 'one', from: 'B', to: 'Galaxy', status: 'unused', applicability: 'unverified', insurance: p.insurance }];
  const pledges = [p], pool = prepareChains(pledges, m.catalogue!.ships, m.offers!.items, true);
  return { catalogue: m.catalogue!.ships, pledges, ccus: pool.ccus, inventoryKnown: true, complete: true,
    reservations: analyseReservations([]), reservationsReady: true, excluded: [] as string[] };
}

test('only a fresh exact Warbond CCU quote confirms availability; stale, future, standard-only and wrong-source prices do not', () => {
  const wb = quote('warbond', 1190), now = Date.now();
  assert.ok(warbondQuote(pair, [wb], 'EUR', now));
  for (const prices of [[{ ...wb, fromId: 2 }], [{ ...wb, checkedAt: now - SHOP_PRICE_MAX_AGE }],
    [{ ...wb, checkedAt: now + 1 }], [quote('standard', 2200)], [{ ...wb, amount: { ...wb.amount, minor: 0 } }]])
    assert.equal(warbondQuote(pair, prices, 'EUR', now), null);
});
test('savings compare only matching currency and tax basis, never the target ship price', () => {
  const wb = quote('warbond', 1190), standard = quote('standard', 2380);
  assert.equal(warbondQuote(pair, [wb, standard], 'EUR')?.saving?.minor, 1190);
  assert.equal(warbondQuote(pair, [wb, { ...standard, amount: { ...standard.amount, currency: 'USD' } }], 'EUR')?.saving, null);
  assert.equal(warbondQuote(pair, [wb, { ...standard, amount: { ...standard.amount, taxMode: 'net' } }], 'EUR')?.saving, null);
  assert.equal(warbondQuote(pair, [wb, quote('standard', 1100)], 'EUR'), null);
});
test('a reliable owned copy is teal/free even when the original pledge is protected against destructive actions', () => {
  const stock = stockFixture();
  assert.equal(stock.pledges[0]!.protected, true);
  assert.deepEqual(warbondStock(pair, stock), { state: 'free', free: 1, locked: 0, consumed: 0, reserved: [] });
});
test('a reserved physical copy names the owning ship; a second physical copy remains free', () => {
  const input = stockFixture(), ccu = input.ccus[0]!;
  input.reservations = analyseReservations([{ slot: 1, targetId: 4, name: 'Galaxy', plan: { base: null,
    steps: [{ key: ccu.key, kind: 'owned', from: ccu.from, to: ccu.to, ccu }] } }]);
  const reserved = warbondStock(pair, input);
  assert.equal(reserved.state, 'reserved'); assert.equal(reserved.free, 0); assert.equal(reserved.reserved[0]?.slot, 1);
  input.ccus.push({ ...ccu, key: JSON.stringify(['owned', 'two']), instanceId: 'two' });
  assert.equal(warbondStock(pair, input).state, 'free');
});
test('explicit locks, applied CCUs and partial or unloaded inventory never count as free', () => {
  const input = stockFixture(); input.excluded = [input.ccus[0]!.key];
  assert.equal(warbondStock(pair, input).state, 'locked');
  input.excluded = []; input.pledges[0]!.ccus[0]!.status = 'applied'; input.ccus = [];
  const spent = warbondStock(pair, input);
  assert.equal(spent.state, 'missing'); assert.equal(spent.consumed, 1); assert.equal(spent.free, 0);
  input.complete = false; assert.equal(warbondStock(pair, input).state, 'unknown');
  input.inventoryKnown = false; assert.equal(warbondStock(pair, input).state, 'unknown');
});
test('pending reservations and ambiguous duplicate resources cannot become a purchase instruction or a free copy', () => {
  const input = stockFixture(); input.reservationsReady = false;
  assert.equal(warbondStock(pair, input).state, 'unknown');
  input.reservationsReady = true; input.ccus.push(input.ccus[0]!);
  assert.equal(warbondStock(pair, input).state, 'unknown');
});
test('explicit structured RSI aliases reconcile the same physical models without fuzzy variant matching', () => {
  const input = stockFixture(); input.catalogue = [{ ...input.catalogue[0]!, id: 10, name: '350r' }, { ...input.catalogue[1]!, id: 154, name: 'Nova' }];
  input.pledges[0]!.ccus[0] = { ...input.pledges[0]!.ccus[0]!, from: '350r Racer', to: 'Nova Tank' };
  input.ccus = prepareChains(input.pledges, input.catalogue, [], false).ccus;
  assert.equal(warbondStock({ fromId: 10, toId: 154 }, input).state, 'free');
});
test('large stock keeps 200 physical copies distinct and removes 199 locks without confusing model counts', () => {
  const input = stockFixture(), original = input.pledges[0]!;
  input.pledges = Array.from({ length: 200 }, (_, i) => ({ ...original, pledgeId: 'physical-' + i,
    ccus: [{ ...original.ccus[0]!, instanceId: 'instance-' + i }] }));
  input.ccus = prepareChains(input.pledges, input.catalogue, [], false).ccus;
  input.excluded = input.ccus.slice(0, 199).map(c => c.key);
  const result = warbondStock(pair, input);
  assert.equal(result.free, 1); assert.equal(result.locked, 199); assert.equal(result.state, 'free');
  input.excluded.push(input.ccus[199]!.key);
  assert.equal(warbondStock(pair, input).state, 'locked');
});
