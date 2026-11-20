import { z } from 'zod';
import { shopRateSchema, type EuroRate } from './money';
import type { ShopPrice } from '../market/shop-prices';
export const displaySettingsSchema = z.object({
  schemaVersion: z.literal(1), language: z.enum(['de','en']), currency: z.enum(['EUR','USD']),
  taxMode: z.enum(['net','gross']), vatBasisPoints: z.number().int().min(0).max(10_000),
  shopRate: shopRateSchema.optional(),
  windowClose: z.enum(['tray', 'quit']).optional(),
}).strict();
export type DisplaySettings=z.infer<typeof displaySettingsSchema>;
export const DEFAULT_DISPLAY_SETTINGS:Readonly<DisplaySettings>=Object.freeze({schemaVersion:1,language:'de',currency:'EUR',taxMode:'net',vatBasisPoints:1900});
export type PricingSnapshot={settings:DisplaySettings;configured:boolean;settingsError:boolean;rate:EuroRate|null;pending:boolean;rateError:boolean;shopPrices?:readonly ShopPrice[]};
