import type { IncomingAdvice } from './incoming-warbonds';
import type { WarbondStock } from './warbond-offers';

/** A reason is based on verified route/stock facts, never on a missing network response. */
export function incomingWarbondStatus(advice: IncomingAdvice,
  stocks: readonly WarbondStock['state'][], confirmedQuotes: number):
  IncomingAdvice['state'] | 'covered' | 'no-offers' | 'stock-unknown' | 'already-owned' | 'unconfirmed' | null {
  if (advice.state !== 'ready') return advice.state;
  if (confirmedQuotes > 0) return null;
  if (advice.purchaseGaps === 0) return 'covered';
  if (!advice.candidates.length) return 'no-offers';
  if (stocks.length !== advice.candidates.length || stocks.some(state => state === 'unknown')) return 'stock-unknown';
  if (stocks.every(state => state === 'free' || state === 'reserved' || state === 'locked')) return 'already-owned';
  return 'unconfirmed';
}
