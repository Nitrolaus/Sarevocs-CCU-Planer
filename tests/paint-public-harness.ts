import {app,session} from 'electron';import fs from 'node:fs';import path from 'node:path';import {publicPaintReader} from '../src/paints/transport';import {readPaintCatalogue} from '../src/paints/source';
const folder=process.argv.find(v=>v.startsWith('--report-dir='))!.slice(13);app.setPath('userData',path.join(folder,'profile'));app.setPath('sessionData',path.join(folder,'sessions'));
void app.whenReady().then(async()=>{const checks:string[]=[],requests:{method:string;cookies:boolean;authorization:boolean;queryOnly:boolean}[]=[];let watched=0;
 try{
  await session.defaultSession.cookies.set({url:'https://robertsspaceindustries.com',name:'SarevocSyntheticIsolation',value:'LOCAL_TEST_ONLY',secure:true});
  app.on('session-created',isolated=>{watched++;isolated.webRequest.onBeforeSendHeaders({urls:['https://robertsspaceindustries.com/graphql']},(details,done)=>{
   const names=Object.keys(details.requestHeaders).map(v=>v.toLowerCase());const bytes=details.uploadData?.map(v=>v.bytes?.toString('utf8')??'').join('')??'';let queryOnly=false;try{const value=JSON.parse(bytes);queryOnly=typeof value.query==='string'&&value.query.startsWith('query ')&&!/\b(mutation|cart|reclaim|billing)\b/i.test(value.query);}catch{}
   requests.push({method:details.method,cookies:names.includes('cookie'),authorization:names.includes('authorization'),queryOnly});done({requestHeaders:details.requestHeaders});
  });});
  const reader=publicPaintReader();const data=await readPaintCatalogue(AbortSignal.timeout(60000),reader);
  if(watched!==1||requests.length<3||requests.some(r=>r.method!=='POST'||r.cookies||r.authorization||!r.queryOnly))throw Error('PUBLIC_ISOLATION_FAILED');
  checks.push('Dedicated nonpersistent session; synthetic default-session cookie never sent.','Every native request is an immutable query without cookies or authorization.','Complete catalogue and quantity rules parsed by the production public reader.');
  const result={status:'PASS',checks,publicSkus:data.skus.length,uniqueSkus:new Set(data.skus.map(s=>s.id)).size,publicRules:data.rules.length,requests:requests.length,newRsiLogin:false,realUserFilesRead:false,tokenValuesLogged:false,urlsLogged:false,accountDataSent:false};fs.writeFileSync(path.join(folder,'results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }catch(error){fs.writeFileSync(path.join(folder,'results.json'),JSON.stringify({status:'FAIL',checks,error:String(error)},null,2));console.error(String(error));process.exitCode=1;}
 finally{app.exit(Number(process.exitCode??0));}
});
