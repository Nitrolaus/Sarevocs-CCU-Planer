import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseCatalogue, parseOffers, mergeOffers, matchingOffer, offersAreStale, MARKET_SOURCES, type MarketSnapshot } from '../src/market/model';
import { MarketService } from '../src/market/service';
import { commandSchema } from '../src/main/commands';
import { creditBudgetLimit } from '../src/planner/credit-budget';
import { SHOP_PRICE_MAX_AGE, shopPairKey, type ShopPrice } from '../src/market/shop-prices';

const now = () => new Date().toISOString();
const source = () => Date.now() - 60_000;
const ship = (id = 62, name = 'Synthetic Explorer') => ({ id, name, chassis_id: 22, manufacturer: { name: 'Synthetic Manufacturer', code: 'SYN' }, production_status: 'flight-ready', focus: 'Exploration', length: '126.5', media: [{ images: { source: 'https://example.invalid/do-not-load.png' } }] });
const catalogue = () => ({ success: 1, data: [ship(), ship(206, 'Synthetic Explorer Expedition')] });
const offer = (id = 62, p = 400, wb = true) => ({ k: 'ccus', n: 'Upgrade to Synthetic Explorer', toShipId: id, toSkuId: 19000 + id, p, wb, wbu: wb ? { p: 360, std: 400 } : null });
const feed = (items: unknown[] = [offer()]) => ({ at: source(), checkedAt: Date.now(), readEvery: 20, items });
function directory() { const folder = path.resolve('work/temp/market-unit'); fs.mkdirSync(folder, { recursive: true }); return fs.mkdtempSync(path.join(folder, 'case-')); }
function snapshot(data = parseOffers(feed(), now())): MarketSnapshot { return { schemaVersion: 1, catalogue: null, offers: data, pending: false, errors: { catalogue: null, offers: null }, refreshSchedule: { hour: 17, timeZone: 'Europe/Berlin' } }; }

test('inventory quote shares the exact pair already being fetched for the planner', async () => {
  const pair = { fromId: 62, toId: 206 };
  let finish = () => {};
  const transport = new Promise<void>(resolve => { finish = resolve; });
  let reads = 0;
  const service = new MarketService(directory(), async source => source === 'catalogue' ? catalogue() : feed(),
    undefined, undefined, async requested => {
      reads++;
      assert.deepEqual(requested, pair);
      await transport;
      return [{ ...pair, edition: 'warbond', checkedAt: Date.now(), amount: { minor: 1047, currency: 'EUR', taxMode: 'gross', vatBasisPoints: 1900 } }];
    });
  try {
    await service.refresh();
    const planner = service.checkShopPrices([pair]);
    const inventory = service.quoteShopPrice(pair);
    finish();
    const [prices] = await Promise.all([inventory, planner]);
    assert.equal(reads, 1);
    assert.equal(prices[0]?.amount.minor, 1047);
    assert.equal(prices[0]?.edition, 'warbond');
    assert.deepEqual(await service.quoteShopPrice({ fromId: 62, toId: 207 }), []);
  } finally { service.close(); }
});

test('last confirmed exact shop quotes survive a change of quote currency, a failed refresh and a restart', async (t) => {
  const dir = directory(), pair = { fromId: 62, toId: 206 };
  let clock = Date.now(), reject = false;
  t.mock.method(Date, 'now', () => clock);
  const quote: ShopPrice = { ...pair, edition: 'standard', checkedAt: clock,
    amount: { minor: 1320, currency: 'EUR', taxMode: 'gross', vatBasisPoints: 1900 } };
  const dollarQuote: ShopPrice = { ...quote, checkedAt: clock + SHOP_PRICE_MAX_AGE + 1,
    amount: { minor: 1250, currency: 'USD', taxMode: 'net', vatBasisPoints: 0 } };
  const read = async (source: string) => source === 'catalogue' ? catalogue() : feed();
  const service = new MarketService(dir, read, undefined, undefined, async () => {
    if (reject) throw new Error('offline');
    return [clock === quote.checkedAt ? quote : dollarQuote];
  });
  try {
    await service.refresh();
    await service.checkShopPrices([pair]);
    assert.deepEqual(service.snapshot().shopPrices, [quote]);
    assert.equal(service.snapshot().lastShopPrices, undefined);
    clock = dollarQuote.checkedAt;
    await service.checkShopPrices([pair]);
    assert.deepEqual(service.snapshot().shopPrices, [dollarQuote]);
    clock += SHOP_PRICE_MAX_AGE + 1;
    reject = true;
    await service.checkShopPrices([pair]);
    assert.deepEqual(service.snapshot().shopPrices, []);
    assert.deepEqual(service.snapshot(true).lastShopPrices, [quote, dollarQuote]);
  } finally { service.close(); }

  const restored = new MarketService(dir, read, undefined, undefined, async () => []);
  try {
    assert.deepEqual(restored.snapshot(true).lastShopPrices, [quote, dollarQuote]);
    await restored.checkShopPrices([pair]);
    assert.deepEqual(restored.snapshot().shopPrices, []);
    assert.deepEqual(restored.snapshot(true).lastShopPrices, [quote, dollarQuote]);
  } finally { restored.close(); }
});

