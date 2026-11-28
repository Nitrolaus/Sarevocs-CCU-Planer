import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {createRequire} from 'node:module';
import {build} from 'esbuild';import {_electron} from 'playwright-core';
const root=process.cwd(),folder=path.resolve('work/temp/fleetyards-ui',randomUUID());fs.mkdirSync(folder,{recursive:true});
if(!process.env.CCU_TEST_ASAR)throw Error('Packaged renderer required');const asar=path.resolve(process.env.CCU_TEST_ASAR);
const code=`import {app,dialog,BrowserWindow} from 'electron';import path from 'node:path';import fs from 'node:fs';
import {InventoryStore} from './src/storage/database';import {LastSeenStore} from './src/storage/last-seen';import {reportFixture} from './tests/fixtures/report-data';
const folder=__dirname,root=${JSON.stringify(asar)};app.disableHardwareAcceleration();app.commandLine.appendSwitch('proxy-server','http://127.0.0.1:9');app.commandLine.appendSwitch('host-resolver-rules','MAP * ~NOTFOUND');
globalThis.fleetTest={target:null,requests:[],hold:false,resolve:null,urls:[]};const test=globalThis.fleetTest;
dialog.showSaveDialog=async(_parent,options)=>{test.requests.push(options);if(test.hold)await new Promise(r=>test.resolve=r);return test.target?{canceled:false,filePath:test.target}:{canceled:true};};
dialog.showErrorBox=(_title,message)=>{fs.writeFileSync(path.join(folder,'fatal.json'),JSON.stringify({message}));app.exit(2)};
app.on('browser-window-created',(_e,win)=>{if(!test.showWindow){test.showWindow=win.show.bind(win);test.hideWindow=win.hide.bind(win)}win.show=()=>{};win.showInactive=()=>{};win.webContents.on('did-start-navigation',(_e,url)=>{if(/^https?:/.test(url))test.urls.push(url)});});
app.whenReady().then(async()=>{const input=reportFixture(),data=path.join(folder,'data','Daten');fs.mkdirSync(data,{recursive:true});
const db=await InventoryStore.open(path.join(data,'inventory.sqlite'),fs.readFileSync(path.join(root,'build/sql-wasm.wasm'))),account=db.createAccount('SYNTHETIC FLEET TEST','real'),other=db.createAccount('SYNTHETIC OTHER PROFILE','real');test.account=account.id;test.other=other.id;
const catalogue=[...input.market.catalogue.ships,{...input.market.catalogue.ships[0],id:6,name:'Eclipse',manufacturer:'Aegis Dynamics'}];
const template=input.inventory.items[0].pledge,pledges=Array.from({length:240},(_,i)=>({...template,pledgeId:String(i+1000),name:'Synthetic '+i,ships:[{...template.ships[0],childId:'ship',modelName:i===239?'Unresolved model':catalogue[i%catalogue.length].name}],sourceValues:{session:'SECRET_MUST_STAY_LOCAL',date:'November 18, 2026'}}));
const doc={type:'sarevocs-ccu-inventory',schemaVersion:1,appVersion:'TEST',createdAt:input.now,dataMode:'real',account:{reference:'rsi-local:'+account.id,identityKind:'manual-reference'},scope:{kind:'partial',exportComplete:false,expectedPledges:null,pagesExpected:null,pagesRead:1},pledges,buybacks:[]};
const views=new LastSeenStore(path.join(data,'LetzterStand'));views.save(account,{adapter:'rsi-dom-probe/1',document:doc,digest:'synthetic',warnings:[],completeness:'partial',evidence:'scope-unverified'});views.select(account.id);db.close();
const market=path.join(data,'Marktdaten');fs.mkdirSync(market,{recursive:true});fs.writeFileSync(path.join(market,'public-v1.json'),JSON.stringify({schemaVersion:1,catalogue:{fetchedAt:input.now,ships:catalogue},offers:input.market.offers}));
const display=path.join(data,'Anzeige');fs.mkdirSync(display,{recursive:true});fs.writeFileSync(path.join(display,'display-v1.json'),JSON.stringify(input.display.settings));
require(path.join(root,'build/main.cjs'));});`;
await build({stdin:{contents:code,resolveDir:root,loader:'ts'},outfile:path.join(folder,'main.cjs'),bundle:true,platform:'node',format:'cjs',external:['electron','sql.js']});
const env={...process.env,TEMP:path.join(folder,'tmp'),TMP:path.join(folder,'tmp')};fs.mkdirSync(env.TEMP,{recursive:true});delete env.ELECTRON_RUN_AS_NODE;delete env.NODE_OPTIONS;
let app;const checks=[],errors=[];const check=async(name,fn)=>{await fn();checks.push(name);console.log('PASS: '+name)};
try{
 app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),args:[path.join(folder,'main.cjs'),'--data-dir='+path.join(folder,'data'),'--disable-gpu'],env,timeout:30000});
 const page=await app.firstWindow();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));await page.getByRole('heading',{name:'Bestand',exact:true}).waitFor();
 const dialog=page.locator('dialog.export-dialog'),open=async()=>{await page.getByRole('button',{name:'Exportieren …',exact:true}).click();await dialog.getByRole('button',{name:'FleetYards (.json)',exact:true}).click();await dialog.getByRole('heading',{name:'Das gibst du weiter'}).waitFor()};
 await check('REAL_MAIN_PREPARES_240_LOCAL_SHIPS_WITH_EMPTY_DEFAULT_SELECTION',async()=>{await open();await dialog.getByText('0 von 240 im Export',{exact:true}).waitFor();assert.equal(await dialog.getByRole('button',{name:'JSON-Datei speichern …'}).isDisabled(),true);});
 await check('SEARCH_COPY_SELECTION_AND_REAL_JSON_AGREE',async()=>{
  await dialog.getByRole('searchbox',{name:'Schiffe durchsuchen'}).fill('Eclipse');await dialog.getByRole('button',{name:'Treffer übernehmen',exact:true}).click();
  await dialog.getByRole('checkbox',{name:'Eclipse, Exemplar 2 in Export aufnehmen',exact:true}).uncheck();
  await dialog.getByText('38 von 240 im Export',{exact:true}).waitFor();
  await dialog.getByRole('button',{name:/Dateivorschau/}).click();const rows=JSON.parse(await dialog.locator('pre').innerText());assert.equal(rows.length,38);
  assert.ok(rows.every(s=>s.name==='Eclipse'&&s.cost===''&&s.pledge_date===''&&Object.keys(s).join(',')==='manufacturer,name,lti,warbond,package_id,pledge,pledge_date,cost'));
  assert.equal(await dialog.getByRole('combobox',{name:'Alle Schiffe: Preis',exact:true}).inputValue(),'hidden');
  assert.equal(await dialog.getByRole('combobox',{name:'Alle Schiffe: Datum',exact:true}).inputValue(),'hidden');
 });
 await check('CUSTOM_VALUES_AND_PER_SHIP_OVERRIDES_MATCH_THE_FILE_AND_SURVIVE_PAGING',async()=>{
  await dialog.getByRole('combobox',{name:'Alle Schiffe: Preis',exact:true}).selectOption('custom');
  assert.equal(await dialog.getByRole('button',{name:'JSON-Datei speichern …'}).isDisabled(),true);
  await dialog.getByRole('textbox',{name:'Alle Schiffe: Preis · Ersatzwert',exact:true}).fill('12,34');
  await dialog.getByRole('combobox',{name:'Alle Schiffe: Preis · Währung',exact:true}).selectOption('GBP');
  await dialog.getByRole('combobox',{name:'Alle Schiffe: Datum',exact:true}).selectOption('custom');
  await dialog.locator('input[aria-label="Alle Schiffe: Datum · Ersatzdatum"]').fill('2030-05-04');
  await dialog.getByRole('button',{name:'Eclipse · Exportpreis bearbeiten',exact:true}).first().click();
  await dialog.getByRole('combobox',{name:'Schiff: Preis',exact:true}).selectOption('hidden');
  await dialog.getByRole('combobox',{name:'Schiff: Datum',exact:true}).selectOption('hidden');
  let rows=JSON.parse(await dialog.locator('pre').innerText());
  assert.equal(rows.filter(s=>s.cost===''&&s.pledge_date==='').length,1);
  assert.equal(rows.filter(s=>s.cost==='£12.34 GBP'&&s.pledge_date==='May 4, 2030').length,37);
  await dialog.getByRole('button',{name:'Nächste Seite'}).click();await dialog.getByRole('button',{name:'Vorherige Seite'}).click();
  assert.deepEqual(JSON.parse(await dialog.locator('pre').innerText()),rows);
  await dialog.getByRole('combobox',{name:'Schiff: Preis',exact:true}).selectOption('custom');
  await dialog.getByRole('textbox',{name:'Schiff: Preis · Ersatzwert',exact:true}).fill('1,234');
  assert.equal(await dialog.getByRole('button',{name:'JSON-Datei speichern …'}).isDisabled(),true);
  await dialog.getByRole('textbox',{name:'Schiff: Preis · Ersatzwert',exact:true}).fill('0');
  rows=JSON.parse(await dialog.locator('pre').innerText());assert.equal(rows[0].cost,'$0.00 USD');
  await dialog.getByRole('button',{name:'Zurücksetzen',exact:true}).click();
  rows=JSON.parse(await dialog.locator('pre').innerText());assert.ok(rows.every(s=>s.cost==='£12.34 GBP'));
  await dialog.getByRole('combobox',{name:'Alle Schiffe: Preis',exact:true}).selectOption('hidden');
  await dialog.getByRole('combobox',{name:'Alle Schiffe: Datum',exact:true}).selectOption('hidden');
 });
 await check('CANCEL_AND_INVALID_EXTENSION_KEEP_SELECTION_AND_WRITE_NOTHING',async()=>{
  await dialog.getByRole('button',{name:'JSON-Datei speichern …'}).click();await dialog.getByRole('button',{name:'JSON-Datei speichern …'}).waitFor({state:'visible'});
  await app.evaluate(({},target)=>globalThis.fleetTest.target=target,path.join(folder,'invalid.exe'));
  await dialog.getByRole('button',{name:'JSON-Datei speichern …'}).click();await dialog.getByRole('alert').filter({hasText:/Dateiendung/}).waitFor();assert.equal(fs.existsSync(path.join(folder,'invalid.exe')),false);
 });
 await check('SAVED_JSON_MATCHES_VISIBLE_PREVIEW_WITHOUT_PROFILE_SECRETS',async()=>{
  const file=path.join(folder,'fleet.json');await app.evaluate(({},target)=>globalThis.fleetTest.target=target,file);
  await dialog.getByRole('button',{name:'JSON-Datei speichern …'}).click();await dialog.waitFor({state:'hidden'});
  const text=fs.readFileSync(file,'utf8'),rows=JSON.parse(text);assert.equal(rows.length,38);assert.doesNotMatch(text,/SECRET|SYNTHETIC|account|profile|serial|token|reference/i);
  assert.ok(rows.every(s=>s.cost===''&&s.pledge_date===''));assert.equal(new Set(rows.map(s=>s.package_id)).size,38);
 });
 await check('COMPACT_TABLE_LAYOUT_AT_1440_1024_AND_125_PERCENT',async()=>{
  await open();await dialog.getByRole('button',{name:'Treffer übernehmen',exact:true}).click();
  await app.evaluate(()=>globalThis.fleetTest.showWindow());
  for(const [width,zoom]of [[1440,1],[1024,1],[1280,1.25]]){
   await page.setViewportSize({width,height:1000});await app.evaluate(({BrowserWindow},zoom)=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/index.html')).webContents.setZoomFactor(zoom),zoom);
   const shape=await dialog.evaluate(d=>{const r=d.getBoundingClientRect(),save=d.querySelector('.fy-footer button.primary').getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight,saveBottom:save.bottom,overflow:d.scrollWidth>d.clientWidth+1,checkboxWidth:d.querySelector('thead th').getBoundingClientRect().width,rows:[...d.querySelectorAll('tbody tr')].map(tr=>tr.getBoundingClientRect().height)}});
   assert.ok(shape.left>=0&&shape.top>=0&&shape.right<=shape.width+1&&shape.bottom<=shape.height+1&&!shape.overflow&&shape.saveBottom<=shape.height+1,JSON.stringify(shape));
   assert.ok(shape.checkboxWidth>=37&&shape.checkboxWidth<=45,JSON.stringify(shape));assert.ok(shape.rows.every(n=>n>=34&&n<=38),JSON.stringify(shape.rows));await page.screenshot({path:path.join(folder,'fleet-'+width+'-'+zoom+'.png')});
  }
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/index.html')).webContents.setZoomFactor(1));await page.setViewportSize({width:1440,height:1000});
  await app.evaluate(()=>globalThis.fleetTest.hideWindow());
 });
 await check('CUSTOM_DISCLOSURES_SAVE_THROUGH_REAL_IPC_AND_DEFAULTS_RESET_ON_REOPEN',async()=>{
  await dialog.getByRole('combobox',{name:'Alle Schiffe: Preis',exact:true}).selectOption('custom');
  await dialog.getByRole('textbox',{name:'Alle Schiffe: Preis · Ersatzwert',exact:true}).fill('10,00');
  await dialog.getByRole('combobox',{name:'Alle Schiffe: Preis · Währung',exact:true}).selectOption('EUR');
  await dialog.getByRole('combobox',{name:'Alle Schiffe: Datum',exact:true}).selectOption('custom');
  await dialog.locator('input[aria-label="Alle Schiffe: Datum · Ersatzdatum"]').fill('2020-01-01');
  await dialog.getByRole('button',{name:'Starter · Exportpreis bearbeiten',exact:true}).first().click();
  await dialog.getByRole('combobox',{name:'Schiff: Preis',exact:true}).selectOption('hidden');
  const target=path.join(folder,'custom-export.json');await app.evaluate(({},target)=>globalThis.fleetTest.target=target,target);
  await dialog.getByRole('button',{name:'JSON-Datei speichern …'}).click();await dialog.waitFor({state:'hidden'});
  const saved=JSON.parse(fs.readFileSync(target,'utf8'));assert.equal(saved.length,239);
  assert.equal(saved.filter(s=>s.cost==='').length,1);assert.equal(saved.filter(s=>s.cost==='€10.00 EUR').length,238);
  assert.ok(saved.every(s=>s.pledge_date==='January 1, 2020'));
  await open();await dialog.getByText('0 von 240 im Export',{exact:true}).waitFor();
  assert.equal(await dialog.getByRole('combobox',{name:'Alle Schiffe: Preis',exact:true}).inputValue(),'hidden');
  assert.equal(await dialog.getByRole('combobox',{name:'Alle Schiffe: Datum',exact:true}).inputValue(),'hidden');
 });
 await check('APPROVED_BORDERLESS_CELLS_AND_CUSTOM_EDITOR_VISIBLE',async()=>{
  await dialog.getByRole('checkbox',{name:'Schiffe dieser Seite auswählen',exact:true}).check();
  await dialog.getByRole('button',{name:'Eclipse · Exportpreis bearbeiten',exact:true}).first().click();
  await dialog.getByRole('combobox',{name:'Schiff: Preis',exact:true}).selectOption('custom');
  await dialog.getByRole('textbox',{name:'Schiff: Preis · Ersatzwert',exact:true}).fill('10,00');
  await dialog.getByRole('combobox',{name:'Schiff: Datum',exact:true}).selectOption('custom');
  await dialog.locator('input[aria-label="Schiff: Datum · Ersatzdatum"]').fill('2020-01-01');
  await app.evaluate(()=>globalThis.fleetTest.showWindow());
  assert.equal(await dialog.locator('.fy-export-value button').first().evaluate(el=>getComputedStyle(el,'::after').display),'none');
  await page.screenshot({path:path.join(folder,'implemented-custom.png')});
  await app.evaluate(()=>globalThis.fleetTest.hideWindow());
 });
 await check('FOREIGN_RECEIPT_AND_PROFILE_SWITCH_DURING_SAVE_ARE_REJECTED',async()=>{
  const ids=await app.evaluate(()=>({account:globalThis.fleetTest.account,other:globalThis.fleetTest.other}));
  const receipt=await page.evaluate(async id=>window.ccu.request({action:'fleetyards.preview',accountId:id}),ids.account);assert.equal(receipt.ok,true);
  const selection=receipt.data.ships.filter(s=>s.catalogueName).slice(0,1).map(s=>s.key),options={customShipNames:false,paints:false};
  const foreign=await page.evaluate(async cmd=>window.ccu.request(cmd),{action:'fleetyards.save',accountId:ids.other,token:receipt.data.token,selected:selection,options});assert.equal(foreign.ok,false);
  const target=path.join(folder,'profile-switch.json');fs.writeFileSync(target,'UNCHANGED');await app.evaluate(({},target)=>{globalThis.fleetTest.target=target;globalThis.fleetTest.hold=true},target);
  await page.evaluate(cmd=>{window.testFleetSave=window.ccu.request(cmd)}, {action:'fleetyards.save',accountId:ids.account,token:receipt.data.token,selected:selection,options});
  await app.evaluate(async()=>{for(let i=0;i<100&&!globalThis.fleetTest.resolve;i++)await new Promise(r=>setTimeout(r,10));if(!globalThis.fleetTest.resolve)throw Error('SAVE_NOT_HELD')});
  await page.evaluate(async id=>window.ccu.request({action:'account.select',accountId:id}),ids.other);
  await app.evaluate(()=>{globalThis.fleetTest.hold=false;globalThis.fleetTest.resolve();globalThis.fleetTest.resolve=null});
  assert.equal((await page.evaluate(()=>window.testFleetSave)).ok,false);assert.equal(fs.readFileSync(target,'utf8'),'UNCHANGED');
 });
 await check('NO_RSI_LOGIN_NETWORK_MUTATION_OR_LEFTOVER_WINDOWS',async()=>{
  assert.deepEqual(errors,[]);const observed=await app.evaluate(({BrowserWindow})=>({windows:BrowserWindow.getAllWindows().length,urls:globalThis.fleetTest.urls}));assert.equal(observed.windows,1);assert.deepEqual(observed.urls,[]);
 });
 fs.writeFileSync(path.join(folder,'results.json'),JSON.stringify({status:'PASS',checks,errors,packaged:asar.endsWith('.asar'),actualMain:true,realUserData:false,newRsiLogin:false,externalUpload:false},null,2));
}catch(error){fs.writeFileSync(path.join(folder,'results.json'),JSON.stringify({status:'FAIL',checks,errors,error:String(error)},null,2));throw error}finally{if(app)await app.close();console.log('REPORT: '+path.join(folder,'results.json'));}
