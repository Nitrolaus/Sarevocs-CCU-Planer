import {randomUUID} from 'node:crypto';
import {UserError} from '../domain/model';
import {createReport,createReports,type ReportInput} from './document';
import {reportPreview} from './render';
import type {ReportDocument,ReportFilters,ReportKind} from './model';
import type {LoanerReviewsSnapshot} from '../loaners/review-model';
/** Short-lived, main-owned receipts bind a preview to one frozen document and profile. */
export class ReportService{
 private pending=new Map<string,{accountId:string;expires:number;document:ReportDocument}>();
 preview(input:ReportInput){return this.freeze(input.inventory.account.id,createReport(input));}
 async selection(input:Omit<ReportInput,'kind'>,kinds:readonly ReportKind[],reviews?:LoanerReviewsSnapshot,filters?:ReportFilters){
  return this.freeze(input.inventory.account.id,await createReports(input,kinds,reviews,filters));
 }
 private freeze(accountId:string,document:ReportDocument){
  const now=Date.now();for(const [key,v]of this.pending)if(v.expires<now)this.pending.delete(key);
  const token=randomUUID();while(this.pending.size>=3)this.pending.delete(this.pending.keys().next().value!);
  this.pending.set(token,{accountId,expires:now+15*60_000,document});return reportPreview(document,token);
 }
 get(accountId:string,token:string){const entry=this.pending.get(token);if(!entry||entry.accountId!==accountId||entry.expires<Date.now())throw new UserError('Exportvorschau ist abgelaufen oder gehört zu einem anderen Profil. Bitte neu öffnen.');return structuredClone(entry.document);}
 remove(token:string){this.pending.delete(token);}
 clear(){this.pending.clear();}
}
