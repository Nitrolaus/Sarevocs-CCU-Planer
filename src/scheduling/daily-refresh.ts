export const PUBLIC_REFRESH_SCHEDULE = { hour: 17, minute: 5, timeZone: 'Europe/Berlin' } as const;
const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: PUBLIC_REFRESH_SCHEDULE.timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
function parts(time: number) {
  const p = new Map(formatter.formatToParts(new Date(time)).map(x => [x.type, Number(x.value)]));
  return { year: p.get('year')!, month: p.get('month')!, day: p.get('day')!, hour: p.get('hour')!, minute: p.get('minute')!, second: p.get('second')! };
}
function berlinAt17(year: number, month: number, day: number): number {
  const wall = Date.UTC(year, month - 1, day, PUBLIC_REFRESH_SCHEDULE.hour, PUBLIC_REFRESH_SCHEDULE.minute); let utc = wall;
  for (let i = 0; i < 3; i++) { const p = parts(utc); utc += wall - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second); }
  return utc;
}
export function nextPublicRefresh(now: number): number {
  const p = parts(now), today = berlinAt17(p.year, p.month, p.day);
  return today > now ? today : berlinAt17(p.year, p.month, p.day + 1);
}
export type RefreshClock = { now(): number; arm(callback: () => void, delayMs: number): () => void };
const systemClock: RefreshClock = { now: () => Date.now(), arm(callback, delay) { const timer = setTimeout(callback, delay); timer.unref?.(); return () => clearTimeout(timer); } };
/** One startup check, then calendar deadlines; no periodic network polling or persistent OS task. */
export class DailyRefresh {
  private started = false; private closed = false; private cancel: (() => void) | null = null;
  constructor(private readonly refresh: () => Promise<unknown>, private readonly clock: RefreshClock = systemClock) {}
  start(): void { if (this.started || this.closed) return; this.started = true; this.invoke(); this.armNext(); }
  private invoke(): void { try { void Promise.resolve(this.refresh()).catch(() => {}); } catch { /* Service keeps its last valid data. */ } }
  private armNext(): void {
    if (this.closed) return;
    const due = nextPublicRefresh(this.clock.now());
    this.cancel = this.clock.arm(() => { this.cancel = null; if (this.closed) return; if (this.clock.now() >= due) this.invoke(); this.armNext(); }, Math.max(1, due - this.clock.now()));
  }
  close(): void { this.closed = true; this.cancel?.(); this.cancel = null; }
}
