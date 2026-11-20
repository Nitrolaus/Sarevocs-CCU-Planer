import { z } from 'zod';

export const MAX_UPGRADE_HISTORY_STEPS = 128;
export const MAX_UPGRADE_HISTORY_NAME = 200;
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
  // RSI's displayed local time; no timezone or UTC conversion is inferred.
  appliedAt: historyTime.nullable(),
}).strict();
export type UpgradeHistoryStep = z.infer<typeof upgradeHistoryStepSchema>;
export const upgradeHistoryResultSchema = z.object({
  status: z.enum(['loaded', 'unavailable', 'auth-required', 'cancelled']),
  steps: z.array(upgradeHistoryStepSchema).max(MAX_UPGRADE_HISTORY_STEPS),
  partial: z.boolean(),
}).strict().refine(value => value.status === 'loaded' || (value.steps.length === 0 && value.partial === false));
export type UpgradeHistoryResult = z.infer<typeof upgradeHistoryResultSchema>;

export const upgradeHistoryRequestSchema = z.object({
  accountId: z.uuid(), pledgeId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), revisionKey: z.uuid(),
}).strict();

export function unavailableHistory(status: Exclude<UpgradeHistoryResult['status'], 'loaded'>): UpgradeHistoryResult {
  return { status, steps: [], partial: false };
}
