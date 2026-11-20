import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DailyRefresh, nextPublicRefresh, type RefreshClock } from '../src/scheduling/daily-refresh';
import { MarketService } from '../src/market/service';
import { PricingService } from '../src/pricing/service';
import { LoanerService } from '../src/loaners/service';

class Clock implements RefreshClock {
  time = Date.parse('2026-11-16T09:00:00Z');
  deadlines = new Map<number, { at: number; callback: () => void }>();
  private id = 0;
  now = () => this.time;
  arm(callback: () => void, delay: number) {
    const id = ++this.id; this.deadlines.set(id, { at: this.time + delay, callback });
    return () => { this.deadlines.delete(id); };
  }
  advance(iso: string) {
    this.time = Date.parse(iso);
    for (const [id, task] of [...this.deadlines]) if (task.at <= this.time) {
      this.deadlines.delete(id); task.callback();
    }
  }
}
const next = (iso: string) => new Date(nextPublicRefresh(Date.parse(iso))).toISOString();
test('Loaner sources follow startup and Berlin 17:05 only; closing clears the timer', async () => {
  const clock=new Clock();let calls=0;const service=new LoanerService(path.resolve('work/temp/daily-loaner-'+Date.now()),async()=>{calls++;throw Error('SYNTHETIC_OFFLINE');},clock);
  service.start();service.start();await service.refresh();assert.equal(calls,2);
  clock.advance('2026-11-16T15:30:00Z');assert.equal(calls,2);
  clock.advance('2026-11-16T16:05:00Z');await service.refresh();assert.equal(calls,4);
  service.close();assert.equal(clock.deadlines.size,0);
});
test('17:05 Berlin follows summer/winter time, exact deadlines and year boundaries', () => {
  assert.equal(next('2026-11-16T16:04:59.999Z'), '2026-11-16T16:05:00.000Z');
  assert.equal(next('2026-11-16T16:05:00Z'), '2026-11-17T16:05:00.000Z');
  assert.equal(next('2026-07-01T14:00:00Z'), '2026-07-01T15:05:00.000Z');
  assert.equal(next('2026-03-28T16:05:00Z'), '2026-03-29T15:05:00.000Z');
  assert.equal(next('2026-10-24T15:05:00Z'), '2026-10-25T16:05:00.000Z');
  assert.equal(next('2026-12-31T16:05:00Z'), '2027-01-01T16:05:00.000Z');
});
test('Startup once, no half-hour refresh, daily deadline, one catch-up after sleep, close cancels', () => {
  const clock = new Clock(); let calls = 0;
  const schedule = new DailyRefresh(async () => { calls++; }, clock);
  schedule.start(); schedule.start(); assert.equal(calls, 1);
  for (let hour = 10; hour < 16; hour++) clock.advance(`2026-11-16T${hour}:30:00Z`);
  assert.equal(calls, 1); assert.equal(clock.deadlines.size, 1);
  clock.advance('2026-11-16T16:05:00Z'); assert.equal(calls, 2);
  clock.advance('2026-11-20T18:00:00Z'); assert.equal(calls, 3);
  assert.deepEqual([...clock.deadlines.values()].map(x => x.at), [Date.parse('2026-11-21T16:05:00Z')]);
  schedule.close(); schedule.start(); assert.equal(clock.deadlines.size, 0);
  clock.advance('2026-11-22T18:00:00Z'); assert.equal(calls, 3);
});
test('A clock moved backwards never triggers an early request; failed startup still schedules next day', async () => {
  const clock = new Clock(); let calls = 0;
  const schedule = new DailyRefresh(async () => { calls++; throw Error('SYNTHETIC_OFFLINE'); }, clock);
  schedule.start(); await Promise.resolve();
  const task = [...clock.deadlines.entries()][0]!; clock.deadlines.delete(task[0]);
  clock.time = Date.parse('2026-11-15T12:00:00Z'); task[1].callback();
  assert.equal(calls, 1);
  assert.deepEqual([...clock.deadlines.values()].map(x => x.at), [Date.parse('2026-11-15T16:05:00Z')]);
  schedule.close();
});
test('Market and exchange-rate services use daily deadlines, coalesce refreshes and stop on close', async () => {
  const root = path.resolve('work/temp/daily-refresh-unit'); fs.mkdirSync(root, { recursive: true });
  const directory = fs.mkdtempSync(path.join(root, 'case-')), clock = new Clock();
  let marketCalls = 0, rateCalls = 0;
  const market = new MarketService(path.join(directory, 'market'), async () => { marketCalls++; throw Error('SYNTHETIC_OFFLINE'); }, clock);
  const pricing = new PricingService(path.join(directory, 'pricing'), async () => { rateCalls++; throw Error('SYNTHETIC_OFFLINE'); }, clock);
  try {
    market.start(); market.start(); pricing.start(); pricing.start();
    await Promise.all([market.refresh(), pricing.refresh()]);
    assert.equal(marketCalls, 3); assert.equal(rateCalls, 1);
    assert.deepEqual(market.snapshot().refreshSchedule, { hour: 17, minute: 5, timeZone: 'Europe/Berlin' });
    clock.advance('2026-11-16T15:30:00Z'); assert.equal(marketCalls, 3); assert.equal(rateCalls, 1);
    clock.advance('2026-11-16T16:05:00Z');
    await Promise.all([market.refresh(), pricing.refresh()]);
    assert.equal(marketCalls, 6); assert.equal(rateCalls, 2);
  } finally { market.close(); pricing.close(); }
  assert.equal(clock.deadlines.size, 0);
  clock.advance('2026-11-17T16:05:00Z'); assert.equal(marketCalls, 6); assert.equal(rateCalls, 2);
});
