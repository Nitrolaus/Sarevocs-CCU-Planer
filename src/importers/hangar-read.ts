import {UserError,type ImportCandidate} from '../domain/model';import {MAX_FILE_BYTES,parseImport} from './files';
import { HANGAR_PAGE_FAILURES, type HangarPageFailure } from '../diagnostics/connection';
export type HangarReadProgress={pagesRead:number;pledgesRead:number;page:number;attempt:number;waiting:boolean;totalPages:number|null};
export type HangarRefreshProgress=HangarReadProgress&{phase:'reading'|'finishing'};
type Reader={accountId:string;initial:unknown;restartAtFirst:boolean;loadPage:(page:number)=>Promise<unknown>;assertActive:()=>void;onProgress?:(value:HangarReadProgress)=>void;sleep?:(ms:number)=>Promise<void>};
type Page={ok:true;handle:string|null;pledges:unknown[];totalPages?:number|null;navigation?:'next'|'last';activePage?:number};
export class HangarPageError extends UserError {
 constructor(readonly page: number, readonly failure: HangarPageFailure, message: string, readonly httpStatus?: number) { super(message); }
}
const unreadable='Eine Hangarseite konnte nicht sicher gelesen werden. Der letzte gültige Stand bleibt erhalten.';
const realSleep=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
/** Sequential, bounded read. A rejected page never returns a partial success. No account changes. */
export async function readHangarPages(input:Reader):Promise<{candidate:ImportCandidate;pagesRead:number}>{
 const sleep=input.sleep??realSleep,pledges:unknown[]=[],ids=new Set<string>(),signatures=new Set<string>();let handle:string|null=null,pagesRead=0,sourceBytes=0,normalizedBytes=0;
 let totalPages:number|null=null,conflictingTotals=false;
 const progress=(page:number,attempt=1,waiting=false)=>input.onProgress?.({page,pagesRead,pledgesRead:pledges.length,attempt,waiting,totalPages});
 const pause=async(ms:number)=>{for(let left=ms;left>0;left-=250){input.assertActive();await sleep(Math.min(left,250));}input.assertActive();};
 const validate=(value:unknown,number:number):{page:Page;validated:ImportCandidate}=>{
  const result=value&&typeof value==='object'?value as Record<string,unknown>:{};
  if(result.ok!==true||!Array.isArray(result.pledges)||result.pledges.length>100||(result.handle!==null&&typeof result.handle!=='string')){
   const failure=HANGAR_PAGE_FAILURES.find(reason=>reason===(result.failure??result.reason))??'invalid-data';
   const status=failure==='http-error'&&typeof result.httpStatus==='number'?result.httpStatus:undefined;
   throw new HangarPageError(number,failure,unreadable,status);
  }
  const page=value as Page;
  if(page.handle){if(handle!==null&&page.handle!==handle)throw new HangarPageError(number,'account-changed','Kontohinweis während des Lesens gewechselt. Keine Übernahme.');handle=page.handle;}
  try {
   return {page,validated:parseImport(JSON.stringify({type:'hangarexport',version:2,handle:handle??`rsi-local:${input.accountId}`,pledges:page.pledges}))};
  } catch {
   throw new HangarPageError(number,'invalid-data',unreadable);
  }
 };
 const add=(value:unknown,number:number)=>{const {page,validated}=validate(value,number),pageIds=validated.document.pledges.map(p=>p.pledgeId),signature=JSON.stringify(pageIds);
  if(page.activePage!==undefined&&page.activePage!==number){
   throw new HangarPageError(number,'pagination-conflict','RSI hat eine andere als die angeforderte Hangarseite geliefert. Der letzte gültige Stand bleibt erhalten.');
  }
  if(signatures.has(signature))throw new HangarPageError(number,'duplicate-page','RSI hat eine Hangarseite wiederholt. Der letzte gültige Stand bleibt erhalten.');
  if(pageIds.some(id=>ids.has(id)))throw new HangarPageError(number,'duplicate-page','Überlappende Pledge-IDs auf mehreren Hangarseiten. Keine Übernahme.');
  if(pledges.length+pageIds.length>50000)throw new HangarPageError(number,'size-limit','Hangar-Lesegrenze erreicht. Kein unvollständiger Bestand übernommen.');
  for(const pledge of page.pledges)sourceBytes+=Buffer.byteLength(JSON.stringify(pledge),'utf8')+1;
  for(const pledge of validated.document.pledges)normalizedBytes+=Buffer.byteLength(JSON.stringify(pledge),'utf8')+1;
  if(Math.max(sourceBytes,normalizedBytes)+2048>MAX_FILE_BYTES)throw new HangarPageError(number,'size-limit','Der Hangar überschreitet das sichere Datenlimit von 20 MiB. Der letzte gültige Stand bleibt erhalten.');
  for(const id of pageIds)ids.add(id);signatures.add(signature);pledges.push(...page.pledges);pagesRead++;
  const reported=page.totalPages;
  if(typeof reported==='number'&&Number.isInteger(reported)&&reported>0&&reported<=5000){
   if(totalPages!==null&&totalPages!==reported)conflictingTotals=true;
   if(!conflictingTotals)totalPages=reported;
  }
  if(conflictingTotals||(totalPages!==null&&pagesRead>totalPages&&page.pledges.length>0)){totalPages=null;conflictingTotals=true;}
  return page;
 };
 input.assertActive();const first=validate(input.initial,1).page;
 if(input.restartAtFirst||first.pledges.length>=10||first.navigation==='next'||(first.totalPages??0)>1){
  let precedingPageHasNext=false;
  for(let page=1;page<=5000;page++){
   let result:unknown;for(let attempt=1;attempt<=3;attempt++){
    input.assertActive();progress(page,attempt);
    try { result=await input.loadPage(page); }
    catch { input.assertActive(); throw new HangarPageError(page,'request-failed',unreadable); }
    input.assertActive();
    const retry=result&&typeof result==='object'&&'ok'in result&&result.ok===false&&'retryable'in result&&result.retryable===true;
    if(!retry||attempt===3)break;
    const retryAfter=(result as {retryAfterMs?:unknown}).retryAfterMs,requested=typeof retryAfter==='number'&&Number.isFinite(retryAfter)?retryAfter:0;
    progress(page,attempt,true);await pause(Math.min(60000,Math.max(attempt===1?1000:3000,requested)));
   }
   const {pledges:entries,navigation}=add(result,page);
   const more=navigation==='next'||(totalPages!==null&&totalPages>page);
   if((entries.length===0&&(more||precedingPageHasNext||totalPages===page))||(navigation==='last'&&more)){
    throw new HangarPageError(page,'pagination-conflict','Die Hangar-Seitenfolge ist widersprüchlich. Der letzte gültige Stand bleibt erhalten.');
   }
   progress(page);
   if(!more&&(entries.length<10||navigation==='last'&&(totalPages===page||precedingPageHasNext&&!conflictingTotals)))break;
   if(page===5000)throw new HangarPageError(page,'page-limit','Hangar-Seitengrenze erreicht. Kein unvollständiger Bestand übernommen.');
   precedingPageHasNext=navigation==='next';
   await pause(150);
  }
 }else{add(first,1);progress(1);}
 input.assertActive();const candidate=parseImport(JSON.stringify({type:'hangarexport',version:2,handle:handle??`rsi-local:${input.accountId}`,pledges}));
 if(handle===null)candidate.document.account.identityKind='manual-reference';
 candidate.document.scope.pagesRead=pagesRead;
 if(!conflictingTotals)candidate.hangarRead={kind:'reached-end',pagesRead,pledgesRead:candidate.document.pledges.length};
 return {candidate,pagesRead};
}
