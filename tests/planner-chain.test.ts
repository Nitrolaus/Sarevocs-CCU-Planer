import test from 'node:test';
import assert from 'node:assert/strict';
import { buildChain, prepareChains } from '../src/planner/chain';
import { searchChains } from '../src/planner/search';
import { purchasePriceReader } from '../src/planner/shopping-list';
import { DEFAULT_DISPLAY_SETTINGS } from '../src/pricing/model';
import type { Pledge } from '../src/domain/model';
import type { CatalogueShip, TargetOffer } from '../src/market/model';
const at = new Date().toISOString();
const catalogue: CatalogueShip[] = ['Starter', 'A', 'B', 'C', 'Liberator', 'A Mk II'].map((name, i) => ({ id: i + 1, name, chassisId: null, manufacturer: 'Test', manufacturerCode: 'TEST', status: 'unknown', focus: '', length: null }));
const offers: TargetOffer[] = catalogue.map((s, i) => ({ key: 'test:' + s.id, name: 'Upgrade to ' + s.name, targetName: s.name, toShipId: s.id, toSkuId: 100 + s.id,
  regularMinor: [1000, 2000, 4000, 5000, 10000, 3000][i]!, warbondMinor: s.id === 5 ? 9500 : null, warbond: s.id === 5, currency: 'USD', taxBasis: 'net', verification: 'target-observation', firstSeenAt: at, lastSeenAt: at, change: 'current', previousRegularMinor: null, previousWarbondMinor: null }));
const pledge = (id: string): Pledge => ({ pledgeId: id, name: id, insurance: { kind: 'lti', evidence: 'Synthetic LTI' }, originalDescription: 'Original model is not the current model', ships: [], ccus: [], protected: true, baseReleased: false, restrictions: [], acquisitionCost: null, unknownCostReason: 'unknown', meltValue: null, sourceValues: {} });
function base(name = 'Starter', id = 'base'): Pledge { const p = pledge(id); p.ships.push({ childId: 'current', modelName: name, modelId: null, identity: 'unresolved', role: 'unverified' }); return p; }
function ccu(from: string, to: string, id: string): Pledge { const p = pledge(id); p.name += ' Warbond'; p.ccus.push({ instanceId: 'instance', from, to, status: 'unused', applicability: 'unverified', insurance: { kind: 'unknown', reason: 'not evidence' } }); return p; }

