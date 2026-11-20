import fs from 'node:fs';import path from 'node:path';import {randomUUID} from 'node:crypto';import {z} from 'zod';
import {ccuResourceKeySchema,excludedCcusSchema} from './exclusions';import {UserError} from '../domain/model';
const schema=z.object({schemaVersion:z.literal(1),accountId:z.uuid(),excluded:excludedCcusSchema}).strict();const maxBytes=20*1024*1024;
/** Planner-only preferences; never mutates a pledge, inventory, login or RSI session. */
export class CcuExclusionStore{
 constructor(readonly directory:string){}
 private file(id:string){return path.join(this.directory,'ccu-exclusions-'+z.uuid().parse(id)+'.json');}
 private check(){try{const s=fs.lstatSync(this.directory);if(!s.isDirectory()||s.isSymbolicLink())throw Error('DIRECTORY');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw new UserError('CCU-Sperren sind nicht sicher lesbar.');}}
 load(accountId:string):string[]{const file=this.file(accountId);this.check();try{const s=fs.lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.size>maxBytes)throw Error('FILE');const data=schema.parse(JSON.parse(fs.readFileSync(file,'utf8')));if(data.accountId!==accountId)throw Error('PROFILE');return data.excluded;}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return [];throw new UserError('Gespeicherte CCU-Sperren sind nicht lesbar. Sie wurden nicht ersetzt.');}}
 toggle(accountId:string,key:string,excluded:boolean,owned:ReadonlySet<string>):string[]{ccuResourceKeySchema.parse(key);const before=this.load(accountId);if(!owned.has(key)&&!(excluded===false&&before.includes(key)))throw new UserError('Dieses CCU-Exemplar gehört nicht zum gelesenen Profilbestand.');
  const keys=new Set(before);if(excluded)keys.add(key);else keys.delete(key);const data=schema.parse({schemaVersion:1,accountId,excluded:[...keys].sort()}),json=JSON.stringify(data);if(Buffer.byteLength(json)>maxBytes)throw new UserError('Zu viele CCU-Sperren.');
  fs.mkdirSync(this.directory,{recursive:true});this.check();const temp=path.join(this.directory,'ccu-exclusions-'+randomUUID()+'.tmp');let created=false;try{const fd=fs.openSync(temp,'wx');created=true;try{fs.writeFileSync(fd,json);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(temp,this.file(accountId));created=false;}finally{if(created&&fs.existsSync(temp))fs.unlinkSync(temp);}return data.excluded;
 }
}
