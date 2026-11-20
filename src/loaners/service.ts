import fs from 'node:fs';import path from 'node:path';import { randomUUID } from 'node:crypto';
import { DailyRefresh, type RefreshClock } from '../scheduling/daily-refresh';
import type { PublicReader } from '../market/service';
import { loanerCacheSchema, parseLoanerArticle, type LoanerCache, type LoanerSnapshot } from './model';

export class LoanerService {
  private data: LoanerCache | null = null; private error = false; private closed = false;
  private inFlight: Promise<void> | null = null; private controller: AbortController | null = null;
  private readonly schedule: DailyRefresh;
  constructor(readonly directory: string, private readonly read: PublicReader, clock?: RefreshClock) {
    this.schedule = new DailyRefresh(() => this.refresh(), clock);
    try { const file = path.join(directory, 'loaners-v1.json'), stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 512 * 1024) throw Error('LOANER_CACHE');
      this.data = loanerCacheSchema.parse(JSON.parse(fs.readFileSync(file, 'utf8')));
    } catch (e) { this.error = !(e && typeof e === 'object' && 'code' in e && e.code === 'ENOENT'); }
  }
  snapshot(): LoanerSnapshot { return structuredClone({ data: this.data, pending: !!this.inFlight, error: this.error }); }
  start(): void { if (!this.closed) this.schedule.start(); }
  refresh(): Promise<void> {
    if (this.closed) return Promise.resolve(); if (this.inFlight) return this.inFlight;
    const controller = this.controller = new AbortController();
    const run = async () => { let temp: string | undefined;
      try {
        const [matrix, included] = await Promise.all([this.read('loaners', controller.signal), this.read('included', controller.signal)]);
        if (this.closed || controller.signal.aborted) return;
        const next = loanerCacheSchema.parse({ schemaVersion: 1, loaners: parseLoanerArticle('loaners', matrix), included: parseLoanerArticle('included', included) });
        if (this.data && (Date.parse(next.loaners.updatedAt) < Date.parse(this.data.loaners.updatedAt) || Date.parse(next.included.updatedAt) < Date.parse(this.data.included.updatedAt))) throw Error('LOANER_SOURCE_OLDER');
        fs.mkdirSync(this.directory, { recursive: true }); temp = path.join(this.directory, 'loaners-' + randomUUID() + '.tmp');
        fs.writeFileSync(temp, JSON.stringify(next), { flag: 'wx' }); fs.renameSync(temp, path.join(this.directory, 'loaners-v1.json')); temp = undefined;
        this.data = next; this.error = false;
      } catch { controller.abort(); if (!this.closed) this.error = true; }
      finally { if (temp && fs.existsSync(temp)) fs.unlinkSync(temp); }
    };
    this.inFlight = run().finally(() => { this.inFlight = null; this.controller = null; }); return this.inFlight;
  }
  close(): void { this.closed = true; this.schedule.close(); this.controller?.abort(); }
}
