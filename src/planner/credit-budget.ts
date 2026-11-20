import { storeCreditSchema, type StoreCredit } from '../domain/store-credit';
import type { z } from 'zod';

export const creditBudgetSchema = storeCreditSchema.pick({ currency: true, minor: true });
export type CreditBudget = z.infer<typeof creditBudgetSchema>;

/** A saved limit is in the currency of the credit ledger, independent of the display currency. */
export function creditBudgetLimit(saved: CreditBudget | null, balance?: StoreCredit): number {
  if (!balance) return 0;
  if (!saved) return balance.minor;
  return saved.currency === balance.currency ? Math.min(saved.minor, balance.minor) : 0;
}
