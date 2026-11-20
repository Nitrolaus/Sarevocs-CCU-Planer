import fs from 'node:fs';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {UserError} from '../domain/model';
/** Save-dialog result only. Never write directly into an existing report. */
export function reportTarget(file:string,format:'xlsx'|'pdf'){
 if(path.extname(file).toLowerCase()!=='.'+format)throw new UserError('Dateiendung passt nicht zum gewählten Exportformat.');
 const directory=path.dirname(file);
 function folder(){
  const canonical=fs.realpathSync.native(directory);
  const identity=fs.lstatSync(directory,{bigint:true});
  if(!identity.isDirectory()||identity.isSymbolicLink())throw new UserError('Exportordner ist kein regulärer Ordner.');
  return {canonical,device:identity.dev,inode:identity.ino};
 }
 const original=folder();
 function checkFolder(){
  const current=folder();
  if(current.canonical!==original.canonical||current.device!==original.device||current.inode!==original.inode)
   throw new UserError('Exportordner wurde inzwischen geändert. Bitte erneut speichern.');
 }
 const stat=()=>{try{const s=fs.lstatSync(file,{bigint:true});if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1n)throw new UserError('Exportziel ist keine normale einzelne Datei.');return s;}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw e;}};
 const before=stat();
 return (buffer:Buffer)=>{
  const pending=path.join(directory,'.ccu-export-'+randomUUID()+'.pending');let created=false;
  checkFolder();
  try{const fd=fs.openSync(pending,'wx',0o600);created=true;try{checkFolder();fs.writeFileSync(fd,buffer);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
   checkFolder();
   const after=stat();if((before===null)!==(after===null)||before&&after&&(before.ino!==after.ino||before.dev!==after.dev||before.mtimeNs!==after.mtimeNs||before.ctimeNs!==after.ctimeNs||before.size!==after.size))throw new UserError('Exportziel wurde inzwischen geändert. Bitte erneut speichern.');
   fs.renameSync(pending,file);created=false;
  }finally{if(created)fs.rmSync(pending,{force:true});}
 };
}
