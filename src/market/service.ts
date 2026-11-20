import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { marketCacheSchema, mergeOffers, parseCatalogue, parseOffers, type MarketCache, type MarketSnapshot, type MarketSource } from './model';
import { DailyRefresh, PUBLIC_REFRESH_SCHEDULE, type RefreshClock } from '../scheduling/daily-refresh';
import {shipValuesSchema,parseShipValues,type ShipValues} from './ship-values';
import {shipImagesSchema,parseShipImages,type ShipImages} from './ship-images';
import type { FairNewsStore } from './fair-news';
import { creditBudgetSchema, type CreditBudget } from '../planner/credit-budget';
import { SHOP_PRICE_MAX_AGE, type ShopPair, type ShopPrice, type ReadShopPrices } from './shop-prices';

export type PublicReader = (source: MarketSource, signal: AbortSignal) => Promise<unknown>;
const EMPTY: MarketCache = { schemaVersion: 1, catalogue: null, offers: null };
const targetsSchema = z.array(z.number().int().positive().max(1_000_000_000).nullable()).length(3);
const budgetFileSchema = z.object({ schemaVersion: z.literal(1), accountId: z.uuid(), budget: creditBudgetSchema }).strict();
export class MarketService {
  private cache: MarketCache = { ...EMPTY };
  private values:ShipValues|null=null;private valuesError:string|null=null;
  private images:ShipImages|null=null;
  private errors: MarketSnapshot['errors'] = { catalogue: null, offers: null };
  private inFlight: Promise<void> | null = null;
  private controller: AbortController | null = null;
  private readonly schedule: DailyRefresh;
  private closed = false;
  private readonly shopController = new AbortController();
  private readonly shop = new Map<string, { startedAt: number; prices: ShopPrice[] }>();
  private shopPending = 0;
  constructor(readonly directory: string, private readonly read: PublicReader, clock?: RefreshClock,
    private readonly fairNews?: FairNewsStore, private readonly readShop?: ReadShopPrices) {
    this.schedule = new DailyRefresh(() => this.refresh(), clock);
    try{this.images=shipImagesSchema.parse(this.load('ship-images-v1.json'));}catch{/* Optional public metadata only; no image bytes or session data. */}
    try{this.values=shipValuesSchema.parse(this.load('ship-values-v1.json'));}catch(e){if(!(e&&typeof e==='object'&&'code'in e&&e.code==='ENOENT'))this.valuesError='Gespeicherte Schiffswerte nicht lesbar.';}
    try { this.cache = marketCacheSchema.parse(this.load('public-v1.json')); }
    catch (e) { if (!(e && typeof e === 'object' && 'code' in e && e.code === 'ENOENT')) this.errors = { catalogue: 'Gespeicherte Marktdaten nicht lesbar.', offers: 'Gespeicherte Marktdaten nicht lesbar.' }; }
  }
  private load(name: string): unknown {
    const file = path.join(this.directory, name), fd = fs.openSync(file, 'r');
    try {
      const size = fs.fstatSync(fd).size; if (size > 8 * 1024 * 1024 || size < 2) throw new Error('CACHE_SIZE');
      const bytes = Buffer.alloc(size), count = fs.readSync(fd, bytes, 0, size, 0);
      if (count !== size || fs.fstatSync(fd).size !== size) throw new Error('CACHE_CHANGED');
      return JSON.parse(bytes.toString('utf8'));
    } finally { fs.closeSync(fd); }
  }
  private write(name: string, value: unknown): void {
    fs.mkdirSync(this.directory, { recursive: true });
    const file = path.join(this.directory, name), temp = file + '.' + randomUUID() + '.tmp';
    try { fs.writeFileSync(temp, JSON.stringify(value), { flag: 'wx' }); fs.renameSync(temp, file); }
    finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
  }
  private offerHistory(): NonNullable<MarketCache['offers']>[] {
    const results: NonNullable<MarketCache['offers']>[] = [];
    const entries = fs.readdirSync(this.directory, { withFileTypes: true })
      .filter(entry => entry.isFile() && /^history-offers-[0-9a-f-]{36}\.json$/i.test(entry.name))
      .map(entry => ({ name: entry.name, stat: fs.lstatSync(path.join(this.directory, entry.name)) }))
      .filter(entry => entry.stat.isFile())
      .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs).slice(0, 64);
    let remaining = 24 * 1024 * 1024;
    for (const { name, stat } of entries) {
      if (stat.size > remaining) continue;
      remaining -= stat.size;
      try {
        const saved = this.load(name) as { schemaVersion?: unknown; offers?: unknown };
        const archive = marketCacheSchema.parse({ ...saved, catalogue: null });
        if (archive.offers) results.push(archive.offers);
      } catch { /* Invalid history files do not count as offer evidence. */ }
    }
    return results;
  }
  snapshot(): MarketSnapshot { return structuredClone({ ...this.cache, fairNews: this.fairNews?.snapshot(this.cache.offers, Date.now(), !!this.errors.offers), images:this.images,values:this.values,valuesError:this.valuesError,
    shopPrices:[...this.shop.values()].flatMap(entry => entry.prices).filter(price => Date.now() - price.checkedAt < SHOP_PRICE_MAX_AGE),
    pending: !!this.inFlight, errors: this.errors, refreshSchedule: PUBLIC_REFRESH_SCHEDULE }); }
  async checkShopPrices(pairs: readonly ShopPair[]) {
    if (this.closed || !this.readShop || this.shopPending >= 2) return;
    const known = new Set(this.cache.catalogue?.ships.map(ship => ship.id));
    this.shopPending++;
    try {
      for (const pair of pairs) {
        if (this.closed) return;
        const key = `${pair.fromId}:${pair.toId}`, now = Date.now();
        if (!known.has(pair.fromId) || !known.has(pair.toId) || now - (this.shop.get(key)?.startedAt ?? 0) < SHOP_PRICE_MAX_AGE) continue;
        this.shop.delete(key);
        if (this.shop.size >= 128) this.shop.delete(this.shop.keys().next().value!);
        const entry = { startedAt: now, prices: [] as ShopPrice[] };
        this.shop.set(key, entry);
        try { entry.prices = await this.readShop(pair, this.shopController.signal); } catch { /* A missing shop quote falls back to the public reference rate. */ }
      }
    } finally { this.shopPending--; }
  }
  markFairNoticeSeen(noticeId: string) { this.fairNews?.markSeen(noticeId); }
  start(): void {
    if (!this.closed) this.schedule.start();
  }
  refresh(): Promise<void> {
    if (this.closed) return Promise.resolve();
    if (this.inFlight) return this.inFlight;
    const controller = this.controller = new AbortController();
    const previousOffers = this.cache.offers;
    const run = async () => {
      const calendar = this.fairNews
        ? Promise.resolve().then(() => this.read('calendar', controller.signal)).catch(() => undefined)
        : Promise.resolve(undefined);
      await Promise.all((['catalogue', 'offers','shipValues'] as const).map(async source => {
        try {
          const raw = await this.read(source, controller.signal);
          if (this.closed || controller.signal.aborted) return;
          const fetchedAt = new Date().toISOString();
          if(source==='shipValues'){const values=parseShipValues(raw,fetchedAt);this.write('ship-values-v1.json',values);this.values=values;this.valuesError=null;return;}
          const next: MarketCache = { ...this.cache };
          if (source === 'catalogue') {next.catalogue = { fetchedAt, ships: parseCatalogue(raw) };try{const images=parseShipImages(raw,next.catalogue.ships,fetchedAt);this.write('ship-images-v1.json',images);this.images=images;}catch{/* Invalid or unwritable optional images never discard valid ship facts. */}}
          else next.offers = mergeOffers(parseOffers(raw, fetchedAt), this.cache.offers);
          if (source === 'offers' && this.cache.offers && next.offers) {
            const signature = (data: NonNullable<MarketCache['offers']>) => JSON.stringify(data.items.map(i => [i.key, i.regularMinor, i.warbondMinor, i.warbond, i.change === 'missing']).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
            if (signature(this.cache.offers) !== signature(next.offers)) this.write(`history-offers-${randomUUID()}.json`, { schemaVersion: 1, offers: this.cache.offers });
          }
          this.write('public-v1.json', marketCacheSchema.parse(next));
          this.cache = next; this.errors[source] = null;
        } catch {
          if(source==='shipValues'){if(!this.closed)this.valuesError='Schiffswerte konnten nicht aktualisiert werden.';return;}
          if (!this.closed) this.errors[source] = 'Aktualisierung fehlgeschlagen. Letzter gültiger Stand bleibt erhalten.';
        }
      }));
      const eventCalendar = await calendar;
      if (!this.closed && !controller.signal.aborted && this.cache.offers) {
        this.fairNews?.record(eventCalendar, previousOffers, this.cache.offers, Date.now(), () => this.offerHistory());
      }
    };
    this.inFlight = run().finally(() => { this.inFlight = null; this.controller = null; });
    return this.inFlight;
  }
  targets(accountId: string): (number | null)[] {
    const id = z.uuid().parse(accountId);
    try { return targetsSchema.parse(this.load(`targets-${id}.json`)); }
    catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return [null, null, null];
      throw new Error('TARGET_PREFERENCES_UNREADABLE');
    }
  }
  setTargets(accountId: string, ids: (number | null)[]): (number | null)[] {
    const id = z.uuid().parse(accountId), selected = targetsSchema.parse(ids);
    if (selected.some(value => value !== null && !this.cache.catalogue?.ships.some(s => s.id === value))) throw new Error('TARGET_NOT_IN_CATALOGUE');
    const nonEmpty = selected.filter(x => x !== null); if (new Set(nonEmpty).size !== nonEmpty.length) throw new Error('DUPLICATE_TARGET');
    this.write(`targets-${id}.json`, selected); return selected;
  }
  creditBudget(accountId: string, update?: CreditBudget): CreditBudget | null {
    const id = z.uuid().parse(accountId);
    const name = `credit-budget-${id}.json`;
    let saved: CreditBudget | null = null;
    try {
      const record = budgetFileSchema.parse(this.load(name));
      if (record.accountId !== id) throw new Error('BUDGET_PROFILE');
      saved = record.budget;
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw new Error('CREDIT_BUDGET_UNREADABLE');
    }
    if (update === undefined) return saved;
    const next = budgetFileSchema.parse({ schemaVersion: 1, accountId: id, budget: update });
    if (!saved || next.budget.minor !== saved.minor || next.budget.currency !== saved.currency) this.write(name, next);
    return next.budget;
  }
  close(): void { this.closed = true; this.schedule.close(); this.controller?.abort(); this.shopController.abort(); }
}
