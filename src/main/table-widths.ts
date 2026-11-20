import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {UserError} from '../domain/model';
import {tableWidthPreferencesSchema,type TableWidthKey} from '../ui/table-width-model';

const schema=z.object({schemaVersion:z.literal(1),widths:tableWidthPreferencesSchema}).strict();
const absent=(error:unknown)=>(error as NodeJS.ErrnoException)?.code==='ENOENT';

/** Display preferences live outside Electron's disposable UI session. */
export class TableWidthStore {
 constructor(readonly directory:string){}

 private load(){
  try{
   this.checkDirectory();
   const file=path.join(this.directory,'table-widths-v1.json'),stat=fs.lstatSync(file);
   if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>4096)throw Error('TABLE_WIDTH_FILE');
   return schema.parse(JSON.parse(fs.readFileSync(file,'utf8'))).widths;
  }catch(error){
   if(absent(error))return {};
   throw new UserError('Gespeicherte Spaltenbreiten sind nicht lesbar.');
  }
 }

 private checkDirectory(){
  const stat=fs.lstatSync(this.directory);
  if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('TABLE_WIDTH_DIRECTORY');
 }

 get(table:TableWidthKey,widths?:number[]):number[]|null{
  const previous=this.load();
  if(!widths)return previous[table]??null;
  const payload=schema.parse({schemaVersion:1,widths:{...previous,[table]:widths}});
  fs.mkdirSync(this.directory,{recursive:true});
  this.checkDirectory();
  const file=path.join(this.directory,'table-widths-v1.json'),temp=file+'.'+randomUUID()+'.tmp';
  const fd=fs.openSync(temp,'wx');
  try{
   try{fs.writeFileSync(fd,JSON.stringify(payload));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
   fs.renameSync(temp,file);
  }finally{
   if(fs.existsSync(temp))fs.unlinkSync(temp);
  }
  return [...widths];
 }
}
