import fs from 'node:fs';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {paintCatalogueSchema,type PaintCatalogue,type PaintSnapshot} from './model';import {readPaintCatalogue} from './source';
export class PaintService {
 private data:PaintCatalogue|null=null;private error:string|null=null;private flight:Promise<void>|null=null;private controller:AbortController|null=null;private closed=false;
 constructor(readonly directory:string,private read=(signal:AbortSignal)=>readPaintCatalogue(signal)){
  try{const file=path.join(directory,'paints-v1.json'),stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>8*1024*1024)throw Error('INVALID_CACHE');this.data=paintCatalogueSchema.parse(JSON.parse(fs.readFileSync(file,'utf8')));}catch{/* Optional public cache; no account data or session involved. */}
 }
 snapshot():PaintSnapshot{return structuredClone({data:this.data,pending:!!this.flight,error:this.error});}
 refresh():Promise<void>{
  if(this.closed)return Promise.resolve();if(this.flight)return this.flight;const controller=this.controller=new AbortController();
  const task=Promise.resolve().then(async()=>{try{
   if(this.closed||controller.signal.aborted)return;
   const data=paintCatalogueSchema.parse(await this.read(controller.signal));if(this.closed||controller.signal.aborted)return;
   fs.mkdirSync(this.directory,{recursive:true});if(fs.lstatSync(this.directory).isSymbolicLink())throw Error('INVALID_CACHE_FOLDER');
   const file=path.join(this.directory,'paints-v1.json');if(fs.existsSync(file)&&(!fs.lstatSync(file).isFile()||fs.lstatSync(file).isSymbolicLink()))throw Error('INVALID_CACHE_FILE');
   const body=JSON.stringify(data);if(Buffer.byteLength(body)>8*1024*1024)throw Error('CACHE_TOO_LARGE');
   const temp=file+'.'+randomUUID()+'.pending';try{fs.writeFileSync(temp,body,{flag:'wx'});fs.renameSync(temp,file);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
   this.data=data;this.error=null;
  }catch{if(!this.closed&&!controller.signal.aborted)this.error='Paint-Preise konnten nicht vollständig gelesen werden. Letzter gültiger Stand bleibt erhalten.';}
  }).finally(()=>{if(this.flight===task){this.flight=null;this.controller=null;}});this.flight=task;return task;
 }
 close(){this.closed=true;this.controller?.abort();}
}
