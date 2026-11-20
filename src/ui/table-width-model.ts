import {z} from 'zod';

export const tableWidthKeySchema=z.enum(['inventory','loaners','paints']);
export type TableWidthKey=z.infer<typeof tableWidthKeySchema>;
export const tableWidthCounts={inventory:7,loaners:4,paints:6} as const;
export const tableWidthsSchema=z.array(z.number().int().min(40).max(2400)).min(1).max(7);
export const tableWidthPreferencesSchema=z.partialRecord(tableWidthKeySchema,tableWidthsSchema)
 .refine(values=>Object.entries(values).every(([table,widths])=>widths.length===tableWidthCounts[table as TableWidthKey]));
