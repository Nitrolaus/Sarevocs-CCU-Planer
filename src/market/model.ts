import { z } from 'zod';
import { safeRsiShipUrl } from './ship-link';
import {SHIP_VALUES_URL,type ShipValues} from './ship-values';
import type {ShipImages} from './ship-images';
import type { FairNews } from './fair-news';
import type { ShopPrice } from './shop-prices';

export const MARKET_SOURCES = {
  catalogue: 'https://robertsspaceindustries.com/ship-matrix/index',
  shipValues: SHIP_VALUES_URL,
  offers: 'https://app.openhangar.space/api/store/catalog',
  calendar: 'https://app.openhangar.space/api/hangar/calendar',
  fx: 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml',
  loaners: 'https://support.robertsspaceindustries.com/api/v2/help_center/en-us/articles/360003093114.json',
  included: 'https://support.robertsspaceindustries.com/api/v2/help_center/en-us/articles/4408770370455.json',
} as const;
export type MarketSource = keyof typeof MARKET_SOURCES;
const label = z.string().trim().min(1).max(240);
const id = z.number().int().positive().max(1_000_000_000);
const at = z.iso.datetime({ offset: true });
const minor = z.number().int().nonnegative().max(100_000_000);
export const catalogueShipSchema = z.object({ id, name: label, chassisId: id.nullable(), manufacturer: label,
  manufacturerCode: label, status: label, focus: z.string().max(240), length: z.number().nonnegative().max(10000).nullable(),
  storeUrl: z.string().refine(value => safeRsiShipUrl(value) === value).nullable().optional() }).strict();
export type CatalogueShip = z.infer<typeof catalogueShipSchema>;
export const targetOfferSchema = z.object({ key: label, name: label, targetName: label, toShipId: id, toSkuId: id,
  regularMinor: minor, warbondMinor: minor.nullable(), warbond: z.boolean(), currency: z.literal('USD'), taxBasis: z.literal('net'),
  verification: z.literal('target-observation'), firstSeenAt: at, lastSeenAt: at,
  change: z.enum(['new', 'changed', 'current', 'missing']), previousRegularMinor: minor.nullable(), previousWarbondMinor: minor.nullable() }).strict();
