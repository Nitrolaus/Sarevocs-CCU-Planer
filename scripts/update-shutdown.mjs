import {_electron} from 'playwright-core';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

const require=createRequire(import.meta.url),root=process.cwd();
const folder=path.resolve('work/temp/update-shutdown',randomUUID()),appFolder=path.join(folder,'app');
fs.mkdirSync(appFolder,{recursive:true});
const fixtureModule=path.join(folder,'rsi.cjs'),transport=path.join(folder,'transport.mjs');
await build({entryPoints:['tests/automatic-start-harness.ts'],outfile:fixtureModule,bundle:true,
  platform:'node',format:'cjs',target:'node24',external:['electron','sql.js']});
const seed=await require(fixtureModule).seedAutomaticStart(path.join(folder,'data'),path.resolve('build/sql-wasm.wasm'));
fs.writeFileSync(transport,`
export function publicClient(){return async url=>{
  if(url!=='https://api.github.com/repos/Nitrolaus/Sarevocs-CCU-Planer/releases?per_page=10')throw Error('Unapproved synthetic release source');
  globalThis.ccuUpdateFixture.releaseReads++;
  return [{tag_name:'v0.4.0-alpha',draft:false,published_at:'2026-01-01T00:00:00Z',body:'## Deutsch\\nSynthetischer Update-Test.'}];
};}
export function publicMarketReader(){return async()=>{throw Error('Market network disabled in fixture');};}
export function publicShopPriceReader(){return async()=>[];}
export function publicPoundHistoryReader(){return async()=>new Map();}
`);
await build({entryPoints:['src/main.ts'],outfile:path.join(appFolder,'main.cjs'),bundle:true,
  platform:'node',format:'cjs',target:'node24',external:['electron','sql.js'],plugins:[{
    name:'synthetic-rsi-and-public-data',setup(builder){
      builder.onResolve({filter:/(?:^|\/)importers\/rsi$/},()=>({path:path.resolve('tests/automatic-start-harness.ts')}));
      builder.onResolve({filter:/(?:^|\/)market\/transport$/},()=>({path:transport}));
    },
  }]});
