import { z } from 'zod';

export const purchaseDay = z.iso.date();
const rate = z.number().int().min(100_000).max(10_000_000);
export const poundRateSchema = z.object({
  sourceDate: purchaseDay, gbpPerEurMicros: rate, usdPerEurMicros: rate,
}).strict();
export type PoundRate = z.infer<typeof poundRateSchema>;

const ONE_DAY = 86_400_000;
const MAX_GAP_DAYS = 4;
export const MAX_POUND_HISTORY_BYTES = 12 * 1024 * 1024;
const time = (day: string) => Date.parse(day + 'T00:00:00Z');
export function poundRateMatchesDate(value: PoundRate, purchaseDate: string) {
  const gap = time(purchaseDate) - time(value.sourceDate);
  return gap >= 0 && gap <= MAX_GAP_DAYS * ONE_DAY;
}

/** Fixed ECB history feed. Parse only its dated Cube rows, without expanding XML entities. */
export function parsePoundHistory(xml: unknown, now = Date.now()): Map<string, PoundRate> {
  if (typeof xml !== 'string' || xml.length > MAX_POUND_HISTORY_BYTES || /<!DOCTYPE|<!ENTITY|&/i.test(xml) ||
      !/<gesmes:Envelope\b/.test(xml) || !/<\/gesmes:Envelope>\s*$/.test(xml)) throw Error('ECB_HISTORY_FORMAT');
  const rows = new Map<string, PoundRate>();
  for (const day of xml.matchAll(/<Cube\s+time=(['"])(\d{4}-\d{2}-\d{2})\1\s*>([\s\S]*?)<\/Cube>/g)) {
    const sourceDate = day[2]!;
    if (time(sourceDate) > now || rows.has(sourceDate)) throw Error('ECB_HISTORY_DATE');
    const values = new Map<string, number>();
    for (const entry of day[3]!.matchAll(/<Cube\s+currency=(['"])(GBP|USD)\1\s+rate=(['"])(\d{1,2}(?:\.\d{1,6})?)\3\s*\/>/g)) {
      if (values.has(entry[2]!)) throw Error('ECB_HISTORY_RATE');
      values.set(entry[2]!,Math.round(Number(entry[4]) * 1_000_000));
    }
    rows.set(sourceDate,poundRateSchema.parse({sourceDate,gbpPerEurMicros:values.get('GBP'),usdPerEurMicros:values.get('USD')}));
  }
  if (!rows.size) throw Error('ECB_HISTORY_EMPTY');
  return rows;
}

export function poundRateFor(history: ReadonlyMap<string, PoundRate>, purchaseDate: string): PoundRate | undefined {
  const day = time(purchaseDate);
  if (!Number.isFinite(day)) return undefined;
  for (let offset=0; offset<=MAX_GAP_DAYS; offset++) {
    const rate=history.get(new Date(day-offset*ONE_DAY).toISOString().slice(0,10));
    if(rate)return rate;
  }
}

export function historicalPoundMinor(minor:number, currency:'EUR'|'USD', rate:PoundRate):number {
  const numerator=BigInt(minor)*BigInt(currency==='EUR'?1_000_000:rate.usdPerEurMicros);
  const denominator=BigInt(rate.gbpPerEurMicros);
  return Number((2n*numerator+denominator)/(2n*denominator));
}
