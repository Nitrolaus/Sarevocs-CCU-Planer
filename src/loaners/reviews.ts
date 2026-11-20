import fs from 'node:fs';import path from 'node:path';import {randomUUID} from 'node:crypto';import {z} from 'zod';
import {loanerDecisionSchema,loanerReviewFileSchema,loanerReviewKeySchema,type LoanerDecision,type LoanerReviewFile,type LoanerReviewsSnapshot} from './review-model';

/** Local user observations only. Never writes inventory, public rules, vault or credentials. */
export class LoanerReviews {
  constructor(readonly directory:string,private readonly now=()=>new Date().toISOString()){}
  private file(accountId:string):string{return path.join(this.directory,'loaner-'+z.uuid().parse(accountId)+'.json');}
  private checkDirectory():void{
    try{const stat=fs.lstatSync(this.directory);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('REVIEW_DIRECTORY');}
    catch(e){if(!(e&&typeof e==='object'&&'code' in e&&e.code==='ENOENT'))throw e;}
  }
  private read(accountId:string):LoanerReviewFile{
    const file=this.file(accountId);this.checkDirectory();
    try{const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>384*1024||stat.size<2)throw Error('REVIEW_FILE');
      const data=loanerReviewFileSchema.parse(JSON.parse(fs.readFileSync(file,'utf8')));if(data.accountId!==accountId)throw Error('REVIEW_ACCOUNT');return data;
    }catch(e){if(e&&typeof e==='object'&&'code' in e&&e.code==='ENOENT')return {schemaVersion:1,accountId,entries:{}};throw Error('LOANER_REVIEWS_UNREADABLE');}
  }
  snapshot(accountId:string):LoanerReviewsSnapshot{
    z.uuid().parse(accountId);
    try{return {accountId,readable:true,entries:this.read(accountId).entries};}catch{return {accountId,readable:false,entries:{}};}
  }
  set(accountId:string,key:string,decision:LoanerDecision):LoanerReviewsSnapshot{
    const file=this.file(accountId),fingerprint=loanerReviewKeySchema.parse(key),state=loanerDecisionSchema.parse(decision),data=this.read(accountId);
    if(state==='unconfirmed')delete data.entries[fingerprint];else data.entries[fingerprint]={state,updatedAt:z.iso.datetime({offset:true}).parse(this.now())};
    const entries=Object.entries(data.entries).sort((a,b)=>Number(b[0]===fingerprint)-Number(a[0]===fingerprint)||b[1].updatedAt.localeCompare(a[1].updatedAt));data.entries=Object.fromEntries(entries.slice(0,1500));loanerReviewFileSchema.parse(data);
    fs.mkdirSync(this.directory,{recursive:true});this.checkDirectory();const temp=path.join(this.directory,'review-'+randomUUID()+'.tmp');let created=false;
    try{const fd=fs.openSync(temp,'wx');created=true;try{fs.writeFileSync(fd,JSON.stringify(data));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(temp,file);created=false;}
    finally{if(created&&fs.existsSync(temp))fs.unlinkSync(temp);}
    return {accountId,readable:true,entries:structuredClone(data.entries)};
  }
}
