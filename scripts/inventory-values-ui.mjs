import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {randomUUID,createHash} from 'node:crypto';import {createRequire} from 'node:module';import {build} from 'esbuild';import {_electron} from 'playwright-core';import {extractFile} from '@electron/asar';
const folder=path.resolve('work/temp/inventory-values-ui',randomUUID());fs.mkdirSync(folder,{recursive:true});const packaged=process.env.CCU_TEST_ASAR,version=JSON.parse(fs.readFileSync('package.json','utf8')).version;
if(packaged)for(const name of ['app.js','app.css'])fs.writeFileSync(path.join(folder,name),extractFile(packaged,path.normalize('build/renderer/'+name)));else await build({entryPoints:['src/ui/App.tsx'],outfile:path.join(folder,'app.js'),bundle:true,platform:'browser',target:'chrome156'});
for(const name of ['app.svg','app.png'])fs.copyFileSync('assets/'+name,path.join(folder,name));fs.copyFileSync('tests/fixtures/ship-display-preload.cjs',path.join(folder,'fixture-preload.cjs'));
let main=fs.readFileSync('tests/fixtures/upgrade-history-ui-main.cjs','utf8'),anchor='  fixture.commands.push(copy(command));';assert.equal(main.split(anchor).length,2);main=main.replace(anchor,anchor+`
  if(command.action==='market.status')return {ok:true,data:copy(fixture.market)};
  if(command.action==='pricing.status')return {ok:true,data:copy(fixture.pricing)};
  if(command.action==='inventory.giveaways'){
    const byAccount=fixture.giveaways??={};
    const notes=byAccount[command.accountId]??={};
    if(command.edit){
      if(command.edit.organizer)notes[command.edit.pledgeId]=command.edit.organizer;
      else delete notes[command.edit.pledgeId];
    }
    return {ok:true,data:{accountId:command.accountId,entries:Object.entries(notes).map(([pledgeId,organizer])=>({pledgeId,organizer}))}};
  }`);fs.writeFileSync(path.join(folder,'fixture-main.cjs'),main);
