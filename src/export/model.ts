import {z} from 'zod';
import {draftSchema,targetIdSchema} from '../planner/draft';
import {reportFilterOptions} from './filters';
export const inventoryReportSections=['ships','ccus','addons','paints','packages','access','buyback','loaners'] as const;
export const planningReportSections=['chain','offers'] as const;
export const reportSections=[...inventoryReportSections,...planningReportSections] as const;
const reportSectionSchema=z.enum(reportSections);
export const reportKindSchema=z.enum(['inventory',...reportSections]);
export const reportSelectionSchema=z.array(reportSectionSchema).min(1).max(reportSections.length)
 .refine(kinds=>new Set(kinds).size===kinds.length);
export const reportFiltersSchema=z.partialRecord(reportSectionSchema,z.array(z.string().max(32)).min(1).max(8))
 .refine(filters=>reportSections.every(kind=>{
  const values=filters[kind];
  return !values||(new Set(values).size===values.length&&values.every(id=>reportFilterOptions[kind].some(option=>option[0]===id)));
 }));
export type ReportFilters=z.infer<typeof reportFiltersSchema>;
export const reportChainSchema=z.object({targetId:targetIdSchema,draft:draftSchema,preview:z.boolean()}).strict();
export type ReportKind=z.infer<typeof reportKindSchema>;
export type ReportChain=z.infer<typeof reportChainSchema>;
export type ExportContext={accountId:string;chain:ReportChain}|null;
export type ReportCell=string|number|Date|null;
export type ReportColumn={label:string;width:number;format?:'money'|'date'};
export type ReportRow={cells:ReportCell[];tone?:'owned'|'purchase'|'warning'};
export type ReportDocument={title:string;kind:ReportKind;profileName:string;createdAt:string;language:'de'|'en';
 notes:string[];columns:ReportColumn[];rows:ReportRow[];totals:{label:string;value:string}[];sections?:ReportDocument[]};
export type ReportPreview={token:string;title:string;profileName:string;createdAt:string;count:number;
 columns:string[];rows:string[][];tones:ReportRow['tone'][];notes:string[];totals:ReportDocument['totals'];sections?:{kind:ReportKind;title:string;count:number}[]};
export type ReportSaveResult={exported:boolean};