export type TargetOffer = z.infer<typeof targetOfferSchema>;
export const marketCacheSchema = z.object({ schemaVersion: z.literal(1),
  catalogue: z.object({ fetchedAt: at, ships: z.array(catalogueShipSchema).min(1).max(2000) }).strict().nullable(),
  offers: z.object({ fetchedAt: at, sourceAt: at, checkedAt: at.nullable(), items: z.array(targetOfferSchema).min(1).max(2000) }).strict().nullable(),
}).strict();
export type MarketCache = z.infer<typeof marketCacheSchema>;
export type MarketSnapshot = MarketCache & { fairNews?: FairNews; images?:ShipImages|null;values?:ShipValues|null;valuesError?:string|null;shopPrices?:ShopPrice[]; lastShopPrices?:ShopPrice[]; pending: boolean; errors: Record<'catalogue' | 'offers', string | null>; refreshSchedule: { hour: number; timeZone: string } };

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('SOURCE_FORMAT');
  return value as Record<string, unknown>;
}
function sourceId(value: unknown): number { return id.parse(typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value); }
function optionalText(value: unknown, fallback: string): string { return typeof value === 'string' && value.trim() ? label.parse(value) : fallback; }
export function parseCatalogue(value: unknown): CatalogueShip[] {
  const root = record(value);
  if (root.success !== 1 && root.success !== true) throw new Error('SOURCE_FAILED');
  if (!Array.isArray(root.data) || root.data.length < 1 || root.data.length > 2000) throw new Error('SOURCE_FORMAT');
  const ships = root.data.map(raw => {
    const row = record(raw), maker = record(row.manufacturer);
    const length = typeof row.length === 'number' ? row.length : typeof row.length === 'string' && /^\d+(?:\.\d+)?$/.test(row.length) ? Number(row.length) : null;
    return catalogueShipSchema.parse({ id: sourceId(row.id), name: label.parse(row.name), chassisId: row.chassis_id == null ? null : sourceId(row.chassis_id),
      manufacturer: optionalText(maker.name, 'Hersteller ungeklärt'), manufacturerCode: optionalText(maker.code, 'Ungeklärt'),
      status: optionalText(row.production_status, 'Ungeklärt'), focus: typeof row.focus === 'string' ? row.focus.slice(0, 240) : '', length, storeUrl: safeRsiShipUrl(row.url) });
  });
  if (new Set(ships.map(s => s.id)).size !== ships.length) throw new Error('DUPLICATE_ID');
  return ships.sort((a, b) => a.name.localeCompare(b.name, 'de'));
}
function sourceTime(value: unknown): string {
  const time = typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : NaN;
  if (!Number.isFinite(time) || time < Date.UTC(2000, 0, 1) || time > Date.now() + 5 * 60 * 1000) throw new Error('SOURCE_TIME');
  return new Date(time).toISOString();
}
function dollars(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || Math.abs(value * 100 - Math.round(value * 100)) > 0.00001) throw new Error('SOURCE_PRICE');
  return minor.parse(Math.round(value * 100));
}
export function parseOffers(value: unknown, fetchedAt: string): NonNullable<MarketCache['offers']> {
  const root = record(value);
  if (!Array.isArray(root.items) || root.items.length < 1 || root.items.length > 20000) throw new Error('SOURCE_FORMAT');
  if ((root.currency != null && root.currency !== 'USD') || (root.currencyCode != null && root.currencyCode !== 'USD')) throw new Error('SOURCE_CURRENCY');
  const sourceAt = sourceTime(root.at), checkedAt = root.checkedAt == null ? null : sourceTime(root.checkedAt);
  const items = root.items.filter(raw => record(raw).k === 'ccus').map(raw => {
    const row = record(raw), name = label.parse(row.n);
    if (!name.startsWith('Upgrade to ') || typeof row.wb !== 'boolean') throw new Error('SOURCE_FORMAT');
    const toShipId = sourceId(row.toShipId), toSkuId = sourceId(row.toSkuId);
    const warbond = row.wbu == null ? null : record(row.wbu);
    if (warbond?.p != null && dollars(warbond.p) > dollars(row.p)) throw new Error('SOURCE_PRICE');
    return targetOfferSchema.parse({ key: `openh:${toShipId}:${toSkuId}`, name, targetName: name.slice(11).trim(), toShipId, toSkuId,
      regularMinor: dollars(row.p), warbondMinor: warbond?.p == null ? null : dollars(warbond.p), warbond: row.wb,
      currency: 'USD', taxBasis: 'net', verification: 'target-observation', firstSeenAt: fetchedAt, lastSeenAt: fetchedAt,
      change: 'new', previousRegularMinor: null, previousWarbondMinor: null });
  });
  if (!items.length || items.length > 1000 || new Set(items.map(o => o.key)).size !== items.length) throw new Error('SOURCE_FORMAT');
  return { fetchedAt, sourceAt, checkedAt, items };
}
export function mergeOffers(next: NonNullable<MarketCache['offers']>, previous: MarketCache['offers']): NonNullable<MarketCache['offers']> {
  if (!previous) return next;
  if (Date.parse(next.sourceAt) < Date.parse(previous.sourceAt)) throw new Error('SOURCE_OLDER');
  const old = new Map(previous.items.map(o => [o.key, o])), keys = new Set(next.items.map(o => o.key));
  const items = next.items.map(row => {
    const prior = old.get(row.key);
    if (!prior) return row;
    // A SKU changing identity is not a safe update to the same observation.
    if (prior.toShipId !== row.toShipId || prior.targetName !== row.targetName) throw new Error('SOURCE_IDENTITY');
    const changed = prior.regularMinor !== row.regularMinor || prior.warbondMinor !== row.warbondMinor || prior.warbond !== row.warbond;
    return { ...row, firstSeenAt: prior.firstSeenAt, change: changed ? 'changed' as const : prior.change === 'missing' ? 'new' as const : 'current' as const,
      previousRegularMinor: changed ? prior.regularMinor : prior.previousRegularMinor, previousWarbondMinor: changed ? prior.warbondMinor : prior.previousWarbondMinor };
  });
  for (const prior of previous.items) if (!keys.has(prior.key) && items.length < 2000) items.push({ ...prior, change: 'missing' });
  return { ...next, items };
}
export function matchingOffer(ship: CatalogueShip, offers: TargetOffer[]): TargetOffer | undefined {
  // Shop IDs and matrix IDs are never joined by number alone or fuzzy model-name similarity.
  return offers.find(o => o.change !== 'missing' && o.toShipId === ship.id && o.targetName === ship.name);
}
export function offersAreStale(snapshot: MarketSnapshot, now = Date.now()): boolean {
  return !!snapshot.errors.offers || !snapshot.offers || now - Date.parse(snapshot.offers.sourceAt) > 6 * 60 * 60 * 1000;
}
