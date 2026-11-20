import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { activeExhibition, FairNewsStore } from '../src/market/fair-news';
import type { MarketCache, TargetOffer } from '../src/market/model';
import { MarketService, type PublicReader } from '../src/market/service';
import { commandSchema } from '../src/main/commands';

const at = (day: number, hour = 16) => new Date(Date.UTC(2026, 10, day, hour, 5)).toISOString();
const timestamp = (day: number, hour = 16) => Date.parse(at(day, hour));
const fair = { name: 'Intergalactic Aerospace Expo 2956', start: timestamp(13), end: timestamp(28) };
const calendar = { v: 1, now: [{ ...fair, name: 'IAE 2956 Free Fly' }, fair] };
const exhibitorDay = { name: 'IAE 2956 Day 6: Argo, CO, Greycat', start: timestamp(18, 15), end: timestamp(19, 16) };
const dailyCalendar = { v: 1, now: [exhibitorDay] };
const offer = (id: number, price: number | null, change: TargetOffer['change'] = 'current'): TargetOffer => ({
  key: `openh:${id}:${id}`, name: `Upgrade to Ship ${id}`, targetName: `Ship ${id}`, toShipId: id, toSkuId: id,
  warbond: price !== null, warbondMinor: price, regularMinor: 10000, currency: 'USD', taxBasis: 'net',
  verification: 'target-observation', firstSeenAt: at(17), lastSeenAt: at(18), change,
  previousRegularMinor: null, previousWarbondMinor: null,
});
const batch = (day: number, items: TargetOffer[], hour = 16): NonNullable<MarketCache['offers']> => ({
  sourceAt: at(day, hour), fetchedAt: at(day, hour), checkedAt: at(day, hour), items,
});
function folder(t: TestContext) {
  fs.mkdirSync(path.resolve('work/temp'), { recursive: true });
  const directory = fs.mkdtempSync(path.resolve('work/temp/fair-news-'));
  t.after(() => {
    for (const file of fs.readdirSync(directory)) fs.unlinkSync(path.join(directory, file));
    fs.rmdirSync(directory);
  });
  return directory;
}

test('calendar selects only a dated current expo and skips separate Free Fly entries', () => {
  assert.equal(activeExhibition(calendar, timestamp(18))?.name, fair.name);
  assert.equal(activeExhibition(calendar, timestamp(29)), null);
  assert.equal(activeExhibition({ v: 1, now: [calendar.now[0], { ...fair, name: 'This Week in Star Citizen' }] }, timestamp(18)), null);
});

test('calendar prefers the full expo to its current exhibitor day in either source order', () => {
  for (const now of [[exhibitorDay, ...calendar.now], [...calendar.now, exhibitorDay]]) {
    const selected = activeExhibition({ v: 1, now }, timestamp(18));
    assert.deepEqual(selected, { key: 'iae-2026', ...fair });
  }
  assert.equal(activeExhibition(dailyCalendar, timestamp(18))?.name, exhibitorDay.name);
  const finale = { ...exhibitorDay, name: 'IAE 2956 Finale', end: timestamp(20) };
  assert.equal(activeExhibition({ v: 1, now: [finale, fair] }, timestamp(18))?.name, fair.name);
});

test('an exhibitor-only response keeps the recorded expo active on the next day', t => {
  const journal = new FairNewsStore(folder(t), timestamp(17, 9));
  const before = batch(17, [offer(1, null)]);
  const first = batch(18, [offer(1, 8000), offer(2, null)]);
  const second = batch(19, [offer(1, 8000), offer(2, 7000)], 17);
  journal.record(calendar, before, first, timestamp(18), () => []);
  journal.record(dailyCalendar, first, first, timestamp(18), () => []);
  journal.record({ v: 1, now: [] }, first, second, timestamp(19, 17), () => []);
  const news = journal.snapshot(second, timestamp(19, 17), false);
  assert.equal(news.exhibition, fair.name);
  assert.equal(news.status, 'fresh');
  assert.deepEqual(news.unread.map(row => row.shipId), [2, 1]);
});

test('expanding a recorded exhibitor day restores eligible archived notices and preserves seen notices', t => {
  const directory = folder(t);
  const journal = new FairNewsStore(directory, timestamp(17, 9));
  const before = batch(16, [offer(1, null), offer(2, null), offer(3, null), offer(4, 6000)]);
  const morning = batch(17, [offer(1, 7500), offer(2, null), offer(3, null)], 8);
  const first = batch(17, [offer(1, 7500), offer(2, 8000), offer(3, null)]);
  const latest = batch(18, [offer(1, 7500), offer(2, 8000), offer(3, 7000)]);
  journal.record(dailyCalendar, first, latest, timestamp(18), () => []);
  const [seen] = journal.snapshot(latest, timestamp(18), false).unread;
  assert.equal(seen?.shipId, 3);
  journal.markSeen(seen!.id);

  const restarted = new FairNewsStore(directory, timestamp(18));
  const history = () => [batch(15, [offer(1, null), offer(4, null)]), before, morning, first];
  restarted.record(calendar, latest, latest, timestamp(18), history);
  restarted.record(calendar, latest, latest, timestamp(18), history);
  const news = restarted.snapshot(latest, timestamp(18), false);
  assert.equal(news.status, 'fresh');
  assert.deepEqual(news.unread.map(row => row.shipId), [2, 1]);
});

