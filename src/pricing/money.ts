import { z } from 'zod';
import type { ShopAmount } from '../market/shop-prices';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const time = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
});
export const euroRateSchema = z.object({
  source: z.literal('ECB'), sourceDate: date,
  usdPerEurMicros: z.number().int().min(100_000).max(10_000_000),
  fetchedAt: z.iso.datetime({ offset: true }),
}).strict();
export type EuroRate = z.infer<typeof euroRateSchema>;
export const shopRateSchema = z.object({
  eurPerUsdMicros: z.number().int().min(100_000).max(10_000_000),
  observedOn: date.refine(value => {
    const now = new Date();
    const today = [String(now.getFullYear()).padStart(4, '0'), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
    return value <= today;
  }),
}).strict();
export type ShopRate = z.infer<typeof shopRateSchema>;
export type PricePreferences = { currency: 'EUR' | 'USD'; taxMode: 'net' | 'gross'; vatBasisPoints: number };
type Currency = PricePreferences['currency'];

/** Read only the bounded ECB daily Cube structure; never expand XML entities. */
export function parseEcbRate(xml: unknown, fetchedAt = new Date().toISOString()): EuroRate {
  if (typeof xml !== 'string' || xml.length > 65_536 || /<!DOCTYPE|<!ENTITY|&/i.test(xml) ||
      !/<gesmes:Envelope\b/.test(xml) || !/<\/gesmes:Envelope>\s*$/.test(xml)) throw new Error('ECB_FORMAT');
  const attributes = (tag: string): Record<string, string> => {
    const result: Record<string, string> = Object.create(null);
    let rest = tag.replace(/^<Cube\b/, '').replace(/\/?\s*>$/, '');
    while (rest.trim()) {
      const match = /^\s+([a-zA-Z]+)\s*=\s*(['"])([^'"<>]*)\2/.exec(rest);
      if (!match || Object.hasOwn(result, match[1]!)) throw new Error('ECB_ATTRIBUTES');
      result[match[1]!] = match[3]!; rest = rest.slice(match[0].length);
    }
    return result;
  };
  const tags = [...xml.matchAll(/<Cube\b[^>]*>/g)].map(match => attributes(match[0]));
  const days = tags.filter(tag => Object.hasOwn(tag, 'time'));
  const dollars = tags.filter(tag => tag.currency === 'USD');
  if (days.length !== 1 || dollars.length !== 1 || Object.keys(days[0]!).length !== 1 ||
      Object.keys(dollars[0]!).sort().join(',') !== 'currency,rate') throw new Error('ECB_FORMAT');
  const sourceDate = date.parse(days[0]!.time), value = dollars[0]!.rate!;
  if (!/^\d{1,2}\.\d{1,6}$/.test(value)) throw new Error('ECB_RATE');
  const [whole, fraction] = value.split('.');
  const usdPerEurMicros = Number(whole) * 1_000_000 + Number(fraction!.padEnd(6, '0'));
  const result = euroRateSchema.parse({ source: 'ECB', sourceDate, usdPerEurMicros, fetchedAt });
  if (Date.parse(sourceDate + 'T00:00:00Z') > Date.parse(fetchedAt)) throw new Error('ECB_FUTURE');
  return result;
}

export function euroRateIsStale(rate: EuroRate, now = Date.now()): boolean {
  const age = now - Date.parse(rate.sourceDate + 'T00:00:00Z');
  return age < -24 * 60 * 60 * 1000 || age > 7 * 24 * 60 * 60 * 1000;
}

function validatePrice(amount: number, preferences: PricePreferences) {
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > 100_000_000 ||
      !['EUR', 'USD'].includes(preferences.currency) || !['net', 'gross'].includes(preferences.taxMode) ||
      !Number.isSafeInteger(preferences.vatBasisPoints) || preferences.vatBasisPoints < 0 || preferences.vatBasisPoints > 10_000) throw new Error('PRICE_INPUT');
}

// Retain the exact ratio until the displayed or debited amount is rounded.
function currencyRatio(from: Currency, to: Currency, rate: EuroRate | null) {
  if (from === to) return { numerator: 1n, denominator: 1n };
  if (!rate) return null;
  const euro = 1_000_000n, dollar = BigInt(euroRateSchema.parse(rate).usdPerEurMicros);
  return from === 'USD' ? { numerator: euro, denominator: dollar } : { numerator: dollar, denominator: euro };
}

const roundMinor = (n: bigint, d: bigint) => Number((2n * n + d) / (2n * d));
const taxFactor = (prefs: PricePreferences) => BigInt(prefs.taxMode === 'gross' ? 10_000 + prefs.vatBasisPoints : 10_000);

function estimate(amount: number | null | undefined, prefs: PricePreferences, rate: EuroRate | null) {
  if (amount == null) return null;
  validatePrice(amount, prefs);
  const ratio = currencyRatio('USD', prefs.currency, rate);
  return ratio ? roundMinor(BigInt(amount) * ratio.numerator * taxFactor(prefs), ratio.denominator * 10_000n) : null;
}

/** Conventional ECB conversion, including for existing receipts and inventory. */
export function estimateMinor(usdMinor: number | null | undefined, preferences: PricePreferences, rate: EuroRate | null) {
  return estimate(usdMinor, preferences, rate);
}

/** Current planning prices, rounded once per line after FX and tax. */
export function estimatePlanningMinor(usdMinor: number | null | undefined, preferences: PricePreferences, rate: EuroRate | null, shop?: ShopAmount) {
  if (matchesShopAmount(preferences, shop)) return shop.minor;
  return estimate(usdMinor, preferences, rate);
}

export function matchesShopAmount(preferences: PricePreferences, shop?: ShopAmount): shop is ShopAmount {
  return !!shop && preferences.currency === shop.currency && preferences.taxMode === shop.taxMode &&
    (shop.taxMode === 'net' || preferences.vatBasisPoints === shop.vatBasisPoints);
}

/** Debit real credit cents in their ledger currency, then tax only the cash remainder. */
export function planPayment(amount: number, source: Currency, settings: PricePreferences, rate: EuroRate | null,
  creditCurrency: Currency, available: number) {
  validatePrice(amount, settings);
  const cashRatio = currencyRatio(source, settings.currency, rate);
  if (!cashRatio) return { cash: null, credit: null };
  const creditRatio = available > 0 ? currencyRatio(source, creditCurrency, rate) : null;
  let unpaid = BigInt(amount), divisor = 1n, credit = 0;
  if (creditRatio) {
    const netInCredit = unpaid * creditRatio.numerator;
    const fullCredit = roundMinor(netInCredit, creditRatio.denominator);
    credit = Math.min(available, fullCredit);
    if (credit > 0) {
      if (credit === fullCredit) return { cash: 0, credit };
      unpaid = netInCredit - BigInt(credit) * creditRatio.denominator;
      divisor = creditRatio.numerator;
    }
  }
  const cash = roundMinor(unpaid * cashRatio.numerator * taxFactor(settings), divisor * cashRatio.denominator * 10_000n);
  return { cash, credit };
}

export function formatMinor(value: number, currency: 'EUR' | 'USD', language: 'de' | 'en' = 'de'): string {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('PRICE_VALUE');
  return new Intl.NumberFormat(language === 'de' ? 'de-DE' : 'en-US', { style: 'currency', currency }).format(value / 100);
}
