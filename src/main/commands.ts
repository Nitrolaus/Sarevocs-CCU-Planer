import { z } from 'zod';
import { shopPairSchema, MAX_SHOP_PAIRS } from '../market/shop-prices';
import { displaySettingsSchema } from '../pricing/model';
import {tableWidthKeySchema,tableWidthCounts,tableWidthsSchema} from '../ui/table-width-model';
import {loanerDecisionSchema,loanerReviewKeySchema} from '../loaners/review-model';
import {draftSchema,draftBatchSchema,targetIdSchema} from '../planner/draft';
import {priorityOrderSchema} from '../planner/reservations';
import {ccuResourceKeySchema} from '../planner/exclusions';
import {reportKindSchema,reportChainSchema,reportSelectionSchema,reportFiltersSchema} from '../export/model';
import {fairNoticeIdSchema} from '../market/fair-news';
import { rsiHelpTopicSchema } from './rsi-help';
import { helpDocumentSchema, helpResourceSchema } from './help-resources';
import { releaseTagSchema } from './release-updates';
import { creditBudgetSchema } from '../planner/credit-budget';
import { giveawayEditSchema } from '../storage/giveaway-origins';
import { packageShareEditSchema } from '../planner/package-shares';
export const commandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('state') }).strict(),
  z.object({ action: z.literal('help.openRsi'), topic: rsiHelpTopicSchema }).strict(),
  z.object({ action: z.literal('help.openResource'), resource: helpResourceSchema }).strict(),
  z.object({ action: z.literal('help.readDocument'), document: helpDocumentSchema }).strict(),
  z.object({ action: z.literal('help.checkUpdate') }).strict(),
  z.object({ action: z.literal('help.openUpdate'), tag: releaseTagSchema }).strict(),
  z.object({action:z.literal('report.preview'),accountId:z.uuid(),kind:reportKindSchema,chain:reportChainSchema.optional()}).strict(),
  z.object({action:z.literal('report.selection'),accountId:z.uuid(),kinds:reportSelectionSchema,chain:reportChainSchema.optional(),filters:reportFiltersSchema.optional()}).strict()
    .refine(command=>Object.keys(command.filters??{}).every(key=>command.kinds.some(kind=>kind===key))),
  z.object({action:z.literal('report.save'),accountId:z.uuid(),token:z.uuid(),format:z.enum(['xlsx','pdf'])}).strict(),
  z.object({ action: z.literal('market.status'), includeLastShopPrices: z.literal(true).optional() }).strict(),
  z.object({ action: z.literal('market.fairSeen'), noticeId: fairNoticeIdSchema }).strict(),
  z.object({action:z.literal('paints.status')}).strict(),
  z.object({action:z.literal('paints.refresh')}).strict(),
  z.object({action:z.literal('planner.draft'),accountId:z.uuid(),targetId:targetIdSchema,draft:draftSchema.optional()}).strict(),
  z.object({action:z.literal('planner.batch'),accountId:z.uuid(),entries:draftBatchSchema}).strict(),
  z.object({action:z.literal('planner.priorities'),accountId:z.uuid(),order:priorityOrderSchema.optional()}).strict(),
  z.object({ action: z.literal('planner.creditBudget'), accountId: z.uuid(), budget: creditBudgetSchema.optional() }).strict(),
  z.object({ action: z.literal('planner.packageShares'), accountId: z.uuid(), edit: packageShareEditSchema.optional() }).strict(),
  z.object({action:z.literal('planner.exclusions'),accountId:z.uuid()}).strict(),
  z.object({action:z.literal('planner.exclude'),accountId:z.uuid(),ccuKey:ccuResourceKeySchema,excluded:z.boolean()}).strict(),
  z.object({ action: z.literal('loaners.status') }).strict(),
  z.object({ action: z.literal('loaners.refresh') }).strict(),
  z.object({action:z.literal('loaners.reviews'),accountId:z.uuid()}).strict(),
  z.object({action:z.literal('loaners.review'),accountId:z.uuid(),key:loanerReviewKeySchema,state:loanerDecisionSchema}).strict(),
  z.object({action:z.literal('inventory.giveaways'),accountId:z.uuid(),edit:giveawayEditSchema.optional()}).strict(),
  z.object({ action: z.literal('pricing.status') }).strict(),
  z.object({ action: z.literal('pricing.save'), settings: displaySettingsSchema }).strict(),
  z.object({action:z.literal('table.widths'),table:tableWidthKeySchema,widths:tableWidthsSchema.optional()}).strict()
    .refine(command=>!command.widths||command.widths.length===tableWidthCounts[command.table]),
  z.object({ action: z.literal('market.openShip'), shipId: z.number().int().positive().max(1_000_000_000) }).strict(),
  z.object({ action: z.literal('market.openUpgrades') }).strict(),
  z.object({ action: z.literal('market.refresh') }).strict(),
  z.object({ action: z.literal('market.shopPrices'), pairs: z.array(shopPairSchema).min(1).max(MAX_SHOP_PAIRS) }).strict(),
  z.object({ action: z.literal('market.ccuQuote'), pair: shopPairSchema }).strict(),
  z.object({ action: z.literal('market.targets'), accountId: z.uuid(), ids: z.array(z.number().int().positive().max(1_000_000_000).nullable()).length(3).optional() }).strict(),
  z.object({ action: z.literal('account.create'), name: z.string().trim().min(1).max(80), mode: z.enum(['demo', 'real']) }).strict(),
  ...(['inventory', 'import.choose', 'import.demo', 'export', 'rsi.status', 'rsi.probe', 'rsi.close', 'rsi.settings', 'rsi.delete'] as const).map(action =>
    z.object({ action: z.literal(action), accountId: z.uuid() }).strict()),
  z.object({ action: z.literal('rsi.conciergeRank'), accountId: z.uuid() }).strict(),
  z.object({ action: z.literal('rsi.pledgeTotal'), accountId: z.uuid() }).strict(),
  z.object({ action: z.literal('rsi.open'), accountId: z.uuid(), remember: z.boolean() }).strict(),
  z.object({ action: z.literal('rsi.connect'), accountId: z.uuid(), remember: z.boolean() }).strict(),
  z.object({ action: z.literal('rsi.authorize'), accountId: z.uuid(), remember: z.boolean() }).strict(),
  z.object({ action: z.literal('account.select'), accountId: z.uuid() }).strict(),
  z.object({ action: z.literal('rsi.background'), accountId: z.uuid(), knownRevision: z.uuid().optional() }).strict(),
  z.object({ action: z.literal('rsi.refresh'), accountId: z.uuid() }).strict(),
  z.object({ action: z.literal('rsi.purchaseHistories'), accountId: z.uuid(), revision: z.uuid() }).strict(),
  z.object({ action: z.literal('rsi.upgradeHistory'), accountId: z.uuid(), revision: z.uuid(),
    pledgeId: z.string().regex(/^[1-9][0-9]{0,15}$/).refine(value => Number.isSafeInteger(Number(value))),
    lookupPurchases: z.literal(true).optional() }).strict(),
  z.object({ action: z.literal('import.commit'), accountId: z.uuid(), token: z.uuid(), bindingConfirmed: z.boolean(), reviewed: z.literal(true) }).strict(),
  z.object({ action: z.literal('import.cancel'), token: z.uuid() }).strict(),
]);
export type Command = z.infer<typeof commandSchema>;
export type BridgeResult<T = unknown> = { ok: true; data: T } | { ok: false; error: string };
