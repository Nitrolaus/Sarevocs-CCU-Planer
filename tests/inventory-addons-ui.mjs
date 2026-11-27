import { _electron } from 'playwright-core';
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { basePledge } from './fixtures.ts';
import { reportFixture } from './fixtures/report-data.ts';
import { extractFile } from '@electron/asar';

const folder=path.resolve('work/temp/addon-category-ui',randomUUID());fs.mkdirSync(folder,{recursive:true});
const packaged=process.env.CCU_TEST_ASAR;
if(packaged)for(const name of ['app.js','app.css'])fs.writeFileSync(path.join(folder,name),extractFile(packaged,path.join('build','renderer',name)));
else await build({entryPoints:['src/ui/App.tsx'],outfile:path.join(folder,'app.js'),bundle:true,platform:'browser',target:'chrome156'});
for(const name of ['app.svg','app.png'])fs.copyFileSync('assets/'+name,path.join(folder,name));
fs.copyFileSync('tests/fixtures/ship-display-preload.cjs',path.join(folder,'fixture-preload.cjs'));
fs.copyFileSync('tests/fixtures/upgrade-history-ui-main.cjs',path.join(folder,'fixture-main.cjs'));
const a='11111111-1111-4111-8111-111111111111',at=new Date().toISOString();
const account={id:a,name:'SYNTHETIC GEAR TEST',mode:'demo',reference:null,identityKind:null,identityStatus:'unbound',lastComplete:null};
const items=Array.from({length:200},(_,i)=>{
 const pledge=basePledge('synthetic-'+i);pledge.name='Synthetic gear bundle '+i;pledge.ships=[];pledge.ccus=[];
 pledge.acquisitionCost=null;delete pledge.rsiPurchase;
 pledge.sourceValues={items:JSON.stringify([
  {title:'Synthetic '+i+' Helmet',kind:'FPS Equipment'},
  {title:'Synthetic '+i+' Arms',kind:'FPS Equipment'},
  {title:'Synthetic '+i+' Rifle',kind:'FPS Equipment'},
  {title:'Synthetic '+i+' Varsity Jacket',kind:'FPS Equipment'},
  {title:'Galaxy - Synthetic Cargo Module '+i,kind:'Component'},
  {title:'Synthetic '+i+' Poster',kind:'FPS Equipment'},
  {title:'Synthetic '+i+' Coin',kind:'FPS Equipment'},
  {title:'Synthetic '+i+' Unknown Relic',kind:'FPS Equipment'},
  {title:'Galaxy - Synthetic Paint '+i,kind:'Skin'},
 ]),alsoContains:'[]'};
 return {pledge,source:'rsi-dom-probe/1',availability:'present',importedAt:at};
});
const fixture={state:{accounts:[account],selectedAccountId:a,dataDir:'Synthetic test folder',version:'LOCAL GEAR FIX',packaged:false,electron:'fixture',node:'fixture'},
 inventories:{[a]:{account,items,buybacks:[]}},views:{},targets:{[a]:[null,null,null]},pricing:reportFixture().display,market:reportFixture().market};
fs.writeFileSync(path.join(folder,'fixture.json'),JSON.stringify(fixture));
fs.writeFileSync(path.join(folder,'index.html'),`<!doctype html><html lang="de"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'none'"><link rel="stylesheet" href="app.css"><div id="root"></div><script src="app.js"></script>`);
const env={...process.env,TEMP:path.join(folder,'tmp'),TMP:path.join(folder,'tmp')};fs.mkdirSync(env.TEMP,{recursive:true});delete env.ELECTRON_RUN_AS_NODE;delete env.NODE_OPTIONS;
let app;const checks=[],errors=[];
try{
 app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),args:[path.join(folder,'fixture-main.cjs'),'--disable-gpu','--disable-background-networking','--host-resolver-rules=MAP * ~NOTFOUND'],env});
 const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));
 await page.getByRole('heading',{name:'Bestand',exact:true}).waitFor();
 const before=await app.evaluate(()=>JSON.stringify(globalThis.fixture.inventories));
 await page.getByRole('button',{name:'Add-ons & Gear',exact:true}).click();
 const rows=page.locator('.addons-table tbody tr[data-addon]');
 async function count(n){await page.waitForFunction(n=>document.querySelectorAll('.addons-table tbody tr[data-addon]').length===n,n);assert.equal(await rows.count(),n);await page.waitForFunction(text=>document.querySelector('output.inventory-search-count')?.textContent===text,n.toLocaleString('de')+' von 1.800 Gegenständen');}
 const kind=page.getByRole('combobox',{name:'Gegenstandsart',exact:true});
 const ship=page.getByRole('combobox',{name:'Zugehöriges Schiff',exact:true});
 const search=page.getByRole('textbox',{name:'Bestand durchsuchen',exact:true});
 await count(1800);checks.push('200 bundles retain 1800 physical item rows');
 await ship.selectOption('none');
 for(const [category,n] of [['armor',400],['weapons',200],['clothing',200],['decorations',200],['collectibles',200],['other',200]]){
  await kind.selectOption(category);await count(n);
  assert.deepEqual(await rows.evaluateAll(nodes=>[...new Set(nodes.map(n=>n.dataset.addonCategory))]),[category]);
  checks.push(category+' works with No ship');
 }
  await kind.selectOption('armor');await search.fill('synthetic 197');await count(2);
 assert.match(await rows.first().innerText(),/Helmet|Arms/);checks.push('search combines with armor and No ship');
 await search.fill('');await ship.selectOption('Galaxy');await count(0);
 await kind.selectOption('modules');await count(200);checks.push('named ship combines with module filter');
 await kind.selectOption('paints');await count(200);checks.push('named ship combines with paint filter');
 await kind.selectOption('armor');await ship.selectOption('none');await count(400);
 const screenshot=path.join(folder,'armor-filter.png');
 await page.screenshot({path:screenshot});
 assert.equal(await app.evaluate(()=>JSON.stringify(globalThis.fixture.inventories)),before);
 const actions=await app.evaluate(()=>globalThis.fixture.commands.map(c=>c.action));
 assert.ok(!actions.some(a=>/^(?:rsi\.(?:authorize|connect|open)|import\.commit|account\.create)$/.test(a)));
 assert.deepEqual(errors,[]);checks.push('no source mutations, new login or renderer errors');
  const report={status:'PASS',packagedRenderer:!!packaged,syntheticOnly:true,realUserFilesRead:false,newRsiLogin:false,checks,screenshot};
 fs.writeFileSync(path.join(folder,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(error){
 fs.writeFileSync(path.join(folder,'report.json'),JSON.stringify({status:'FAIL',syntheticOnly:true,checks,error:String(error.stack)},null,2));
 throw error;
}finally{if(app)await app.close()}
