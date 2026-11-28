import {_electron} from 'playwright-core';
import {build} from 'esbuild';
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';import {createRequire} from 'node:module';
import {reportFixture} from './fixtures/report-data.ts';
const folder=path.resolve('work/temp/inventory-details-ui',randomUUID());fs.mkdirSync(folder,{recursive:true});
const data=reportFixture(),a=data.inventory.account.id;
const pack=data.inventory.items[2].pledge;pack.rsiPurchase={status:'documented',source:'order',minor:10000,currency:'EUR'};
const addon=structuredClone(data.inventory.items[0]);addon.pledge.pledgeId='gear';addon.pledge.name='SYNTHETIC ARMOR';addon.pledge.ships=[];
addon.pledge.sourceValues.items=JSON.stringify([{title:'Synthetic Helmet',kind:'FPS Equipment'}]);
data.inventory.items.push(addon);
const entry=`import React,{useState}from'react';import{createRoot}from'react-dom/client';
import{ShipValueTable}from'./src/ui/ShipValueTable';import{AddonsTable}from'./src/ui/AddonsTable';
import{inventoryAddons}from'./src/domain/inventory-addons';import{LanguageContext}from'./src/ui/i18n';
import './src/ui/app.css';
const f=${JSON.stringify(data)};
function App(){const[account,setAccount]=useState(f.inventory.account.id),[mode,setMode]=useState('ships'),[language,setLanguage]=useState('de');const display={...f.display,settings:{...f.display.settings,language}};
return <LanguageContext.Provider value={language}><button onClick={()=>setMode(mode==='ships'?'addons':'ships')}>Toggle table</button><button onClick={()=>setAccount(account==='other'?f.inventory.account.id:'other')}>Toggle profile</button><button onClick={()=>setLanguage(language==='de'?'en':'de')}>Toggle language</button>
{mode==='ships'?<ShipValueTable accountId={account} rows={f.inventory.items.map(i=>({pledge:i.pledge,source:i.source}))} display={display} demo={true} view="all" titleFor={p=>p.name} crownFor={()=>null} statusFor={()=>null} sourceLabel={s=>s} onHistory={()=>{}} lookupPurchases={()=>{}} canLookUpPurchases={()=>false} historyFor={()=>undefined} historyPurchases={new Map()} observation={{kind:'rsi-hangar',observedAt:f.now}}/>
:<AddonsTable accountId={account} items={inventoryAddons(f.inventory.items)} query="" category="" ship="" display={display} demo={true} onSearchCount={()=>{}}/>}</LanguageContext.Provider>};createRoot(document.getElementById('root')).render(<App/>);`;
// Use the real renderer components and the existing network-denied fixture process.
await build({stdin:{contents:entry,loader:'tsx',resolveDir:process.cwd()},outfile:path.join(folder,'app.js'),bundle:true,platform:'browser',target:'chrome156'});
fs.copyFileSync('tests/fixtures/ship-display-preload.cjs',path.join(folder,'fixture-preload.cjs'));
let main=fs.readFileSync('tests/fixtures/upgrade-history-ui-main.cjs','utf8');
const anchor='  fixture.commands.push(copy(command));';assert.equal(main.split(anchor).length,2);
main=main.replace(anchor,anchor+`\n if(command.action==='planner.packageShares'){fixture.packageShares??=[];if(command.edit){const {minor,...basis}=command.edit;fixture.packageShares=minor===null?[]:[{...basis,minor}];}return{ok:true,data:copy(fixture.packageShares)};}`);
fs.writeFileSync(path.join(folder,'fixture-main.cjs'),main);
fs.writeFileSync(path.join(folder,'fixture.json'),JSON.stringify({market:data.market}));
fs.writeFileSync(path.join(folder,'index.html'),'<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\';script-src \'self\';style-src \'self\' \'unsafe-inline\';img-src \'self\';connect-src \'none\'"><link rel="stylesheet" href="app.css"><div id="root"></div><script src="app.js"></script>');
const env={...process.env,TEMP:path.join(folder,'tmp'),TMP:path.join(folder,'tmp')};fs.mkdirSync(env.TEMP,{recursive:true});delete env.ELECTRON_RUN_AS_NODE;delete env.NODE_OPTIONS;
let app;const checks=[],errors=[];
try{
 app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),args:[path.join(folder,'fixture-main.cjs'),'--disable-gpu','--disable-background-networking'],env});const page=await app.firstWindow();page.on('pageerror',e=>errors.push(String(e)));page.setDefaultTimeout(10000);
 const row=page.locator('tr[data-pledge="100"]').first();await row.waitFor();const before=await row.boundingBox();
 await row.locator('td').first().click({button:'right'});await page.getByRole('menu',{name:'Bestandsdetails'}).waitFor();
 assert.equal(await page.getByRole('menuitem').count(),3);assert.equal(await page.getByRole('menuitem',{name:'Hangar-Log prüfen'}).isDisabled(),true);
 await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');const dialog=page.getByRole('dialog');await dialog.waitFor();assert.equal(await dialog.getByRole('tab',{name:'Kaufpreis',exact:true}).getAttribute('aria-selected'),'true');
 assert.doesNotMatch(await dialog.innerText(),/SECRET_NOT_FOR_REPORT/);assert.match(await dialog.locator('.inventory-detail-total').innerText(),/32,00/);
 await dialog.getByRole('tab',{name:'Herkunft & Inhalt'}).click();assert.match(await dialog.innerText(),/SYNTHETIC LTI token/);await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});
 assert.equal((await row.boundingBox()).height,before.height);checks.push('row menu, keyboard navigation, provenance and price details; no source secrets or extra row height');
 await row.locator('td').first().focus();await page.keyboard.press('Shift+F10');await page.getByRole('menu').waitFor();await page.keyboard.press('Escape');assert.equal(await row.locator('td').first().evaluate(e=>e===document.activeElement),true);
 await page.locator('tr[data-pledge="300"]').first().click({button:'right'});await page.getByRole('menuitem',{name:'Kaufpreis aufschlüsseln'}).click();await dialog.waitFor();
 await dialog.locator('.ccu-package-share summary').click();const amount=dialog.getByRole('textbox');await amount.fill('35,00');await dialog.getByRole('button',{name:'Speichern',exact:true}).click();await dialog.getByText('Eigene Angabe',{exact:false}).waitFor();
 const commands=await app.evaluate(()=>globalThis.fixture.commands);const edit=commands.find(c=>c.action==='planner.packageShares'&&c.edit);assert.equal(edit.accountId,a);assert.equal(edit.edit.pledgeId,'300');assert.equal(edit.edit.minor,3500);checks.push('existing package editor receives exact account, physical ship and entered share');
 await page.keyboard.press('Escape');await row.click({button:'right'});await page.getByRole('menuitem',{name:'Details & Herkunft'}).click();await dialog.waitFor();await page.getByRole('button',{name:'Toggle profile'}).evaluate(e=>e.click());await dialog.waitFor({state:'detached'});checks.push('profile change conceals details even when physical row identifiers are reused');
 await page.getByRole('button',{name:'Toggle table'}).click();const gear=page.locator('tr[data-addon]').first();await gear.click({button:'right'});await page.getByRole('menuitem',{name:'Details & Herkunft'}).click();await dialog.waitFor();assert.match(await dialog.innerText(),/Synthetic Helmet/);assert.doesNotMatch(await dialog.innerText(),/SECRET_NOT_FOR_REPORT/);await page.keyboard.press('Escape');
 for(const [width,zoom]of[[1024,1],[1280,1.25]]){await app.evaluate(({BrowserWindow},{width,zoom})=>{const w=BrowserWindow.getAllWindows()[0];w.webContents.setZoomFactor(zoom);w.setContentSize(width,1000);},{width,zoom});await gear.click({button:'right'});const box=await page.getByRole('menu').boundingBox(),viewport=await page.evaluate(()=>({width:innerWidth,height:innerHeight}));assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=viewport.width+1&&box.y+box.height<=viewport.height+1);await page.getByRole('menuitem',{name:'Kaufpreis aufschlüsseln'}).click();await dialog.waitFor();const b=await dialog.boundingBox();assert.ok(b.width<=viewport.width&&b.height<=viewport.height);await page.keyboard.press('Escape');}
 checks.push('same details menu works for add-ons; bounds checked at 1024px and 125 percent zoom');
 await page.getByRole('button',{name:'Toggle language'}).click();await gear.click({button:'right'});await page.getByRole('menuitem',{name:'Details & provenance'}).waitFor();await page.keyboard.press('Escape');
 assert.deepEqual(errors,[]);const prohibited=await app.evaluate(()=>globalThis.fixture.commands.filter(c=>/rsi\.(open|delete|connect)|export|fleetyards\.save/.test(c.action)));assert.deepEqual(prohibited,[]);
 const report=path.join(folder,'results.json');fs.writeFileSync(report,JSON.stringify({status:'PASS',data:'synthetic only; network denied',checks},null,2));console.log('PASS: '+checks.length+' checks\nREPORT: '+report);
}finally{await app?.close();}
