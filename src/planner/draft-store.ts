import fs from 'node:fs';import path from 'node:path';import {randomUUID} from 'node:crypto';import {z} from 'zod';
import {draftFileSchema,draftSchema,draftBatchSchema,emptyDraft,targetIdSchema,type PlannerDraft} from './draft';
import {UserError} from '../domain/model';
/** Local simulations only. No inventory, account, public source or session mutation. */
export class PlannerDraftStore{
  constructor(readonly directory:string){}
  private file(accountId:string){return path.join(this.directory,'plan-'+z.uuid().parse(accountId)+'.json');}
  private check(){try{const s=fs.lstatSync(this.directory);if(!s.isDirectory()||s.isSymbolicLink())throw Error('DIRECTORY');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw new UserError('Planungsordner ist nicht sicher lesbar.');}}
  private read(accountId:string){this.check();const file=this.file(accountId);
    try{const s=fs.lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||s.size>8*1024*1024)throw Error('FILE');
      const data=draftFileSchema.parse(JSON.parse(fs.readFileSync(file,'utf8')));if(data.accountId!==accountId)throw Error('PROFILE');return data;
    }catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return {schemaVersion:1 as const,accountId,targets:[]};throw new UserError('Gespeicherte Planung ist nicht lesbar. Sie wurde nicht ersetzt.');}}
  load(accountId:string,targetId:number):PlannerDraft|null{const id=targetIdSchema.parse(targetId);return this.read(accountId).targets.find(t=>t.targetId===id)?.draft??null;}
  save(accountId:string,targetId:number,input:PlannerDraft){const file=this.file(accountId),draft=draftSchema.parse(input),id=targetIdSchema.parse(targetId),data=this.read(accountId);
    const entry={targetId:id,draft,updatedAt:new Date().toISOString()},index=data.targets.findIndex(t=>t.targetId===id);
    if(index>=0)data.targets[index]=entry;else{if(data.targets.length>=30)throw new UserError('Maximal 30 gespeicherte Zielplanungen pro Profil.');data.targets.push(entry);}
    this.write(accountId,data);return draft;
  }
  /** One file, one atomic rename. A stale preview or any failed write preserves every old target. */
  saveBatch(accountId:string,input:unknown){const rows=draftBatchSchema.parse(input),data=this.read(accountId);
    for(const row of rows)if(JSON.stringify(data.targets.find(t=>t.targetId===row.targetId)?.draft??emptyDraft())!==JSON.stringify(row.expected))throw new UserError('Planung wurde geändert. Bitte erneut prüfen.');
    for(const row of rows){const entry={targetId:row.targetId,draft:row.draft,updatedAt:new Date().toISOString()},i=data.targets.findIndex(t=>t.targetId===row.targetId);if(i<0)data.targets.push(entry);else data.targets[i]=entry;}
    this.write(accountId,data);return rows.map(({targetId,draft})=>({targetId,draft}));
  }
  private write(accountId:string,data:unknown){const file=this.file(accountId),bytes=Buffer.from(JSON.stringify(draftFileSchema.parse(data)));if(bytes.length>8*1024*1024)throw new UserError('Planung ist zu groß.');
    fs.mkdirSync(this.directory,{recursive:true});this.check();const temp=path.join(this.directory,'plan-'+randomUUID()+'.tmp');let created=false;
    try{const fd=fs.openSync(temp,'wx');created=true;try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(temp,file);created=false;}
    finally{if(created&&fs.existsSync(temp))fs.unlinkSync(temp);}
  }
}