for(const file of ['preload.cjs','app.ico','tray.ico','sql-wasm.wasm','demo-inventory.json']){
  fs.copyFileSync(path.join(root,'build',file),path.join(appFolder,file));
}
fs.cpSync(path.join(root,'build/renderer'),path.join(appFolder,'renderer'),{recursive:true});
const exitReport=path.join(folder,'exit.json'),entry=path.join(folder,'entry.cjs');
fs.writeFileSync(entry,`
const fs=require('node:fs');
const {app,BrowserWindow,dialog,shell}=require('electron');
globalThis.ccuUpdateFixture={answer:0,browserFailure:false,prompts:[],opened:[],releaseReads:0};
require(${JSON.stringify(fixtureModule)}).installAutomaticFixture(${JSON.stringify(seed)});
BrowserWindow.prototype.loadURL=async function(){throw Error('All remote windows are forbidden');};
dialog.showMessageBox=async function(_window,options){
  globalThis.ccuUpdateFixture.prompts.push({type:options.type,message:options.message,detail:options.detail,buttons:options.buttons,defaultId:options.defaultId});
  return {response:globalThis.ccuUpdateFixture.answer};
};
shell.openExternal=async function(url){
  const state=globalThis.ccuUpdateFixture;
  if(state.browserFailure)throw Error('Synthetic browser failure');
  state.opened.push(url);
};
app.on('quit',(_event,exitCode)=>fs.writeFileSync(${JSON.stringify(exitReport)},JSON.stringify({
  exitCode,windows:BrowserWindow.getAllWindows().length,
  rsi:globalThis.ccuAutomaticStart.snapshot(),update:globalThis.ccuUpdateFixture
})));
require(${JSON.stringify(path.join(appFolder,'main.cjs'))});
`);
const env={...process.env,TEMP:path.join(folder,'temp'),TMP:path.join(folder,'temp')};
fs.mkdirSync(env.TEMP,{recursive:true});
delete env.ELECTRON_RUN_AS_NODE;delete env.NODE_OPTIONS;
const checks=[];
let application,child;
async function until(check,message){
  const deadline=Date.now()+15000;
  while(Date.now()<deadline){if(await check())return;await new Promise(resolve=>setTimeout(resolve,50));}
  throw Error(message);
}
try{
  application=await _electron.launch({executablePath:require('electron'),cwd:root,
    args:[entry,'--data-dir='+path.join(folder,'data'),'--disable-gpu','--disable-background-networking',
      '--host-resolver-rules=MAP * ~NOTFOUND','--proxy-server=http://127.0.0.1:9'],env});
  child=application.process();
  const page=await application.firstWindow();
  await page.getByRole('button',{name:'Update verfügbar · 0.4.0 Alpha',exact:true}).click();
  const notice=page.getByRole('dialog',{name:'Update verfügbar',exact:true});
  const download=notice.getByRole('button',{name:'GitHub öffnen und Planer beenden',exact:true});
  await page.setViewportSize({width:1024,height:700});
  await notice.getByText(/Nach deiner Bestätigung öffnet sich GitHub/).waitFor();
  const fits=await notice.evaluate(element=>{
    const dialog=element.getBoundingClientRect(),button=element.querySelector('.dialog-actions .primary').getBoundingClientRect();
    return dialog.left>=0&&dialog.right<=innerWidth&&button.left>=dialog.left&&button.right<=dialog.right;
  });
  assert.equal(fits,true,'The update warning and its action must fit at 1024px');
  await notice.screenshot({path:path.join(folder,'update-warning.png')});
  await notice.getByText(/Nach deiner Bestätigung öffnet sich GitHub/).waitFor();
  await download.click();
  await until(()=>application.evaluate(()=>globalThis.ccuUpdateFixture.prompts.length===1),'Update confirmation was not shown');
  assert.equal(child.exitCode,null);
  const first=await application.evaluate(()=>globalThis.ccuUpdateFixture);
  assert.deepEqual(first.opened,[]);
  assert.equal(first.prompts[0].defaultId,0);
  assert.equal(first.prompts[0].type,'warning');
  assert.match(first.prompts[0].detail,/Windows-Infobereich/);
  checks.push('Cancel retains the app and the tray without opening a browser');
  await application.evaluate(()=>{globalThis.ccuUpdateFixture.answer=1;globalThis.ccuUpdateFixture.browserFailure=true;});
  await download.click();
  await notice.getByRole('alert').waitFor();
  assert.equal(child.exitCode,null);
  assert.deepEqual(await application.evaluate(()=>globalThis.ccuUpdateFixture.opened),[]);
  checks.push('A browser launch error retains the app and displays an error');
  await application.evaluate(()=>{globalThis.ccuUpdateFixture.browserFailure=false;});
  await download.click();
  await until(()=>child.exitCode!==null,'The actual application did not quit after confirmation');
  assert.equal(child.exitCode,0);
  const result=JSON.parse(fs.readFileSync(exitReport,'utf8'));
  assert.deepEqual(result.update.opened,['https://github.com/Nitrolaus/Sarevocs-CCU-Planer/releases/tag/v0.4.0-alpha']);
  assert.equal(result.windows,0);
  assert.equal(result.rsi.shutdowns,1);
  assert.equal(result.rsi.connect.length,0);
  assert.equal(result.update.releaseReads,1);
  checks.push('Confirmation opens only the known release and finishes actual application shutdown');
  checks.push('No remaining window, no interactive RSI login, session shutdown completed, one startup release check');
  fs.writeFileSync(path.join(folder,'results.json'),JSON.stringify({status:'PASS',checks,realUserData:false,realNetwork:false},null,2));
  checks.forEach(check=>console.log('PASS: '+check));
  console.log('REPORT: '+path.join(folder,'results.json'));
}finally{
  if(application&&child?.exitCode===null){
    await application.evaluate(({app})=>{globalThis.ccuAutomaticStart.releaseAll();app.quit();}).catch(()=>{});
  }
  if(application)await application.close().catch(()=>{});
}
