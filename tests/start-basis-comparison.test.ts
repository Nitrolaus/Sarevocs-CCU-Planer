import test from 'node:test';
import assert from 'node:assert/strict';
import type { Buyback } from '../src/domain/model';
import { commandSchema } from '../src/main/commands';
import { buybackBase, startBasisRoute } from '../src/planner/start-basis-comparison';
import { prepareChains } from '../src/planner/chain';
import { reportAccountId, reportFixture } from './fixtures/report-data';

function scenario() {
  const fixture = reportFixture(), market = fixture.market, ships = market.catalogue!.ships, offers = market.offers!.items;
  market.values = { schemaVersion: 1, source: 'rsi-from-ships', fetchedAt: fixture.now!, currency: 'USD', taxBasis: 'net',
    items: offers.map(offer => ({ id: offer.toShipId, name: offer.targetName, minor: offer.regularMinor })) };
  const pool = prepareChains(fixture.inventory.items.map(item => item.pledge), ships, offers, true, undefined, market.values);
  const entry: Buyback = { entryId: 'B', name: 'Test buyback', description: '', availability: 'unverified', originalShips: ['B'],
    insurance: { kind: 'lti', evidence: 'Synthetic' }, currentPrice: { minor: 13000, currency: 'USD', taxBasis: 'net', evidence: 'Synthetic' } };
  const input = { target: ships[3]!, pool, blocked: [], market, display: fixture.display, budgetMinor: 5000,
    balance: { minor: 5000, currency: 'USD' as const, source: 'rsi-credit-ledger' as const, observedAt: fixture.now! } };
  return { input, entry, base: pool.bases.find(base => base.pledgeId === '100')! };
}

test('alternatives use the same credit budget and add the buyback before applying its token', () => {
  const { input, entry, base } = scenario();
  const hangar = startBasisRoute({ ...input, base })!;
  const buyback = (current: boolean) => startBasisRoute({ ...input, base: buybackBase(entry, input.market)!, buyback: entry,
    observation: { current, token: 'available', observedAt: input.balance.observedAt } })!;
  assert.deepEqual(hangar.purchases.map(step => [step.from, step.to]), [['Starter', 'A'], ['B', 'Galaxy']]);
  assert.equal(hangar.payment!.cashTotal, 14800);
  const withToken = buyback(true), staleToken = buyback(false);
  assert.equal(withToken.purchases.length, 1);
  assert.equal(withToken.payment!.cashTotal, 20400);
  assert.equal(withToken.payment!.creditUsed, 5000);
  assert.equal(staleToken.payment!.cashTotal, 24400);
  assert.equal(staleToken.payment!.creditUsed, 0);
});

test('unknown price remains open and only a single identified LTI buyback becomes a base', () => {
  const { input, entry } = scenario();
  assert.equal(buybackBase({ ...entry, originalShips: ['B', 'A'] }, input.market), null);
  assert.equal(buybackBase({ ...entry, originalShips: ['Unknown'] }, input.market), null);
  assert.equal(buybackBase({ ...entry, insurance: undefined }, input.market), null);
  const route = startBasisRoute({ ...input, base: buybackBase(entry, input.market)!,
    buyback: { ...entry, currentPrice: null } })!;
  assert.equal(route.purchases.length, 1);
  assert.equal(route.payment!.openCount, 1);
});

test('an observed EUR buyback stays usable while unconvertible USD gaps remain open', () => {
  const { input, entry } = scenario();
  const display = { ...input.display, rate:null, settings:{...input.display.settings, currency:'EUR' as const,
    taxMode:'gross' as const,vatBasisPoints:1900,shopRate:{eurPerUsdMicros:880_000,observedOn:'2026-01-01'}}};
  const buyback: Buyback = {...entry, currentPrice:{...entry.currentPrice!,minor:10004,currency:'EUR'}};
  const result = startBasisRoute({...input, display, budgetMinor: 0, base:buybackBase(entry,input.market)!, buyback})!.payment!;
  assert.equal(result.openCount,1);assert.equal(result.cashCurrency,'EUR');
  assert.equal(result.rows.find(r=>r.key==='buyback')?.cash,11905);
});

test('export selection accepts only a unique, nonempty list of visible export sections', () => {
  const request = { action: 'report.selection', accountId: reportAccountId };
  assert.ok(commandSchema.safeParse({ ...request, kinds: ['paints', 'buyback'] }).success);
  for (const kinds of [[], ['inventory'], ['offers', 'offers'], ['shipProfiles']]) {
    assert.equal(commandSchema.safeParse({ ...request, kinds }).success, false);
  }
});
