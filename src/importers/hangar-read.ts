import {UserError,type ImportCandidate} from '../domain/model';import {MAX_FILE_BYTES,parseImport} from './files';
export type HangarReadProgress={pagesRead:number;pledgesRead:number;page:number;attempt:number;waiting:boolean};
type Reader={accountId:string;initial:unknown;restartAtFirst:boolean;loadPage:(page:number)=>Promise<unknown>;assertActive:()=>void;onProgress?:(value:HangarReadProgress)=>void;sleep?:(ms:number)=>Promise<void>};
type Page={ok:true;handle:string|null;pledges:unknown[]};
const realSleep=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
/** Sequential, bounded read. A rejected page never returns a partial success. No account changes. */
export async function readHangarPages(input:Reader):Promise<{candidate:ImportCandidate;pagesRead:number}>{
 const sleep=input.sleep??realSleep,pledges:unknown[]=[],ids=new Set<string>(),signatures=new Set<string>();let handle:string|null=null,pagesRead=0,sourceBytes=0,normalizedBytes=0;
 const progress=(page:number,attempt=1,waiting=false)=>input.onProgress?.({page,pagesRead,pledgesRead:pledges.length,attempt,waiting});
 const pause=async(ms:number)=>{for(let left=ms;left>0;left-=250){input.assertActive();await sleep(Math.min(left,250));}input.assertActive();};
 const validate=(value:unknown):{page:Page;validated:ImportCandidate}=>{
  if(!value||typeof value!=='object'||!('ok'in value)||value.ok!==true||!('pledges'in value)||!Array.isArray(value.pledges)||value.pledges.length>100||!('handle'in value)||(value.handle!==null&&typeof value.handle!=='string'))throw new UserError('Eine Hangarseite konnte nicht sicher gelesen werden. Der letzte gültige Stand bleibt erhalten.');
  const page=value as Page;if(page.handle){if(handle!==null&&page.handle!==handle)throw new UserError('Kontohinweis während des Lesens gewechselt. Keine Übernahme.');handle=page.handle;}
  return {page,validated:parseImport(JSON.stringify({type:'hangarexport',version:2,handle:handle??`rsi-local:${input.accountId}`,pledges:page.pledges}))};
 };
 const add=(value:unknown)=>{const {page,validated}=validate(value),pageIds=validated.document.pledges.map(p=>p.pledgeId),signature=JSON.stringify(pageIds);
  if(signatures.has(signature))throw new UserError('RSI hat eine Hangarseite wiederholt. Der Leselauf wurde nicht als vollständig übernommen; der letzte gültige Stand bleibt erhalten.');
  if(pageIds.some(id=>ids.has(id)))throw new UserError('Überlappende Pledge-IDs auf mehreren Hangarseiten. Keine Übernahme.');
  if(pledges.length+pageIds.length>50000)throw new UserError('Hangar-Lesegrenze erreicht. Kein unvollständiger Bestand übernommen.');
  for(const pledge of page.pledges)sourceBytes+=Buffer.byteLength(JSON.stringify(pledge),'utf8')+1;
  for(const pledge of validated.document.pledges)normalizedBytes+=Buffer.byteLength(JSON.stringify(pledge),'utf8')+1;
  if(Math.max(sourceBytes,normalizedBytes)+2048>MAX_FILE_BYTES)throw new UserError('Der Hangar überschreitet das sichere Datenlimit von 20 MiB. Der letzte gültige Stand bleibt erhalten.');
  for(const id of pageIds)ids.add(id);signatures.add(signature);pledges.push(...page.pledges);pagesRead++;return page.pledges.length;
 };
 input.assertActive();const first=validate(input.initial).page;
 if(input.restartAtFirst||first.pledges.length>=10){
  for(let page=1;page<=5000;page++){
   let result:unknown;for(let attempt=1;attempt<=3;attempt++){
    input.assertActive();progress(page,attempt);result=await input.loadPage(page);input.assertActive();
    const retry=result&&typeof result==='object'&&'ok'in result&&result.ok===false&&'retryable'in result&&result.retryable===true;
    if(!retry||attempt===3)break;
    const retryAfter=(result as {retryAfterMs?:unknown}).retryAfterMs,requested=typeof retryAfter==='number'&&Number.isFinite(retryAfter)?retryAfter:0;
    progress(page,attempt,true);await pause(Math.min(60000,Math.max(attempt===1?1000:3000,requested)));
   }
   const count=add(result);progress(page);if(count<10)break;if(page===5000)throw new UserError('Hangar-Seitengrenze erreicht. Kein unvollständiger Bestand übernommen.');await pause(150);
  }
 }else{add(first);progress(1);}
 input.assertActive();const candidate=parseImport(JSON.stringify({type:'hangarexport',version:2,handle:handle??`rsi-local:${input.accountId}`,pledges}));
 if(handle===null)candidate.document.account.identityKind='manual-reference';candidate.document.scope.pagesRead=pagesRead;return {candidate,pagesRead};
}
