import test from 'node:test';
import assert from 'node:assert/strict';
import { InventoryRefresh } from '../src/main/inventory-refresh';
import type { RefreshClock } from '../src/scheduling/daily-refresh';

class Clock implements RefreshClock {
  time = Date.parse('2026-11-16T09:00:00Z');
  tasks = new Map<number, { at: number; run: () => void }>(); next = 0;
  now = () => this.time;
  arm(run: () => void, delay: number) { const id = ++this.next; this.tasks.set(id, { at: this.time + delay, run }); return () => { this.tasks.delete(id); }; }
  advance(iso: string) { this.time = Date.parse(iso); for (const [id, t] of [...this.tasks]) if (t.at <= this.time) { this.tasks.delete(id); t.run(); } }
}
test('selected profile is read at startup and 17:05 Berlin, never every half hour; close cancels', async () => {
  const clock = new Clock(), calls: string[] = []; let selected: string | null = 'profile-a'; let interactive = false;
  const refresh = new InventoryRefresh(async id => { calls.push(id); }, () => selected, () => interactive, clock);
  refresh.start(); refresh.start(); assert.deepEqual(calls, ['profile-a']);
  clock.advance('2026-11-16T16:00:00Z'); assert.equal(calls.length, 1);
  selected = 'profile-b'; clock.advance('2026-11-16T16:05:00Z'); assert.deepEqual(calls, ['profile-a', 'profile-b']);
  interactive = true; clock.advance('2026-11-17T16:05:00Z'); assert.equal(calls.length, 2);
  interactive = false; selected = null; clock.advance('2026-11-18T16:05:00Z'); assert.equal(calls.length, 2);
  selected = 'profile-a'; clock.advance('2026-11-20T18:00:00Z'); assert.equal(calls.length, 3);
  refresh.close(); assert.equal(clock.tasks.size, 0);
  clock.advance('2026-11-21T18:00:00Z'); assert.equal(calls.length, 3);
});
test('failed restore keeps the daily schedule and never invokes an interactive login provider', async () => {
  const clock = new Clock(); let reads = 0;
  const refresh = new InventoryRefresh(async () => { reads++; throw Error('SYNTHETIC_AUTH_REQUIRED'); }, () => 'profile-a', () => false, clock);
  refresh.start(); await Promise.resolve(); await Promise.resolve();
  assert.equal(reads, 1); assert.equal(clock.tasks.size, 1);
  clock.advance('2026-11-16T16:05:00Z'); assert.equal(reads, 2);
  refresh.close();
});
