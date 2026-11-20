import {z} from 'zod';
export const storeCreditSchema=z.object({minor:z.number().int().nonnegative().max(100_000_000),currency:z.enum(['USD','EUR']),observedAt:z.iso.datetime({offset:true}),source:z.literal('rsi-credit-ledger')}).strict();
export type StoreCredit=z.infer<typeof storeCreditSchema>;
export function parseStoreCredit(raw:unknown,observedAt:string):StoreCredit|null{
 const amount=z.object({value:z.union([z.number().int().nonnegative().max(100_000_000),z.string().regex(/^(?:0|[1-9]\d{0,8})$/).transform(Number).refine(n=>n<=100_000_000)]),currency:z.object({code:z.enum(['USD','EUR'])})});
 const response=z.array(z.object({errors:z.array(z.unknown()).max(0).optional(),data:z.object({customer:z.object({ledger:z.object({amount})})})})).length(1).safeParse(raw);
 if(!response.success)return null;const v=response.data[0]!.data.customer.ledger.amount;
 const parsed=storeCreditSchema.safeParse({minor:v.value,currency:v.currency.code,observedAt,source:'rsi-credit-ledger'});return parsed.success?parsed.data:null;
}