test('automatic inventory batches are deduplicated and run at most two exact-pair reads at once', async () => {
  const pairs = [{ fromId: 62, toId: 206 }, { fromId: 206, toId: 62 }, { fromId: 62, toId: 207 }];
  const seen: string[] = [];
  let active = 0, maxActive = 0;
  const service = new MarketService(directory(), async source => source === 'catalogue'
    ? { ...catalogue(), data: [...catalogue().data, ship(207, 'Synthetic Testbed')] } : feed(), undefined, undefined, async pair => {
    seen.push(shopPairKey(pair));
    maxActive = Math.max(maxActive, ++active);
    await new Promise(resolve => setImmediate(resolve));
    active--;
    return [];
  });
  try {
    await service.refresh();
    await Promise.all([...pairs.map(pair => service.checkShopPrices([pair])), service.checkShopPrices(pairs)]);
    assert.deepEqual(seen, pairs.map(shopPairKey));
    assert.equal(maxActive, 2);
  } finally { service.close(); }
});

test('Matrix identities distinguish variants with the same chassis and drop all media', () => {
  const data = parseCatalogue(catalogue());
  assert.deepEqual(data.map(s => s.id), [62, 206]); assert.equal(data[0]!.chassisId, data[1]!.chassisId);
  assert.equal(data[0]!.length, 126.5); assert.equal(JSON.stringify(data).includes('https:'), false);
});
test('A malformed or duplicate matrix must not become an apparently complete catalogue', () => {
  assert.throws(() => parseCatalogue({ success: false, data: [ship()] }));
  assert.throws(() => parseCatalogue({ success: 1, data: [ship(), ship()] }));
  assert.throws(() => parseCatalogue({ success: 1, data: [ship(), { id: 99 }] }));
});
test('Standard and Warbond target values are distinct USD minor units, never a from-to amount', () => {
  const row = parseOffers(feed(), now()).items[0]!;
  assert.equal(row.regularMinor, 40000); assert.equal(row.warbondMinor, 36000);
  assert.equal(row.verification, 'target-observation'); assert.equal(row.taxBasis, 'net');
  assert.equal('fromShipId' in row, false); assert.equal('upgradePrice' in row, false);
});
test('Missing Warbond price stays unknown, with no regular-price fallback', () => {
  const row = parseOffers(feed([{ ...offer(), wbu: null }]), now()).items[0]!;
  assert.equal(row.warbond, true); assert.equal(row.warbondMinor, null);
});
test('Malformed current CCU rows reject the whole refresh; no silent partial deletion', () => {
  for (const bad of [{ ...offer(), p: -1 }, { ...offer(), p: 1.234 }, { ...offer(), toShipId: null }, { ...offer(), n: 'Standalone ship' }, { ...offer(), wbu: { p: 500 } }]) {
    assert.throws(() => parseOffers(feed([offer(206), bad]), now()));
  }
  assert.throws(() => parseOffers(feed([offer(), offer()]), now()));
  assert.throws(() => parseOffers(feed([{ k: 'paints' }]), now()));
  assert.throws(() => parseOffers({ ...feed(), currency: 'EUR' }, now()));
});
test('Source time is distinct from checkedAt and cannot be arbitrarily in the future', () => {
  const data = parseOffers({ ...feed(), at: Date.now() - 7 * 3600000 }, now());
  assert.equal(offersAreStale(snapshot(data)), true);
  assert.throws(() => parseOffers({ ...feed(), at: Date.now() + 3600000 }, now()));
});
test('Observed disappearance is historical, not a fabricated expiration', () => {
  const old = parseOffers(feed(), now()), next = parseOffers(feed([offer(206)]), now()); next.sourceAt = old.sourceAt;
  const merged = mergeOffers(next, old), gone = merged.items.find(o => o.toShipId === 62)!;
  assert.equal(gone.change, 'missing'); assert.equal(gone.lastSeenAt, old.items[0]!.lastSeenAt);
  assert.equal('expiresAt' in gone, false); assert.equal(merged.items.find(o => o.toShipId === 206)!.change, 'new');
});
test('Price changes and reappearance preserve the old observation provenance', () => {
  const old = parseOffers(feed(), now()), next = parseOffers(feed([{ ...offer(), wbu: { p: 350 } }]), now()); next.sourceAt = old.sourceAt;
  const changed = mergeOffers(next, old).items[0]!;
  assert.equal(changed.change, 'changed'); assert.equal(changed.previousWarbondMinor, 36000); assert.equal(changed.firstSeenAt, old.items[0]!.firstSeenAt);
  assert.equal(mergeOffers(next, { ...old, items: [{ ...old.items[0]!, change: 'missing' }] }).items[0]!.change, 'changed');
});
test('Older snapshots and reused IDs with a different target are rejected', () => {
  const old = parseOffers(feed(), now()), next = parseOffers(feed(), now());
  assert.throws(() => mergeOffers({ ...next, sourceAt: new Date(Date.parse(old.sourceAt) - 1).toISOString() }, old));
  next.sourceAt = old.sourceAt; next.items[0]!.targetName = 'Another variant'; assert.throws(() => mergeOffers(next, old));
});
test('Matching requires the matrix ID and the exact variant name, not either alone', () => {
  const ships = parseCatalogue(catalogue()), offers = parseOffers(feed(), now()).items;
  assert.ok(matchingOffer(ships[0]!, offers));
  assert.equal(matchingOffer({ ...ships[0]!, id: 206 }, offers), undefined);
  assert.equal(matchingOffer({ ...ships[0]!, name: 'Synthetic Explorer Expedition' }, offers), undefined);
});
test('Market IPC permits no arbitrary URL, source, method or unbounded target list', () => {
  assert.equal(commandSchema.safeParse({ action: 'market.status', url: 'https://example.invalid' }).success, false);
  assert.equal(commandSchema.safeParse({ action: 'market.refresh', method: 'POST' }).success, false);
  assert.equal(commandSchema.safeParse({ action: 'market.targets', accountId: randomUUID(), ids: [1, 2, 3, 4] }).success, false);
  assert.deepEqual(Object.keys(MARKET_SOURCES).sort(), ['calendar', 'catalogue', 'fx', 'included', 'loaners', 'offers', 'shipValues']);
  assert.equal(MARKET_SOURCES.fx, 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml');
});
test('Service retains valid old offers on network/schema failure and after restart', async () => {
  const dir = directory(); let fail = false;
  const service = new MarketService(dir, async s => { if (fail && s === 'offers') throw new Error('SYNTHETIC_FAILURE'); return s === 'catalogue' ? catalogue() : feed(); });
  await service.refresh(); const previous = service.snapshot().offers!; fail = true; await service.refresh();
  assert.deepEqual(service.snapshot().offers, previous); assert.ok(service.snapshot().errors.offers);
  const restored = new MarketService(dir, async () => { throw new Error('offline'); });
  assert.deepEqual(restored.snapshot().offers, previous); service.close(); restored.close();
});
test('Independent catalogue failure does not discard a successful offer refresh', async () => {
  const service = new MarketService(directory(), async s => { if (s === 'catalogue') throw new Error('offline'); return feed(); });
  await service.refresh(); assert.equal(service.snapshot().catalogue, null); assert.ok(service.snapshot().offers); assert.ok(service.snapshot().errors.catalogue); service.close();
});
test('Concurrent refreshes coalesce and shutdown aborts without saving partial data', async () => {
  let requests = 0;
  const service = new MarketService(directory(), (_s, signal) => new Promise((_resolve, reject) => { requests++; signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }); }));
  const first = service.refresh(), second = service.refresh(); assert.equal(first, second); assert.equal(requests, 3);
  service.close(); await first; assert.equal(service.snapshot().offers, null); assert.equal(service.snapshot().pending, false);
});
test('Targets are profile-separated, validated and persisted without touching inventory', async () => {
  const dir = directory(), a = randomUUID(), b = randomUUID(), service = new MarketService(dir, async s => s === 'catalogue' ? catalogue() : feed());
  await service.refresh(); service.setTargets(a, [62, null, 206]);
  assert.deepEqual(service.targets(a), [62, null, 206]); assert.deepEqual(service.targets(b), [null, null, null]);
  assert.throws(() => service.setTargets(a, [62, 62, null])); assert.throws(() => service.setTargets(a, [999, null, null]));
  assert.throws(() => service.targets('../outside')); assert.equal(fs.existsSync(path.join(dir, 'inventory.sqlite')), false);
  assert.deepEqual(new MarketService(dir, async () => null).targets(a), [62, null, 206]); service.close();
  const file = path.join(dir, `targets-${a}.json`); fs.writeFileSync(file, '{bad');
  assert.throws(() => service.targets(a)); assert.equal(fs.readFileSync(file, 'utf8'), '{bad');
});
test('credit budgets are separate per profile and survive a restart, including an explicit zero', () => {
  const dir = directory(), a = randomUUID(), b = randomUUID();
  const service = new MarketService(dir, async () => null);
  assert.equal(service.creditBudget(a), null);
  assert.deepEqual(service.creditBudget(a, { minor: 4000, currency: 'USD' }), { minor: 4000, currency: 'USD' });
  assert.equal(service.creditBudget(b), null);
  service.creditBudget(b, { minor: 0, currency: 'EUR' });
  service.close();
  const restored = new MarketService(dir, async () => null);
  assert.deepEqual(restored.creditBudget(a), { minor: 4000, currency: 'USD' });
  assert.deepEqual(restored.creditBudget(b), { minor: 0, currency: 'EUR' });
  assert.deepEqual(restored.targets(a), [null, null, null]);
  assert.throws(() => restored.creditBudget('../outside'));
  restored.close();
});
test('credit budget rejects invalid amounts and preserves unreadable or foreign profile records', () => {
  const dir = directory(), accountId = randomUUID(), service = new MarketService(dir, async () => null);
  for (const budget of [{ minor: -1, currency: 'USD' }, { minor: 1.5, currency: 'EUR' },
    { minor: 100_000_001, currency: 'USD' }, { minor: 1, currency: 'GBP' }, { minor: 1, currency: 'USD', amount: 2 }]) {
    assert.equal(commandSchema.safeParse({ action: 'planner.creditBudget', accountId, budget }).success, false);
  }
  const file = path.join(dir, `credit-budget-${accountId}.json`);
  for (const content of ['{bad', JSON.stringify({ schemaVersion: 1, accountId: randomUUID(), budget: { minor: 2000, currency: 'USD' } })]) {
    fs.writeFileSync(file, content);
    assert.throws(() => service.creditBudget(accountId), /CREDIT_BUDGET_UNREADABLE/);
    assert.throws(() => service.creditBudget(accountId, { minor: 1000, currency: 'USD' }), /CREDIT_BUDGET_UNREADABLE/);
    assert.equal(fs.readFileSync(file, 'utf8'), content);
  }
  service.close();
});
test('credit limit falls with the balance, restores after a refill, and never borrows another currency', () => {
  const balance = { minor: 6000, currency: 'USD' as const, source: 'rsi-credit-ledger' as const, observedAt: now() };
  const saved = { minor: 4000, currency: 'USD' as const };
  assert.equal(creditBudgetLimit(null, balance), 6000);
  assert.equal(creditBudgetLimit(saved, balance), 4000);
  assert.equal(creditBudgetLimit(saved, { ...balance, minor: 2500 }), 2500);
  assert.equal(creditBudgetLimit(saved, { ...balance, minor: 9000 }), 4000);
  assert.equal(creditBudgetLimit(saved, { ...balance, currency: 'EUR' }), 0);
  assert.equal(creditBudgetLimit(saved), 0);
  assert.equal(creditBudgetLimit({ ...saved, minor: 0 }, balance), 0);
});
test('Corrupt public cache is surfaced instead of masquerading as a valid empty snapshot', () => {
  const dir = directory(); fs.writeFileSync(path.join(dir, 'public-v1.json'), '{bad');
  const service = new MarketService(dir, async () => null); assert.equal(service.snapshot().catalogue, null); assert.ok(service.snapshot().errors.catalogue); service.close();
});
test('A meaningful price change preserves the previous snapshot; identical refreshes do not create history noise', async () => {
  const dir = directory(); let price = 360;
  const service = new MarketService(dir, async s => s === 'catalogue' ? catalogue() : { ...feed([{ ...offer(), wbu: { p: price } }]), at: Date.now() });
  await service.refresh(); await service.refresh(); assert.equal(fs.readdirSync(dir).filter(n => n.startsWith('history-offers-')).length, 0);
  price = 350; await service.refresh();
  const archives = fs.readdirSync(dir).filter(n => n.startsWith('history-offers-')); assert.equal(archives.length, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, archives[0]!), 'utf8')).offers.items[0].warbondMinor, 36000);
  await service.refresh(); assert.equal(service.snapshot().offers!.items[0]!.previousWarbondMinor, 36000);
  assert.equal(fs.readdirSync(dir).filter(n => n.startsWith('history-offers-')).length, 1); service.close();
});
