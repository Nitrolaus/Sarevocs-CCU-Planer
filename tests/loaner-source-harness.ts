import { app } from 'electron';import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import { LoanerService } from '../src/loaners/service';import { publicMarketReader } from '../src/market/transport';import { MARKET_SOURCES } from '../src/market/model';import { deriveLoaners } from '../src/loaners/derive';
const folder=process.argv.find(a=>a.startsWith('--probe-dir='))?.slice(12);if(!folder||!path.isAbsolute(folder))throw Error('PROBE_DIRECTORY_REQUIRED');
for(const key of ['userData','sessionData','crashDumps','logs','temp'] as const){const dir=path.join(folder,key);fs.mkdirSync(dir,{recursive:true});app.setPath(key,dir);}app.disableHardwareAcceleration();
const requests:{allowed:boolean;method:string;credentialsPresent:boolean}[]=[];
app.on('session-created',session=>session.webRequest.onBeforeSendHeaders((details,callback)=>{
 const allowed=details.url===MARKET_SOURCES.loaners||details.url===MARKET_SOURCES.included,credentialsPresent=Object.keys(details.requestHeaders).some(key=>/^(cookie|authorization|proxy-authorization|x-rsi-token)$/i.test(key));
 requests.push({allowed,method:details.method,credentialsPresent});callback({cancel:!allowed||credentialsPresent});
}));
app.whenReady().then(async()=>{const service=new LoanerService(path.join(folder,'cache'),publicMarketReader());
 try{await service.refresh();const snapshot=service.snapshot();assert.equal(snapshot.error,false);assert.ok(snapshot.data);assert.equal(requests.length,2);assert.ok(requests.every(r=>r.allowed&&r.method==='GET'&&!r.credentialsPresent));
 const rules=deriveLoaners([],snapshot.data);assert.equal(rules.partialRules,false);
 const report={status:'PASS',requests,loanerRules:snapshot.data.loaners.rows.length,includedRules:snapshot.data.included.rows.length,sourceUpdated:{loaners:snapshot.data.loaners.updatedAt,included:snapshot.data.included.updatedAt},actualDedicatedTransport:true,userFilesRead:false,newRsiLogin:false};
 fs.writeFileSync(path.join(folder,'results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));service.close();app.quit();
 }catch{service.close();fs.writeFileSync(path.join(folder,'results.json'),JSON.stringify({status:'FAIL',requests,error:'PUBLIC_LOANER_PROBE_FAILED'},null,2));app.exit(1);}
});
