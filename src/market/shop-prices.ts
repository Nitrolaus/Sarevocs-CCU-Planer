import { z } from 'zod';
import type { ChainStep } from '../planner/chain';

const id = z.number().int().positive().max(1_000_000_000);
const cents = z.number().int().positive().max(100_000_000);
export const shopPairSchema = z.object({ fromId: id, toId: id }).strict().refine(pair => pair.fromId !== pair.toId);
export type ShopPair = z.infer<typeof shopPairSchema>;
export type ShopEdition = 'standard' | 'warbond';
export type ShopAmount = { minor: number; currency: 'USD' | 'EUR'; taxMode: 'gross' | 'net'; vatBasisPoints: number };
export const shopPriceSchema = z.object({ fromId: id, toId: id, edition: z.enum(['standard', 'warbond']),
  amount: z.object({ minor: cents, currency: z.enum(['USD', 'EUR']), taxMode: z.enum(['gross', 'net']),
    vatBasisPoints: z.number().int().min(0).max(10_000) }).strict(),
  checkedAt: z.number().int().nonnegative().max(8.64e15),
}).strict().refine(price => price.fromId !== price.toId);
export type ShopPrice = z.infer<typeof shopPriceSchema>;
export type ReadShopPrices = (pair: ShopPair, signal: AbortSignal) => Promise<ShopPrice[]>;
export const SHOP_PRICE_MAX_AGE = 5 * 60_000;
const SHOP_QUERY_RETRY_DELAY = 2_000;
export const MAX_SHOP_PAIRS = 24;
export const shopPairKey = ({ fromId, toId }: ShopPair) => `${fromId}:${toId}`;

export function shopPairForStep(step: ChainStep): ShopPair | null {
  if (step.validity === 'invalid' || !step.from.catalogueConfirmed || !step.to.catalogueConfirmed) return null;
  const from = /^matrix:([1-9]\d{0,9})$/.exec(step.from.key);
  const to = /^matrix:([1-9]\d{0,9})$/.exec(step.to.key);
  if (!from || !to) return null;
  const pair = shopPairSchema.safeParse({ fromId: Number(from[1]), toId: Number(to[1]) });
  return pair.success ? pair.data : null;
}

export function shopPairs(steps: readonly ChainStep[]): ShopPair[] {
  const pairs = new Map<string, ShopPair>();
  for (const step of steps) {
    if (step.kind !== 'purchase') continue;
    const pair = shopPairForStep(step);
    if (pair) pairs.set(shopPairKey(pair), pair);
    if (pairs.size === MAX_SHOP_PAIRS) break;
  }
  return [...pairs.values()];
}

const sku = z.object({ id, title: z.string().max(160), upgradePrice: z.number().int().min(0).max(100_000_000).nullable(), available: z.boolean(),
  unlimitedStock: z.boolean(), availableStock: z.number().int().nonnegative().nullable() });
const details = z.array(z.object({ data: z.object({ ship: z.object({ id, skus: z.array(sku).max(32) }).nullable() }),
  errors: z.array(z.unknown()).max(0).optional() })).length(1);
const price = z.array(z.object({ data: z.object({ app: z.object({ pricing: z.object({
  currencyCode: z.enum(['EUR', 'USD']), exponent: z.literal(2), taxRate: z.number().int().min(0).max(10_000),
  isTaxInclusive: z.boolean(),
}) }), price: z.object({ amount: cents }) }), errors: z.array(z.unknown()).max(0).optional() })).length(1);

type GraphRequest = (body: string, signal: AbortSignal) => Promise<unknown>;

function waitForShopRetry(signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    const timer = setTimeout(finish, SHOP_QUERY_RETRY_DELAY);
    function finish() {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    }
    signal.addEventListener('abort', finish, { once: true });
  });
}

/** Both fixed queries are the read operations used by RSI's Upgrade dialog. */
export function shopPriceReader(read: GraphRequest): ReadShopPrices {
  return async (pair, signal) => {
    const { fromId, toId } = shopPairSchema.parse(pair);
    const request = async <T>(schema: z.ZodType<T>, operationName: string, query: string, variables: Record<string, number>) => {
      const body = JSON.stringify([{ operationName, query, variables }]);
      const load = async () => schema.parse(await read(body, signal));
      signal.throwIfAborted();
      try { return await load(); }
      catch {
        signal.throwIfAborted();
        await waitForShopRetry(signal);
        signal.throwIfAborted();
        return load();
      }
    };
    const result = await request(details, 'getShipDetails',
      'query getShipDetails($id: Int!, $fromShipId: Int) { ship(id: $id, from: $fromShipId) { id skus { id title upgradePrice available unlimitedStock availableStock } } }',
      { id: toId, fromShipId: fromId });
    const target = result[0]!.data.ship;
    if (target?.id !== toId || signal.aborted) return [];
    const checked: ShopPrice[] = [];
    for (const [edition, title] of [['standard', 'Standard Edition'], ['warbond', 'Warbond Edition']] as const) {
      const offers = target.skus.filter(row => row.title === title && row.available && (row.upgradePrice ?? 0) > 0 &&
        (row.unlimitedStock || (row.availableStock ?? 0) > 0));
      if (offers.length !== 1 || signal.aborted) continue;
      const reply = await request(price, 'getPrice',
        'query getPrice($from: Int!, $to: Int!) { app { pricing { currencyCode exponent taxRate isTaxInclusive } } price(from: $from, to: $to) { amount } }',
        { from: fromId, to: offers[0]!.id }).catch(() => null);
      if (!reply || signal.aborted) continue;
      const { app, price: value } = reply[0]!.data;
      checked.push({ fromId, toId, edition, checkedAt: Date.now(), amount: { minor: value.amount,
        currency: app.pricing.currencyCode, taxMode: app.pricing.isTaxInclusive ? 'gross' : 'net', vatBasisPoints: app.pricing.taxRate } });
    }
    return checked;
  };
}
