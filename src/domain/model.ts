import { z } from 'zod';
import { version } from '../../package.json';
import {storeCreditSchema} from './store-credit';
import {poundRateMatchesDate,poundRateSchema,purchaseDay} from '../pricing/pound-history';

export const APP_NAME = 'Sarevoc´s CCU Planer';
export const APP_VERSION = version;
export const text = z.string().trim().min(1).max(500);
export const id = z.string().min(1).max(160);
export const insuranceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('lti'), evidence: text }).strict(),
  z.object({ kind: z.literal('months'), months: z.number().int().positive().max(1200), evidence: text }).strict(),
  z.object({ kind: z.literal('unknown'), reason: text }).strict(),
]);
export const moneySchema = z.object({ minor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  currency: z.enum(['USD', 'EUR']), taxBasis: z.enum(['net', 'gross', 'unknown']), evidence: text }).strict();
export const shipSchema = z.object({ childId: id, modelName: text, modelId: id.nullable(),
  identity: z.enum(['unresolved', 'confirmed']), role: z.enum(['upgradeable', 'included', 'loaner', 'unverified']) }).strict();
export const ccuSchema = z.object({ instanceId: id, from: text, to: text,
  status: z.enum(['unused', 'applied', 'unverified']), applicability: z.enum(['confirmed', 'unverified', 'rejected']),
  insurance: insuranceSchema }).strict();
const rsiPurchaseSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('documented'), source: z.enum(['order', 'log']),
    minor: z.number().int().positive().max(100_000_000), currency: z.enum(['USD', 'EUR', 'GBP']),
    purchaseDate: purchaseDay.optional(), poundRate: poundRateSchema.optional() }).strict().refine(record =>
      !record.poundRate || record.currency==='GBP'&&!!record.purchaseDate&&poundRateMatchesDate(record.poundRate,record.purchaseDate)),
  z.object({ status: z.literal('excluded') }).strict(),
]);
export type RsiPurchase = z.infer<typeof rsiPurchaseSchema>;
export const pledgeSchema = z.object({ pledgeId: id, name: text,
  insurance: insuranceSchema, originalDescription: z.string().max(4000), ships: z.array(shipSchema).max(100),
  ccus: z.array(ccuSchema).max(100), protected: z.boolean(), baseReleased: z.boolean(),
  restrictions: z.array(text).max(30), acquisitionCost: moneySchema.nullable(), unknownCostReason: text.nullable(),
  meltValue: moneySchema.nullable(), sourceValues: z.record(z.string().max(100), z.string().max(4000)),
  rsiPurchase: rsiPurchaseSchema.optional(),
}).strict();
export const buybackSchema = z.object({ entryId: id, name: text, description: z.string().max(4000),
  currentPrice: moneySchema.nullable(), availability: z.literal('unverified'),
  insurance: insuranceSchema.optional(), originalShips: z.array(text).max(100).optional() }).strict();
export const buybackObservationSchema = z.object({ observedAt: z.iso.datetime({ offset: true }),
  token: z.enum(['available', 'unavailable', 'unknown']), current: z.boolean() }).strict();
export type Buyback = z.infer<typeof buybackSchema>;
export type BuybackObservation = z.infer<typeof buybackObservationSchema>;
export const scopeSchema = z.object({ kind: z.enum(['full-hangar', 'partial']), exportComplete: z.boolean(),
  expectedPledges: z.number().int().nonnegative().max(50000).nullable(),
  pagesExpected: z.number().int().positive().max(5000).nullable(), pagesRead: z.number().int().nonnegative().max(5000).nullable(),
}).strict();
export const documentSchema = z.object({ type: z.literal('sarevocs-ccu-inventory'), schemaVersion: z.literal(1),
  appVersion: text, createdAt: z.iso.datetime({ offset: true }), dataMode: z.enum(['demo', 'real']),
  account: z.object({ reference: id, identityKind: z.enum(['rsi-handle', 'manual-reference']) }).strict(),
  scope: scopeSchema, pledges: z.array(pledgeSchema).max(50000), buybacks: z.array(buybackSchema).max(50000),
  buybackObservation: buybackObservationSchema.optional(), storeCredit:storeCreditSchema.optional(),
}).strict();
export type Insurance = z.infer<typeof insuranceSchema>;
export type Pledge = z.infer<typeof pledgeSchema>;
export type InventoryDocument = z.infer<typeof documentSchema>;
export type Scope = z.infer<typeof scopeSchema>;
export type Account = { id: string; name: string; mode: 'demo' | 'real'; reference: string | null;
  identityKind: 'rsi-handle' | 'manual-reference' | null; identityStatus: 'unbound' | 'manual-confirmed'; lastComplete: string | null };
export type ImportCandidate = { adapter: string; document: InventoryDocument; digest: string; warnings: string[];
  completeness: 'complete' | 'partial'; evidence: 'file-declared' | 'scope-unverified' };
export type InventoryItem = { pledge: Pledge; availability: 'present' | 'removed'; source: string; importedAt: string };
export type AccountInventory = { account: Account; items: InventoryItem[]; buybacks: z.infer<typeof buybackSchema>[] };
export type Preview = { token: string; accountId: string; adapter: string; dataMode: 'demo' | 'real'; reference: string;
  completeness: 'complete' | 'partial'; evidence: string; warnings: string[]; pledges: Pledge[];
  buybacks: z.infer<typeof buybackSchema>[]; changes: { added: number; changed: number; missing: number; unchanged: number };
  bindingRequired: boolean };
export class UserError extends Error {}
