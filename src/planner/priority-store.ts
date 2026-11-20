import fs from 'node:fs';import path from 'node:path';import {randomUUID} from 'node:crypto';import {z} from 'zod';
import {priorityOrderSchema,DEFAULT_PRIORITIES,type PriorityOrder} from './reservations';import {UserError} from '../domain/model';
const fileSchema=z.object({schemaVersion:z.literal(1),accountId:z.uuid(),order:priorityOrderSchema}).strict();
/** Local planning preferences, separate from existing drafts and inventory. */
export class PlannerPriorityStore{
 constructor(readonly directory:string){}
 private file(accountId:string){return path.join(this.directory,'priority-'+z.uuid().parse(accountId)+'.json');}
 private check(){try{const s=fs.lstatSync(this.directory);if(!s.isDirectory()||s.isSymbolicLink())throw Error('DIRECTORY');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw new UserError('Planungsordner ist nicht sicher lesbar.');}}
 load(accountId:string):PriorityOrder{const file=this.file(accountId);this.check();try{const s=fs.lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||s.size>1024)throw Error('FILE');const data=fileSchema.parse(JSON.parse(fs.readFileSync(file,'utf8')));if(data.accountId!==accountId)throw Error('PROFILE');return data.order;}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return [...DEFAULT_PRIORITIES];throw new UserError('Gespeicherter Vorrang ist nicht lesbar. Er wurde nicht ersetzt.');}}
 save(accountId:string,order:PriorityOrder):PriorityOrder{const data=fileSchema.parse({schemaVersion:1,accountId,order});this.load(accountId);fs.mkdirSync(this.directory,{recursive:true});this.check();const temp=path.join(this.directory,'priority-'+randomUUID()+'.tmp');let created=false;
  try{const fd=fs.openSync(temp,'wx');created=true;try{fs.writeFileSync(fd,JSON.stringify(data));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(temp,this.file(accountId));created=false;}finally{if(created&&fs.existsSync(temp))fs.unlinkSync(temp);}return data.order;
 }
}