const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222',at=new Date().toISOString(),account=id=>({id,name:'SYNTHETIC '+id[0],mode:'real',reference:null,identityKind:null,identityStatus:'unbound',lastComplete:null});
const child=(name,id)=>({childId:id,modelName:name,modelId:null,identity:'unresolved',role:'unverified'}),pledge=(id,names,value)=>({pledgeId:id,name:'SYNTHETIC PLEDGE '+id,insurance:{kind:'lti',evidence:'Synthetic'},originalDescription:'',ships:names.map((n,i)=>child(n,id+'-'+i)),ccus:[],protected:true,baseReleased:false,restrictions:[],acquisitionCost:null,unknownCostReason:'Synthetic unknown',meltValue:null,sourceValues:{pledgeValue:value,date:'Nov 14, 2026'}});
const entries=[pledge('1001',['Prospector'],'$95.00 USD'),pledge('1002',['Ursa','Dragonfly'],'$160.00 USD'),pledge('1003',['Reward Ship'],'$0.00 USD'),pledge('1004',['600i Touring Module'],'3500')];entries[0].insurance={kind:'months',months:6,evidence:'Synthetic'};entries[0].sourceValues.alsoContains=JSON.stringify([{title:'Star Citizen Digital Download'},{title:'Squadron 42 Digital Download'}]);
const starlite={...pledge('1005',['Starlite'],'$55.00 USD'),name:'Standalone Ships - Starlite - Warbond'};
const akuma={...pledge('1006',['ATLS IKTI Akuma'],'$75.00 USD'),name:'Nine Tails Shogun Pack'};
entries[1].acquisitionCost={minor:14545,currency:'EUR',taxBasis:'gross',evidence:'Synthetic receipt'};
entries[2].name='SYNTHETIC GIVEAWAY';
const doc=(id,pledges)=>({schemaVersion:1,accountId:id,revision:id===a?'33333333-3333-4333-8333-333333333333':'44444444-4444-4444-8444-444444444444',observedAt:at,document:{type:'sarevocs-ccu-inventory',schemaVersion:1,appVersion:version,createdAt:at,dataMode:'real',account:{reference:'rsi-local:'+id,identityKind:'manual-reference'},scope:{kind:'partial',exportComplete:false,expectedPledges:null,pagesExpected:null,pagesRead:1},pledges,buybacks:[]}});
const ships=[['Prospector',15500],['Ursa',6000],['Dragonfly',4000],['Reward Ship',10000],['600i Touring',43500],['Starlite',6000],['ATLS IKTI Akuma',5000]].map(([name,minor],i)=>({id:i+1,name,minor}));
const fixture={state:{accounts:[account(a),account(b)],selectedAccountId:a,dataDir:'SYNTHETIC',version,packaged:false,electron:'fixture',node:'fixture'},inventories:{[a]:{account:account(a),items:[],buybacks:[]},[b]:{account:account(b),items:[],buybacks:[]}},views:{[a]:doc(a,entries),[b]:doc(b,[pledge('2001',['Ursa'],'$33.00 USD')])},pricing:{settings:{schemaVersion:1,language:'de',currency:'EUR',taxMode:'gross',vatBasisPoints:1900},configured:true,settingsError:false,rate:{source:'ECB',sourceDate:at.slice(0,10),usdPerEurMicros:1100000,fetchedAt:at},pending:false,rateError:false},market:{schemaVersion:1,catalogue:{fetchedAt:at,ships:ships.map(({minor,...s})=>({...s,chassisId:null,manufacturer:'Synthetic',manufacturerCode:'T',status:'unknown',focus:'',length:null}))},values:{schemaVersion:1,source:'rsi-from-ships',fetchedAt:at,currency:'USD',taxBasis:'net',items:ships},offers:null,pending:false,errors:{catalogue:null,offers:null},refreshSchedule:{hour:17,minute:5,timeZone:'Europe/Berlin'}}};
for(const s of fixture.market.catalogue.ships){s.manufacturer=s.name==='Prospector'?'MISC':s.name==='Ursa'?'Roberts Space Industries':'Synthetic';s.manufacturerCode=s.name==='Ursa'?'RSI':s.name==='Prospector'?'MISC':'T';}for(const p of entries)p.sourceValues.date='Nov 14, 2026';
fixture.market.catalogue.ships.find(ship=>ship.name==='Starlite').manufacturer='MISC';
fixture.pricing.rate.usdPerEurMicros=1099200;
fixture.views[b].document.pledges[0].name='Standalone Ships - Ursa';
fs.writeFileSync(path.join(folder,'fixture.json'),JSON.stringify(fixture));fs.writeFileSync(path.join(folder,'index.html'),'<!doctype html><html lang="de"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'self\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\'; connect-src \'none\'"><link rel="stylesheet" href="app.css"><div id="root"></div><script src="app.js"></script></html>');
const env={...process.env,TEMP:path.join(folder,'tmp'),TMP:path.join(folder,'tmp')};fs.mkdirSync(env.TEMP,{recursive:true});delete env.ELECTRON_RUN_AS_NODE;delete env.NODE_OPTIONS;
const checks=[],errors=[];let app;const check=async(name,fn)=>{await fn();checks.push(name);console.log('PASS: '+name)};
entries.push(starlite,akuma);
fs.writeFileSync(path.join(folder,'fixture.json'),JSON.stringify(fixture));
try{app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),args:[path.join(folder,'fixture-main.cjs'),'--disable-gpu','--disable-background-networking','--host-resolver-rules=MAP * ~NOTFOUND'],env});const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.getByRole('button',{name:'Schiffe & Fahrzeuge',exact:true}).click();const table=page.locator('.ship-value-table'),row=id=>table.locator('tbody tr[data-pledge="'+id+'"]').first();await row('1005').locator('.ship-current-value strong').filter({hasText:'54,59'}).waitFor();
await check('STARLITE_SHOWS_TWO_COMPARABLE_PRICES_WITH_SOURCE_IN_TOOLTIP',async()=>{
  const item=row('1005');
  assert.deepEqual((await table.locator('thead th').allTextContents()).slice(4,6),['Kaufpreis beim Erwerb','Aktueller Kaufpreis']);
  assert.deepEqual((await item.locator('.ship-price').allTextContents()).map(s=>s.replace(/\s/g,'')),['≈50,04€','≈54,59€']);
  assert.match(await item.locator('.ship-purchase').getAttribute('title'),/Richtwert.*55,00/s);
  assert.doesNotMatch(await table.innerText(),/MwSt\.|netto|brutto/i);
});
await check('RECORDED_PACKAGE_TOTAL_IS_SHARED_ONCE_AND_CHILDREN_SHOW_STANDARD_PRICES',async()=>{const r=table.locator('tr[data-pledge="1002"]');assert.equal(await r.count(),2);assert.equal(await r.locator('.ship-purchase').count(),1);assert.equal(await r.locator('.ship-purchase').getAttribute('rowspan'),'2');assert.match(await r.locator('.ship-purchase').innerText(),/145,45.*Paketgesamt \(2\)/s);assert.deepEqual((await r.locator('.ship-current-value strong').allTextContents()).map(s=>s.replace(/\s/g,'')),['≈54,59€','≈36,39€']);});
await check('PACKAGE_UPGRADE_REWARDS_AND_UNRESOLVED_VARIANTS_NEVER_INVENT_SHIP_PURCHASES',async()=>{
  for(const id of ['1001','1003','1004','1006'])assert.equal(await row(id).locator('.ship-purchase strong').innerText(),'Nicht belegt');
  assert.equal(await row('1004').locator('.ship-current-value strong').innerText(),'Nicht verfügbar');
  assert.match(await row('1006').locator('.ship-current-value strong').innerText(),/45,49/);
});
await check('CROWN_UPGRADE_ONLY_AND_ORIGINAL_HISTORY_TOOLTIP_REMAIN',async()=>{const name=row('1001').locator('td').first();assert.equal(await name.getByRole('img',{name:'Spielkopie im Pledge'}).count(),1);assert.match(await row('1001').locator('.inventory-kind').innerText(),/Nur upgraden/);await name.focus();await app.evaluate(async()=>{for(let n=0;n<100;n++){if(globalThis.fixture.pending.some(p=>!p.done&&p.command.pledgeId==='1001'))return;await new Promise(r=>setTimeout(r,10));}throw Error('HISTORY_REQUEST_MISSING');});await app.evaluate(()=>globalThis.resolveHistory({accountId:'11111111-1111-4111-8111-111111111111',pledgeId:'1001',revision:'33333333-3333-4333-8333-333333333333'},{status:'loaded',steps:[{from:'Hornet Ghost',to:'Prospector',appliedAt:null}],partial:false}));await page.waitForFunction(()=>document.querySelector('.ship-value-table tr[data-pledge="1001"] td').title.includes('Hornet Ghost → Prospector'));assert.match(await name.getAttribute('title'),/Nicht einschmelzen|nicht einschmelzen/);});
await check('PROFILE_SWITCH_DOES_NOT_REUSE_PURCHASE_VALUES',async()=>{await page.getByLabel('Lokales Kontoprofil',{exact:true}).selectOption(b);await row('2001').waitFor();assert.match(await row('2001').locator('.ship-purchase').innerText(),/30,02/);assert.equal(await row('1001').count(),0);await page.getByLabel('Lokales Kontoprofil',{exact:true}).selectOption(a);await row('1001').waitFor();});
await check('MANUFACTURER_BETWEEN_CURRENT_MODEL_AND_INSURANCE_WITH_COMPACT_RSI_DATE',async()=>{const headings=await table.locator('thead th').allTextContents();assert.deepEqual(headings.slice(0,3),['Schiff / Fahrzeug','Hersteller','Versicherung']);assert.equal(await row('1001').locator('.ship-manufacturer').innerText(),'MISC');assert.equal(await row('1002').locator('.ship-manufacturer').innerText(),'RSI');assert.match(await row('1001').locator('.ship-source').innerText(),/14\.11\.26/);const first=table.locator('tbody tr').first();assert.equal(await first.locator('td').count(),7);await table.screenshot({path:path.join(folder,'manufacturer-table.png')});});
await check('GIVEAWAY_PENCIL_ONLY_AND_LOCAL_DONOR_SURVIVES_INVENTORY_POLL',async()=>{
  const ship=row('1005'),source=ship.locator('.ship-source');
  const marked=row('1003').locator('.ship-source');
  const button=marked.getByRole('button',{name:/Giveaway-Herkunft bearbeiten/});
  const dialog=page.getByRole('dialog',{name:'Giveaway-Herkunft'}),purchase=await ship.locator('.ship-purchase').innerText();
  const height=await ship.evaluate(node=>node.getBoundingClientRect().height);
  assert.equal(await table.locator('.giveaway-pencil').count(),1);
  assert.equal(await marked.locator('.ship-origin-line').evaluate(node=>node.firstElementChild.tagName),'BUTTON');
  assert.match(await marked.innerText(),/Giveaway/);
  assert.doesNotMatch(await marked.innerText(),/RSI/);
  assert.equal(await source.getByRole('button').count(),0);
  await source.click({button:'right'});
  await marked.click({button:'right'});
  await ship.locator('td').first().focus(); await page.keyboard.press('Shift+F10');
  assert.equal(await dialog.count(),0);
  await button.click(); const donor=dialog.getByLabel('Name des Spenders');
  await donor.fill('Synthetischer Spender');
  await dialog.getByRole('button',{name:'OK',exact:true}).click(); await dialog.waitFor({state:'hidden'});
  assert.match(await marked.innerText(),/Giveaway von Synthetischer Spender/);
  assert.match(await marked.getAttribute('title'),/Eigene Angabe/);
  assert.equal(await ship.evaluate(node=>node.getBoundingClientRect().height),height);
  assert.match(await source.innerText(),/RSI · 14\.11\.26/);
  assert.equal(await ship.locator('.ship-purchase').innerText(),purchase);
  await app.evaluate(()=>{
    const view=globalThis.fixture.views[globalThis.fixture.state.selectedAccountId];
    view.document.pledges.find(item=>item.pledgeId==='1003').sourceValues.date='Nov 15, 2026';
    view.revision='77777777-7777-4777-8777-777777777777';
    view.observedAt=new Date().toISOString();
  });
  await row('1003').locator('.ship-source[title*="15.11.2026"]').waitFor();
  assert.match(await marked.innerText(),/Giveaway von Synthetischer Spender/);
  await page.getByLabel('Lokales Kontoprofil',{exact:true}).selectOption(b); await row('2001').waitFor();
  assert.doesNotMatch(await row('2001').innerText(),/Synthetischer Spender/);
  await page.getByLabel('Lokales Kontoprofil',{exact:true}).selectOption(a); await marked.locator('button:not([disabled])').waitFor();
  await button.focus(); await page.keyboard.press('Enter');
  assert.equal(await donor.inputValue(),'Synthetischer Spender');
  await donor.fill('Abgebrochen'); await page.keyboard.press('Escape'); await dialog.waitFor({state:'hidden'});
  assert.match(await marked.innerText(),/Synthetischer Spender/);
  await button.click(); await donor.fill('');
  await dialog.getByRole('button',{name:'OK',exact:true}).click(); await dialog.waitFor({state:'hidden'});
  assert.match(await marked.innerText(),/Giveaway/);
  assert.doesNotMatch(await marked.innerText(),/Giveaway von/);
  const edits=await app.evaluate(()=>globalThis.fixture.commands.filter(command=>command.action==='inventory.giveaways'&&command.edit));
  assert.deepEqual(edits.map(command=>command.edit),[{pledgeId:'1003',organizer:'Synthetischer Spender'},{pledgeId:'1003',organizer:''}]);
});
await check('VAT_SETTING_DOES_NOT_CHANGE_THE_COMPARISON_AND_MISSING_FX_RETURNS_ORIGINAL_AMOUNTS',async()=>{
  await app.evaluate(()=>{globalThis.fixture.pricing.settings.language='en';globalThis.fixture.pricing.settings.vatBasisPoints=2000;});
  await table.locator('th[title="Current purchase price"]').waitFor();
  assert.match(await row('1005').locator('.ship-current-value').innerText(),/54\.59/);
  assert.match(await row('1005').locator('.ship-purchase').innerText(),/50\.04/);
  await app.evaluate(()=>{globalThis.fixture.pricing.settings.language='de';globalThis.fixture.pricing.rate=null;});
  await row('1005').locator('.ship-current-value strong').filter({hasText:'60,00'}).waitFor();
  assert.match(await row('1005').locator('.ship-purchase').innerText(),/55,00\s*\$/);
  await app.evaluate(({},pricing)=>{globalThis.fixture.pricing=pricing;},fixture.pricing);
});
await check('DOCUMENTED_PURCHASES_SHOW_SCOPE_AND_SOURCE',async()=>{
  await app.evaluate(()=>{
    const view=globalThis.fixture.views[globalThis.fixture.state.selectedAccountId];
    const p=id=>view.document.pledges.find(item=>item.pledgeId===id);
    p('1001').name='Standalone Ship - Original Fixture Ship';
    p('1001').rsiPurchase={status:'documented',source:'log',minor:6909,currency:'EUR'};
    p('1006').rsiPurchase={status:'documented',source:'order',minor:7241,currency:'EUR'};
    view.revision='66666666-6666-4666-8666-666666666666';view.observedAt=new Date().toISOString();
  });
  const original=row('1001').locator('.ship-purchase'), bundle=row('1006').locator('.ship-purchase');
  await original.getByText('Ursprungspreis',{exact:true}).waitFor();
  assert.match(await original.innerText(),/69,09/);
  assert.match(await original.getAttribute('title'),/RSI-Kaufprotokoll/);
  assert.match(await bundle.innerText(),/72,41.*\s+Paketpreis beim Erwerb/);
  assert.match(await bundle.getAttribute('title'),/RSI-Bestellung/);
});
await check('TWO_HUNDRED_SHIPS_STAY_COMPACT_AT_1440_1024_AND_125_PERCENT',async()=>{await row('1005').locator('.ship-current-value strong').filter({hasText:'54,59'}).waitFor();await table.evaluate(t=>{const c=t.createCaption();c.textContent='SYNTHETISCHE TESTDATEN · KOMPAKTE PREISANSICHT';c.style.cssText='text-align:left;color:#ffbd69;padding:6px 10px;font-size:11px';});await table.screenshot({path:path.join(folder,'compact-prices.png')});await table.evaluate(t=>t.caption.remove());await app.evaluate(({},pledges)=>{const v=globalThis.fixture.views[globalThis.fixture.state.selectedAccountId];v.document.pledges=pledges;v.revision='55555555-5555-4555-8555-555555555555';v.observedAt=new Date().toISOString();},Array.from({length:200},(_,i)=>({...pledge(String(5000+i),[i%2?'Prospector':'Ursa'],'$95.00 USD'),name:i%2?'Standalone Ships - Prospector':'Standalone Ships - Ursa'})));await page.waitForFunction(()=>document.querySelectorAll('.ship-value-table tbody tr').length===200);for(const [width,scale]of [[1440,1],[1024,1],[1024,1.25]]){await page.setViewportSize({width,height:1000});const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setDeviceMetricsOverride',{width,height:1000,mobile:false,deviceScaleFactor:scale});const geometry=await table.locator('tbody tr').evaluateAll(rows=>rows.map(r=>({height:r.getBoundingClientRect().height,overflow:r.scrollWidth>r.clientWidth})));assert.ok(geometry.every(r=>r.height<=44&&!r.overflow),JSON.stringify(geometry.slice(0,3)));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await table.locator('tbody tr').first().scrollIntoViewIfNeeded();await page.screenshot({path:path.join(folder,'compact-'+width+'-'+scale+'.png')});await cdp.detach();}await page.setViewportSize({width:1440,height:1000});});
await check('NO_LOGIN_MUTATION_NETWORK_OR_REAL_USER_DATA',async()=>{
  assert.equal(await page.locator('dialog[open]').count(),0);
  const commands=await app.evaluate(()=>globalThis.fixture.commands);
  const allowed=['state','inventory','inventory.giveaways','rsi.background','rsi.settings','rsi.upgradeHistory','account.select','pricing.status','market.status','loaners.status'];
  const unexpected=commands.filter(command=>!allowed.includes(command.action)&&!(command.action==='table.widths'&&command.widths===undefined));
  assert.deepEqual([...new Set(unexpected.map(command=>command.action))],[]);
  assert.equal(await app.evaluate(()=>globalThis.blockedRequests),0);
  assert.deepEqual(errors,[]);
});
fs.writeFileSync(path.join(folder,'results.json'),JSON.stringify({status:'PASS',version,packagedRenderer:!!packaged,checks,errors,newRsiLogin:false,realUserFilesRead:false,networkRequests:0,syntheticShips:200},null,2));console.log('REPORT: '+path.join(folder,'results.json'));
}catch(error){fs.writeFileSync(path.join(folder,'results.json'),JSON.stringify({status:'FAIL',checks,error:String(error),errors},null,2));console.log('REPORT: '+path.join(folder,'results.json'));throw error;}finally{if(app)await app.close();}
