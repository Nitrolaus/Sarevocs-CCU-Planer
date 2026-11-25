import { z } from 'zod';
import { rsiPurchaseSchema } from './model';

export const MAX_UPGRADE_HISTORY_STEPS = 128;
export const MAX_UPGRADE_HISTORY_NAME = 200;
const ccuPledgeId = z.string().regex(/^[1-9]\d{0,19}$/);
const historyName = z.string().trim().min(1).max(MAX_UPGRADE_HISTORY_NAME).refine(value => !/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(value));
const historyTime = z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/).refine(value => {
  const [year, month, day, hour, minute] = value.split(/[- :]/).map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  return year! >= 1900 && hour! >= 0 && hour! < 24 && minute! >= 0 && minute! < 60 &&
    date.getUTCFullYear() === year && date.getUTCMonth() === month! - 1 && date.getUTCDate() === day;
});
export const upgradeHistoryStepSchema = z.object({
  from: historyName,
  to: historyName,
  ccuPledgeId: ccuPledgeId.optional(),
  // RSI's displayed local time; no timezone or UTC conversion is inferred.
  appliedAt: historyTime.nullable(),
}).strict();
export type UpgradeHistoryStep = z.infer<typeof upgradeHistoryStepSchema>;
export const upgradeHistoryResultSchema = z.object({
  status: z.enum(['loaded', 'unavailable', 'auth-required', 'cancelled']),
  steps: z.array(upgradeHistoryStepSchema).max(MAX_UPGRADE_HISTORY_STEPS),
  partial: z.boolean(),
  confirmedEmpty: z.literal(true).optional(),
  purchases: z.array(z.object({ ccuPledgeId, price: rsiPurchaseSchema }).strict()).max(MAX_UPGRADE_HISTORY_STEPS).optional(),
}).strict().refine(value => value.status === 'loaded' || (value.steps.length === 0 && value.partial === false && !value.purchases))
  .refine(value => !value.confirmedEmpty || (value.status === 'loaded' && !value.partial && !value.steps.length && !value.purchases?.length));
export type UpgradeHistoryResult = z.infer<typeof upgradeHistoryResultSchema>;
export type PurchaseHistoryBatch = {
  histories: Record<string, UpgradeHistoryResult>;
  basePurchases: Record<string, z.infer<typeof rsiPurchaseSchema>>;
};

export const verifiedUpgradePurchasesSchema = upgradeHistoryResultSchema.refine(result => {
  if (result.confirmedEmpty) return true;
  if (result.status !== 'loaded' || result.partial || !result.steps.length || result.purchases?.length !== result.steps.length) return false;
  const ids = new Set(result.steps.filter(step => step.appliedAt).map(step => step.ccuPledgeId));
  if (ids.has(undefined) || ids.size !== result.steps.length) return false;
  return result.purchases.every(({ ccuPledgeId: id, price }) => ids.delete(id) && price.status === 'documented' && price.source === 'order');
});

export const upgradeHistoryRequestSchema = z.object({
  accountId: z.uuid(), pledgeId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), revisionKey: z.uuid(),
}).strict();

export function unavailableHistory(status: Exclude<UpgradeHistoryResult['status'], 'loaded'>): UpgradeHistoryResult {
  return { status, steps: [], partial: false };
}
