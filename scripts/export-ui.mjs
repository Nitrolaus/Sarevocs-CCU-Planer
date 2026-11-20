import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {build} from 'esbuild';import {_electron} from 'playwright-core';import {createRequire} from 'node:module';
import ExcelJS from 'exceljs';
const folder=path.resolve('work/temp/export-ui',randomUUID()),root=process.cwd();fs.mkdirSync(folder,{recursive:true});
const appRoot=process.env.CCU_TEST_ASAR?path.resolve(process.env.CCU_TEST_ASAR):root;
const code=`import {app,dialog,BrowserWindow} from 'electron';import path from 'node:path';import fs from 'node:fs';
import {InventoryStore} from './src/storage/database';import {LastSeenStore} from './src/storage/last-seen';import {PlannerDraftStore} from './src/planner/draft-store';import {MarketService} from './src/market/service';import {reportFixture} from './tests/fixtures/report-data';
const folder=__dirname,root=${JSON.stringify(appRoot)};app.disableHardwareAcceleration();app.commandLine.appendSwitch('proxy-server','http://127.0.0.1:9');app.commandLine.appendSwitch('host-resolver-rules','MAP * ~NOTFOUND');
globalThis.reportTest={target:null,requests:[],blockedUrls:[],hold:false,resolve:null};
const fixture=globalThis.reportTest;
dialog.showSaveDialog=async(_parent,options)=>{fixture.requests.push(options);if(fixture.hold)await new Promise(r=>fixture.resolve=r);return fixture.target?{canceled:false,filePath:fixture.target}:{canceled:true};};
dialog.showErrorBox=(_title,message)=>{fs.writeFileSync(path.join(folder,'fatal.json'),JSON.stringify({message}));app.exit(2);};
app.on('browser-window-created',(_event,win)=>{if(!fixture.showWindow){fixture.showWindow=win.show.bind(win);fixture.hideWindow=win.hide.bind(win);}win.show=()=>{};win.showInactive=()=>{};win.webContents.on('did-start-navigation',(_e,url)=>{if(/^https?:/.test(url))fixture.blockedUrls.push('remote');});});
app.whenReady().then(async()=>{const input=reportFixture(),data=path.join(folder,'data','Daten');fs.mkdirSync(data,{recursive:true});const db=await InventoryStore.open(path.join(data,'inventory.sqlite'),fs.readFileSync(path.join(root,'build/sql-wasm.wasm')));
const account=db.createAccount('SYNTHETIC EXPORT PROFILE','real'),other=db.createAccount('SYNTHETIC SECOND PROFILE','real');fixture.accountId=account.id;fixture.otherId=other.id;
input.inventory.items[0].pledge.sourceValues.items=JSON.stringify([{title:'Synthetic Copper Paint',kind:'Skin'}]);
input.inventory.items.push({...input.inventory.items[0],pledge:{...input.inventory.items[0].pledge,pledgeId:'synthetic-paint',name:'Synthetic standalone paint',ships:[],
 sourceValues:{items:JSON.stringify([{title:'Synthetic standalone paint',kind:'Skin'}]),meltable:'true'}}});
const views=new LastSeenStore(path.join(data,'LetzterStand'));const doc={type:'sarevocs-ccu-inventory',schemaVersion:1,appVersion:'TEST',createdAt:input.now,dataMode:'real',account:{reference:'rsi-local:'+account.id,identityKind:'manual-reference'},scope:{kind:'partial',exportComplete:false,expectedPledges:null,pagesExpected:null,pagesRead:1},pledges:input.inventory.items.map(i=>i.pledge),
 buybacks:[{entryId:'synthetic-b',name:'Test Buy Back',description:'SECRET_NOT_FOR_REPORT',availability:'unverified',currentPrice:{minor:13000,currency:'USD',taxBasis:'net',evidence:'synthetic'},insurance:{kind:'lti',evidence:'synthetic'},originalShips:['B']}],
 buybackObservation:{observedAt:input.now,token:'available',current:true},storeCredit:{minor:5000,currency:'USD',observedAt:input.now,source:'rsi-credit-ledger'}};
views.save(account,{adapter:'rsi-dom-probe/1',document:doc,digest:'synthetic',warnings:[],completeness:'partial',evidence:'scope-unverified'});views.select(account.id);db.close();
const dir=path.join(data,'Marktdaten');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'public-v1.json'),JSON.stringify({schemaVersion:1,catalogue:input.market.catalogue,offers:input.market.offers}));
fs.writeFileSync(path.join(dir,'ship-values-v1.json'),JSON.stringify({schemaVersion:1,source:'rsi-from-ships',fetchedAt:input.now,currency:'USD',taxBasis:'net',items:input.market.offers.items.map(o=>({id:o.toShipId,name:o.targetName,minor:o.regularMinor}))}));
const market=new MarketService(dir,async()=>{throw Error('OFFLINE')});market.setTargets(account.id,[4,5,null]);new PlannerDraftStore(path.join(data,'Planungen')).save(account.id,4,input.chain.draft);
const display=path.join(data,'Anzeige');fs.mkdirSync(display,{recursive:true});fs.writeFileSync(path.join(display,'display-v1.json'),JSON.stringify(input.display.settings));fs.writeFileSync(path.join(display,'ecb-v1.json'),JSON.stringify(input.display.rate));
require(path.join(root,'build/main.cjs'));});`;
await build({stdin:{contents:code,resolveDir:root,loader:'ts'},outfile:path.join(folder,'main.cjs'),bundle:true,platform:'node',format:'cjs',external:['electron','sql.js']});
const env={...process.env,TEMP:path.join(folder,'tmp'),TMP:path.join(folder,'tmp')};fs.mkdirSync(env.TEMP,{recursive:true});delete env.ELECTRON_RUN_AS_NODE;delete env.NODE_OPTIONS;
let app;const checks=[],errors=[];const check=async(name,fn)=>{await fn();checks.push(name);console.log('PASS: '+name);};
const launch=()=>_electron.launch({executablePath:createRequire(import.meta.url)('electron'),args:[path.join(folder,'main.cjs'),'--data-dir='+path.join(folder,'data'),'--disable-gpu'],env,timeout:30000});
try{
 app=await launch();
 const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000);await page.getByRole('heading',{name:'Bestand',exact:true}).waitFor();
 const dialog=page.locator('dialog.export-dialog'),open=()=>page.getByRole('button',{name:'Exportieren …',exact:true}).click(),box=name=>dialog.getByRole('checkbox',{name,exact:true}),save=()=>dialog.getByRole('button',{name:'Speicherort wählen …',exact:true});
 await check('ACTUAL_MAIN_EXPORTS_ONLY_SELECTED_CACHED_INVENTORY_PAINT_AND_BUY_BACK_SHEETS',async()=>{
  await open();await box('CCUs im Bestand').uncheck();await box('Schiffe & Fahrzeuge').check();await box('Paints').check();await box('Buy Back').check();
  await box('Im Schiffspaket').check();
  await dialog.getByText('Excel · 3 Tabellenblätter',{exact:true}).waitFor();
  const file=path.join(folder,'actual-main.xlsx');await app.evaluate(({},target)=>{globalThis.reportTest.target=target;},file);
  await save().click();await dialog.waitFor({state:'hidden'});
  const book=new ExcelJS.Workbook();await book.xlsx.readFile(file);
  assert.deepEqual(book.worksheets.map(sheet=>sheet.name),['Schiffe & Fahrzeuge','Paints','Buy Back']);
  assert.match(JSON.stringify(book.getWorksheet('Paints').getSheetValues()),/Synthetic Copper Paint.*Im Schiffspaket – geschützt/);
  const values=JSON.stringify(book.worksheets.map(sheet=>sheet.getSheetValues()));
  assert.match(values,/SYNTHETIC LTI token/);assert.match(values,/Test Buy Back/);
  assert.doesNotMatch(values,/SECRET_NOT_FOR_REPORT|SYNTHETIC WARBOND A to B|Synthetic standalone paint/);
  assert.match(JSON.stringify(book.getWorksheet('Paints').getSheetValues()),/Unterfilter · Im Schiffspaket/);
 });
 await check('CANCEL_NATIVE_SAVE_PRESERVES_PREVIEW_AND_PDF_SUCCESS_CLOSES_DIALOG',async()=>{await open();await save().waitFor({state:'visible'});await app.evaluate(()=>{globalThis.reportTest.target=null;});await save().click();await page.waitForFunction(()=>!document.querySelector('.export-dialog button.primary:last-child')?.disabled);assert.equal(await dialog.isVisible(),true);const file=path.join(folder,'actual-main.pdf');await app.evaluate(({},target)=>{globalThis.reportTest.target=target;},file);await dialog.getByRole('button',{name:'PDF',exact:true}).click();await save().click();await dialog.waitFor({state:'hidden'});assert.equal(fs.readFileSync(file).subarray(0,5).toString(),'%PDF-');});
 await check('FAILED_SAVE_STAYS_OPEN_AND_WRONG_EXTENSION_IS_REJECTED',async()=>{await open();await app.evaluate(({},target)=>{globalThis.reportTest.target=target;},path.join(folder,'wrong.exe'));await save().click();await dialog.getByRole('alert').filter({hasText:/Dateiendung/}).waitFor();assert.equal(fs.existsSync(path.join(folder,'wrong.exe')),false);await dialog.getByRole('button',{name:'Abbrechen',exact:true}).click();});
 await check('ACTIVE_CHAIN_CONTEXT_AND_OFFERS_ARE_PRINTED_AS_SEPARATE_PDF_SECTIONS',async()=>{
  await page.getByRole('button',{name:/CCU-Planer/}).click();await page.getByRole('heading',{name:'CCU-Planer',exact:true}).waitFor();
  await page.waitForTimeout(300);await open();assert.equal(await box('Aktuelle CCU-Kette').isChecked(),true);
  await box('Noch zu kaufen').check();await box('Messeangebote').check();await box('Mit Warbond').check();
  await dialog.getByRole('button',{name:'PDF',exact:true}).click();
  await dialog.getByText('PDF · 2 Abschnitte',{exact:true}).waitFor();
  const file=path.join(folder,'combined.pdf');await app.evaluate(({},target)=>{globalThis.reportTest.target=target;},file);
  await save().click();await dialog.waitFor({state:'hidden'});
  const pdf=fs.readFileSync(file).toString('latin1');
  assert.equal(pdf.slice(0,5),'%PDF-');assert.ok((pdf.match(/\/Type \/Page\b/g)??[]).length>=2);
 });
 await check('START_BASIS_COMPARISON_USES_CACHED_BUY_BACK_WITHOUT_CHANGING_DRAFT',async()=>{
  const panel=page.locator('.start-basis-comparison');
  await panel.locator(':scope > summary').click();
  await panel.getByLabel('Buy-Back-Basis',{exact:true}).selectOption('synthetic-b');
  const hangar=panel.getByRole('article',{name:'Hangar'}),buyback=panel.getByRole('article',{name:'Buy Back'});
  await buyback.getByText('1 fehlender CCU',{exact:true}).waitFor();
  await hangar.getByText('2 fehlende CCUs',{exact:true}).waitFor();
  assert.match(await buyback.innerText(),/130,00/);
  assert.equal(await hangar.getByText('Offen',{exact:true}).count()>=2,true);
  assert.equal(await buyback.getByText('Offen',{exact:true}).count()>=2,true);
  await page.setViewportSize({width:1440,height:1000});
  assert.equal(await panel.locator('.start-basis-card').evaluateAll(cards=>new Set(cards.map(card=>card.getBoundingClientRect().top)).size),1);
  assert.equal(await page.getByRole('heading',{name:'CCU-Kette → Galaxy'}).count(),1);
 });
 await check('DIALOG_LAYOUT_1440_1024_125PCT_AND_KEYBOARD_DISMISS',async()=>{await open();await app.evaluate(()=>globalThis.reportTest.showWindow());for(const [width,zoom]of [[1440,1],[1024,1],[1024,1.25]]){await page.setViewportSize({width,height:1000});await app.evaluate(({BrowserWindow},factor)=>{BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/index.html'))?.webContents.setZoomFactor(factor);},zoom);await page.waitForTimeout(80);const rect=await dialog.evaluate(d=>({x:d.getBoundingClientRect().x,y:d.getBoundingClientRect().y,right:d.getBoundingClientRect().right,bottom:d.getBoundingClientRect().bottom,screenW:innerWidth,screenH:innerHeight,overflow:d.scrollWidth>d.clientWidth}));assert.ok(rect.x>=0&&rect.y>=0&&rect.right<=rect.screenW+1&&rect.bottom<=rect.screenH+1&&!rect.overflow,JSON.stringify(rect));await page.screenshot({path:path.join(folder,'dialog-'+width+'-'+zoom+'.png')});}await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});await app.evaluate(({BrowserWindow})=>{for(const w of BrowserWindow.getAllWindows())w.webContents.setZoomFactor(1);});await page.setViewportSize({width:1440,height:1000});});
 await check('STRICT_MAIN_REJECTS_FOREIGN_PROFILE_AND_CONCURRENT_SAVE',async()=>{const ids=await app.evaluate(()=>({id:globalThis.reportTest.accountId,other:globalThis.reportTest.otherId}));const preview=await page.evaluate(async id=>window.ccu.request({action:'report.preview',accountId:id,kind:'inventory'}),ids.id);assert.ok(preview.ok);const foreign=await page.evaluate(async args=>window.ccu.request({action:'report.save',accountId:args.other,token:args.token,format:'xlsx'}),{other:ids.other,token:preview.data.token});assert.equal(foreign.ok,false);await app.evaluate(()=>{globalThis.reportTest.hold=true;globalThis.reportTest.target=null;});await page.evaluate(args=>{window.testSave=window.ccu.request({action:'report.save',accountId:args.id,token:args.token,format:'xlsx'});}, {id:ids.id,token:preview.data.token});await app.evaluate(async()=>{for(let n=0;n<100&&!globalThis.reportTest.resolve;n++)await new Promise(r=>setTimeout(r,10));if(!globalThis.reportTest.resolve)throw Error('DIALOG_NOT_HELD');});const twice=await page.evaluate(async args=>window.ccu.request({action:'report.save',accountId:args.id,token:args.token,format:'xlsx'}),{id:ids.id,token:preview.data.token});assert.equal(twice.ok,false);await app.evaluate(()=>{globalThis.reportTest.hold=false;globalThis.reportTest.resolve();globalThis.reportTest.resolve=null;});assert.deepEqual(await page.evaluate(()=>window.testSave),{ok:true,data:{exported:false}});});
 await check('ENGLISH_DIALOG_AND_PROFILE_SWITCH_DO_NOT_REUSE_A_PREVIEW',async()=>{const ids=await app.evaluate(()=>({id:globalThis.reportTest.accountId,other:globalThis.reportTest.otherId}));const pricing=await page.evaluate(async()=>window.ccu.request({action:'pricing.status'}));await page.evaluate(async settings=>window.ccu.request({action:'pricing.save',settings}),{...pricing.data.settings,language:'en'});await page.getByRole('button',{name:'Export …',exact:true}).waitFor();await page.getByRole('button',{name:'Export …',exact:true}).click();await dialog.getByRole('heading',{name:'Export',exact:true}).waitFor();await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await page.getByLabel('Local account profile',{exact:true}).selectOption(ids.other);await page.getByRole('button',{name:'Export …',exact:true}).click();await box('Show offers').uncheck();await box('Ships & vehicles').check();await dialog.getByText('No data: Ships & vehicles',{exact:true}).waitFor();await box('Ships & vehicles').uncheck();await dialog.getByText('No sections selected',{exact:true}).waitFor();assert.equal(await dialog.getByRole('button',{name:'Choose save location …'}).isDisabled(),true);await dialog.getByRole('button',{name:'Cancel',exact:true}).click();});
 await check('NO_RSI_LOGIN_WINDOWS_OR_SECRETS_AND_NO_PDF_WINDOWS_LEFT',async()=>{const state=await app.evaluate(({BrowserWindow})=>({windows:BrowserWindow.getAllWindows().map(w=>w.webContents.getURL()),urls:globalThis.reportTest.blockedUrls}));assert.equal(state.windows.length,1);assert.deepEqual(state.urls,[]);assert.deepEqual(errors,[]);assert.equal(await page.locator('dialog[open]').count(),0);});
 await check('COLUMN_WIDTHS_SURVIVE_TAB_CHANGES_AND_ACTUAL_UI_SESSION_RESTART',async()=>{
  const stock=current=>current.locator('aside nav button').first();
  const resize=current=>current.locator('.resizable-inventory [role="separator"]').nth(1);
  await stock(page).click();
  await resize(page).focus();await page.keyboard.press('Home');await page.keyboard.press('ArrowRight');
  await page.waitForFunction(async()=>{const result=await window.ccu.request({action:'table.widths',table:'inventory'});return result.ok&&result.data?.[1]===110;});
  await page.getByRole('button',{name:'Game packages',exact:true}).click();
  assert.equal(await resize(page).getAttribute('aria-valuenow'),'110');
  await app.close();app=await launch();
  const next=await app.firstWindow();
  await resize(next).waitFor();
  await next.waitForFunction(()=>document.querySelectorAll('.resizable-inventory [role="separator"]')[1]?.getAttribute('aria-valuenow')==='110');
  assert.equal(await next.evaluate(()=>localStorage.getItem('ccu.table-widths.v2.inventory')),null);
 });
 fs.writeFileSync(path.join(folder,'results.json'),JSON.stringify({status:'PASS',checks,errors,actualMain:true,packaged:!!process.env.CCU_TEST_ASAR,installedApplicationTouched:false,newRsiLogin:false,realUserData:false},null,2));
}catch(e){fs.writeFileSync(path.join(folder,'results.json'),JSON.stringify({status:'FAIL',checks,error:String(e),errors},null,2));throw e;}finally{if(app)await app.close();fs.writeFileSync('work/temp/export-ui-latest.json',JSON.stringify({folder},null,2));console.log('REPORT: '+path.join(folder,'results.json'));}