test('owned Warbond anchors connect with standard gaps, not target-value quotes', () => {
  const pledges = [base(), ccu('A', 'B', 'first'), ccu('C', 'Liberator', 'paid-5-euro')], before = JSON.stringify(pledges);
  pledges[2]!.acquisitionCost = { minor: 500, currency: 'EUR', taxBasis: 'gross', evidence: 'Synthetic receipt' };
  const pool = prepareChains(pledges, catalogue, offers, true), plan = buildChain(pool, catalogue[4]!, offers, true)!;
  assert.deepEqual(plan.steps.map(s => [s.kind, s.from.name, s.to.name]), [['purchase','Starter','A'],['owned','A','B'],['purchase','B','C'],['owned','C','Liberator']]);
  assert.equal(plan.ownedCount, 2); assert.equal(plan.gapCount, 2); assert.equal(plan.additionalMinor, null);
  assert.equal(plan.applicabilityConfirmed, false); assert.ok(plan.base.protected); assert.equal(plan.base.released, false);
  assert.equal(pledges[2]!.acquisitionCost!.minor, 500); pledges[2]!.acquisitionCost = null; assert.equal(JSON.stringify(pledges), before);
});
test('an all-owned chain costs zero additional, independent of old acquisition costs', () => {
  const pool = prepareChains([base(), ccu('Starter','A','one'), ccu('A','Liberator','two')], catalogue, offers, true);
  const plan = buildChain(pool, catalogue[4]!, offers, true)!;
  assert.equal(plan.additionalMinor, 0); assert.equal(plan.gapCount, 0); assert.equal(plan.steps.length, 2);
});
test('actual current model is used, not pledge title, original ship or acquisition value', () => {
  const p = base('B'); p.name = 'Starter package'; p.meltValue = { minor: 10, currency: 'USD', taxBasis: 'net', evidence: 'not upgrade value' };
  const pool = prepareChains([p, ccu('B','Liberator','owned')], catalogue, offers, true);
  assert.equal(buildChain(pool, catalogue[4]!, offers, true)!.steps[0]!.from.name, 'B');
});
test('applied, unverified, rejected and self-upgrades do not become usable inventory', () => {
  const values = [ccu('A','B','applied'),ccu('A','B','unknown'),ccu('A','B','rejected'),ccu('B','A','backward'),ccu('A','A','same')];
  values[0]!.ccus[0]!.status='applied'; values[1]!.ccus[0]!.status='unverified'; values[2]!.ccus[0]!.applicability='rejected';
  const pool=prepareChains([base(),...values],catalogue,offers,true);assert.equal(pool.ccus.length,1);assert.equal(pool.ccus[0]!.pledgeId,'backward');assert.equal(pool.ignored,4);
});
test('historical owned CCUs survive equal or reversed current ship values without claiming applicability', () => {
  const prices=offers.map(o=>({...o,regularMinor:o.toShipId===4?7000:o.toShipId===2?6000:o.toShipId===3?6000:o.regularMinor}));
  const pool=prepareChains([base('C'),ccu('C','A','old-reversed'),ccu('A','B','old-zero'),ccu('B','Liberator','last')],catalogue,prices,true);
  const plan=buildChain(pool,catalogue[4]!,prices,true)!;assert.equal(plan.steps.length,3);assert.equal(plan.additionalMinor,0);assert.equal(plan.applicabilityConfirmed,false);
  assert.ok(plan.steps[0]!.from.nominalUsd!>plan.steps[0]!.to.nominalUsd!);assert.equal(plan.steps[1]!.from.nominalUsd,plan.steps[1]!.to.nominalUsd);
});
test('variants stay separate, duplicate catalogue names and duplicate resource keys are rejected', () => {
  const pool=prepareChains([base(),ccu('A Mk II','Liberator','variant')],catalogue,offers,true);
  const plan=buildChain(pool,catalogue[4]!,offers,true)!;assert.equal(plan.steps.find(s=>s.kind==='owned')!.from.name,'A Mk II');
  const dup=ccu('A','B','same-id');assert.equal(prepareChains([dup,dup],catalogue,offers,true).ccus.length,0);
  const ambiguous=prepareChains([base('A'),ccu('A','B','ambiguous')],[...catalogue,{...catalogue[1]!,id:77}],offers,true);
  assert.equal(ambiguous.bases.length,0);assert.equal(ambiguous.ccus.length,0);
});
test('automatic suggestions do not invent a purchasable link with stale prices', () => {
  const pool = prepareChains([base(), ccu('A', 'B', 'disconnected')], catalogue, offers, false);
  assert.equal(buildChain(pool, catalogue[4]!, offers, false), null);
});
test('Liberator suggestion bypasses the Hornet Mk I purchase if the only evidence is its ship value', () => {
  const ships = catalogue.map(ship => ship.id === 1 ? { ...ship, name: 'MDC' }
    : ship.id === 2 ? { ...ship, name: 'F7C Hornet Mk I' } : ship);
  const market = offers.map(offer => ({ ...offer, targetName: ships.find(ship => ship.id === offer.toShipId)!.name }));
  const values = {
    schemaVersion: 1 as const, source: 'rsi-from-ships' as const, fetchedAt: at, currency: 'USD' as const, taxBasis: 'net' as const,
    items: market.map(offer => ({ id: offer.toShipId, name: offer.targetName, minor: offer.regularMinor })),
  };
  const active = market.filter(offer => offer.toShipId !== 2);
  const pledges = [base('MDC'), ccu('F7C Hornet Mk I', 'Liberator', 'owned-hornet'), ccu('B', 'Liberator', 'owned-b')];
  const pool = prepareChains(pledges, ships, active, true, undefined, values);
  const route = buildChain(pool, ships[4]!, active, true);
  assert.deepEqual(route?.steps.map(step => [step.kind, step.from.name, step.to.name]), [
    ['purchase', 'MDC', 'B'], ['owned', 'B', 'Liberator'],
  ]);
  const stillListed = buildChain(pool, ships[4]!, market, true);
  assert.equal(stillListed?.steps[0]?.to.name, 'F7C Hornet Mk I');
  assert.equal(buildChain(pool, ships[4]!, [], true), null);
});
test('exact owned sequences work without public price data; cycles and duplicated use cannot enter the route', () => {
  const pool=prepareChains([base('A'),ccu('A','B','one'),ccu('B','A','cycle'),ccu('B','Liberator','two'),ccu('A','B','second-instance')],catalogue,[],false);
  const plan=buildChain(pool,catalogue[4]!,[],false)!;assert.equal(plan.steps.length,2);
  assert.equal(new Set(plan.steps.map(s=>s.key)).size,plan.steps.length);assert.equal(plan.additionalMinor,0);
});
test('automatic and best-route search include a priced Warbond through ships absent from the hangar', () => {
  const target = catalogue[4]!;
  const market = offers.map(offer => ({ ...offer, warbond: offer.toShipId === 4, warbondMinor: offer.toShipId === 4 ? 3000 : null }));
  const values = {
    schemaVersion: 1 as const, source: 'rsi-from-ships' as const, fetchedAt: at, currency: 'USD' as const, taxBasis: 'net' as const,
    items: market.map(offer => ({ id: offer.toShipId, name: offer.targetName, minor: offer.regularMinor })),
  };
  const display = { settings: { ...DEFAULT_DISPLAY_SETTINGS, currency: 'USD' as const }, rate: null,
    configured: true, settingsError: false, pending: false, rateError: false };
  const pool = prepareChains([base()], catalogue, market, true, undefined, values);
  const automatic = buildChain(pool, target, market, true);
  const best = searchChains({ pool, target, offers: market, current: true, display }, { observedPrices: true });
  const chain = ['A', 'C', 'Liberator'];
  assert.deepEqual(automatic?.steps.map(step => step.to.name), chain);
  assert.deepEqual(best.plans[0]?.plan.steps.map(step => step.to.name), chain);
  assert.equal(best.bestProven, true);
  assert.equal(best.plans[0]?.score[0], 7000);
  assert.equal(best.plans[0]?.plan.ownedCount, 0);
  assert.equal(purchasePriceReader(market, values, true)(best.plans[0]!.plan.steps[1]!).kind, 'warbond');

  const withoutFeeder = market.filter(offer => offer.toShipId !== 2);
  const limited = prepareChains([base()], catalogue, withoutFeeder, true, undefined, values);
  const direct = searchChains({ pool: limited, target, offers: withoutFeeder, current: true, display }, { observedPrices: true });
  assert.equal(direct.plans[0]?.score[0], 9000);
  assert.deepEqual(direct.plans[0]?.plan.steps.map(step => step.to.name), ['Liberator']);
});
test('explicit base choice, no base, already-owned target, loaners and downward targets', () => {
  const b=base('Liberator','already'),loan=base('C','loan');loan.ships[0]!.role='loaner';
  const pool=prepareChains([base(),b,loan],catalogue,offers,true);assert.equal(pool.bases.length,2);
  const automatic=buildChain(pool,catalogue[4]!,offers,true)!;assert.equal(automatic.steps.length,0);assert.equal(automatic.additionalMinor,0);
  const explicit=buildChain(pool,catalogue[4]!,offers,true,pool.bases.find(x=>x.pledgeId==='base')!.key)!;assert.equal(explicit.steps.length,1);
  assert.equal(buildChain(pool,catalogue[0]!,offers,true,pool.bases.find(x=>x.pledgeId==='already')!.key),null);
  assert.equal(buildChain(prepareChains([],catalogue,offers,true),catalogue[4]!,offers,true),null);
});
test('hard limits stop planning rather than hiding a truncated resource allocation', () => {
  const pool=prepareChains([base(),...Array.from({length:501},(_,i)=>ccu('A','B',String(i)))],catalogue,offers,true);
  assert.equal(pool.limited,true);assert.equal(buildChain(pool,catalogue[4]!,offers,true),null);
});

test('automatic draft considers nominal base value instead of hiding anchors behind an expensive owned ship', () => {
  const expensive={...catalogue[0]!,id:99,name:'Expensive existing ship'};
  const allShips=[...catalogue,expensive],allOffers=[...offers,{...offers[0]!,key:'expensive',toShipId:99,targetName:expensive.name,regularMinor:9000}];
  const pool=prepareChains([base(),base(expensive.name,'expensive-base'),ccu('A','B','first'),ccu('C','Liberator','last')],allShips,allOffers,true);
  const plan=buildChain(pool,catalogue[4]!,allOffers,true)!;
  assert.equal(plan.base.pledgeId,'base');assert.equal(plan.ownedCount,2);assert.equal(plan.gapCount,2);
  const explicit=buildChain(pool,catalogue[4]!,allOffers,true,pool.bases.find(b=>b.pledgeId==='expensive-base')!.key)!;
  assert.equal(explicit.base.pledgeId,'expensive-base');assert.equal(explicit.ownedCount,0);assert.equal(explicit.gapCount,1);
});