test('expanding a day with no archived predecessor preserves the previous comparison', t => {
  const journal = new FairNewsStore(folder(t), timestamp(18, 9));
  const before = batch(18, [offer(1, null)], 9);
  const latest = batch(18, [offer(1, 8000)]);
  journal.record(dailyCalendar, before, latest, timestamp(18), () => []);
  journal.record(calendar, latest, latest, timestamp(18), () => []);
  const news = journal.snapshot(latest, timestamp(18), false);
  assert.equal(news.exhibition, fair.name);
  assert.equal(news.status, 'fresh');
  assert.deepEqual(news.unread.map(row => row.shipId), [1]);
});

test('dated arrivals accumulate; seen stays seen across restarts, and existing Warbond price changes stay out', t => {
  const directory = folder(t);
  const journal = new FairNewsStore(directory, timestamp(18, 8));
  const morning = batch(18, [offer(1, null), offer(2, 8000)], 9);
  const dayOne = batch(18, [offer(1, 7000), offer(2, 7500), offer(3, null)]);
  const dayTwo = batch(19, [offer(1, 7000, 'missing'), offer(2, 7500), offer(3, 8500)]);
  journal.record(calendar, morning, dayOne, timestamp(18), () => []);
  journal.record(calendar, dayOne, dayTwo, timestamp(19), () => []);
  const unread = journal.snapshot(dayTwo, timestamp(19), false).unread;
  assert.deepEqual(unread.map(row => [row.shipId, row.day, row.currentUsdMinor]), [[3, '2026-11-19', 8500], [1, '2026-11-18', null]]);
  const changed = batch(20, [offer(3, 8000)]);
  journal.record(calendar, dayTwo, changed, timestamp(20), () => []);
  assert.deepEqual(journal.snapshot(changed, timestamp(20), false).unread.map(row => [row.shipId, row.currentUsdMinor]), [[3, 8000], [1, null]]);
  journal.markSeen(unread[0]!.id);

  const restarted = new FairNewsStore(directory, timestamp(20));
  restarted.record(calendar, dayTwo, dayTwo, timestamp(19), () => [morning, dayOne]);
  assert.deepEqual(restarted.snapshot(dayTwo, timestamp(19), false).unread.map(row => row.shipId), [1]);
});

test('replay is bounded by the installation day and fair; first or old samples cannot invent new offers', t => {
  const journal = new FairNewsStore(folder(t), timestamp(18, 9));
  const before = batch(12, [offer(1, null)]);
  const oldFair = batch(14, [offer(1, 7000)]);
  const yesterday = batch(17, [offer(1, 7000), offer(2, 8500)]);
  const today = batch(18, [offer(1, 7000), offer(2, 8500), offer(3, 8000)]);
  journal.record(calendar, null, today, timestamp(18), () => []);
  assert.equal(journal.snapshot(today, timestamp(18), false).status, 'waiting');
  assert.deepEqual(journal.snapshot(today, timestamp(18), false).unread, []);
  journal.record(calendar, today, today, timestamp(18), () => [before, oldFair, yesterday]);
  assert.deepEqual(journal.snapshot(today, timestamp(18), false).unread.map(row => row.shipId), [3]);
  assert.equal(journal.snapshot(today, timestamp(18), false).status, 'fresh');
  assert.equal(journal.snapshot(today, timestamp(19), false).status, 'waiting');
});

test('calendar outages preserve unread notices; the next fair clears the previous fair', t => {
  const journal = new FairNewsStore(folder(t), timestamp(18));
  const older = batch(17, [offer(1, null)]);
  const today = batch(18, [offer(1, 8000)]);
  journal.record(calendar, older, today, timestamp(18), () => []);
  journal.record({ unexpected: true }, today, today, timestamp(19), () => []);
  assert.equal(journal.snapshot(today, timestamp(19), true).unread.length, 1);
  const nextFair = { ...fair, name: 'DefenseCon 2956', start: timestamp(29, 0), end: timestamp(30) };
  journal.record({ v: 1, now: [nextFair] }, today, today, timestamp(29), () => [older]);
  assert.deepEqual(journal.snapshot(today, timestamp(29), false).unread, []);
});

test('market refresh and seen IPC use public store evidence without adding a new polling timer', async t => {
  const directory = folder(t);
  const now = Date.now;
  Date.now = () => timestamp(18);
  try {
    let current = false;
    const read: PublicReader = async source => {
      if (source === 'calendar') return calendar;
      if (source !== 'offers') throw new Error('OPTIONAL_SOURCE_UNAVAILABLE');
      return { at: current ? at(18) : at(18, 9), items: [{
        k: 'ccus', n: 'Upgrade to Test Ship', p: 100, toShipId: 1, toSkuId: 1,
        wb: current, wbu: current ? { p: 90 } : null,
      }] };
    };
    const service = new MarketService(directory, read, undefined, new FairNewsStore(directory, timestamp(18, 9)));
    await service.refresh();
    current = true;
    await service.refresh();
    const news = service.snapshot().fairNews!;
    assert.equal(news.unread.length, 1);
    assert.equal(news.unread[0]!.usdMinor, 9000);
    assert.ok(commandSchema.safeParse({ action: 'market.fairSeen', noticeId: news.unread[0]!.id }).success);
    assert.equal(commandSchema.safeParse({ action: 'market.fairSeen', noticeId: '../../bad' }).success, false);
    service.markFairNoticeSeen(news.unread[0]!.id);
    await service.refresh();
    assert.deepEqual(service.snapshot().fairNews!.unread, []);
    service.close();
  } finally { Date.now = now; }
});
