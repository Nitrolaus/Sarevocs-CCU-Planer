import { _electron } from 'playwright-core';
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { reportFixture } from './fixtures/report-data.ts';
import { basePledge } from './fixtures.ts';

const folder = path.resolve('work/temp/warbond-ui', randomUUID()); fs.mkdirSync(folder, { recursive: true });
await build({ entryPoints: ['src/ui/App.tsx'], outfile: path.join(folder, 'app.js'), bundle: true, platform: 'browser', target: 'chrome156' });
for (const file of ['app.svg', 'app.png']) fs.copyFileSync('assets/' + file, path.join(folder, file));
fs.copyFileSync('tests/fixtures/ship-display-preload.cjs', path.join(folder, 'fixture-preload.cjs'));
let main = fs.readFileSync('tests/fixtures/upgrade-history-ui-main.cjs', 'utf8');
const anchor = '  fixture.commands.push(copy(command));'; assert.equal(main.split(anchor).length, 2);
main = main.replace(anchor, anchor + `
  if(command.action==='market.checkOffers')return {ok:true,data:copy(fixture.market)};
  if(command.action==='market.shopPrices')return {ok:true,data:null};
  if(command.action==='market.openUpgrades')return {ok:true,data:{opened:true}};
  if(command.action==='planner.creditBudget')return {ok:true,data:null};
  if(command.action==='market.targets'){if(command.ids)fixture.targets[command.accountId]=command.ids;return {ok:true,data:copy(fixture.targets[command.accountId]??[null,null,null])};}
`);
fs.writeFileSync(path.join(folder, 'fixture-main.cjs'), main);
const a = '11111111-1111-4111-8111-111111111111', at = new Date().toISOString();
const account = { id:a, name:'VORSCHAU · erfundene Angebote', mode:'demo', reference:null, identityKind:null, identityStatus:'unbound', lastComplete:at };
const ships = ['Eclipse', 'Endeavor', 'Galaxy'].map((name, i) => ({ id:[62,206,207][i],name,chassisId:null,manufacturer:['Aegis Dynamics','MISC','RSI'][i],manufacturerCode:'TEST',status:'flight-ready',focus:'',length:null }));
const offers = ships.map((s,i) => ({ key:'synthetic:'+s.id,name:'Upgrade to '+s.name,targetName:s.name,toShipId:s.id,toSkuId:19000+s.id,regularMinor:[30000,35000,40000][i],warbondMinor:[null,33000,35000][i],warbond:i>0,currency:'USD',taxBasis:'net',verification:'target-observation',firstSeenAt:at,lastSeenAt:at,change:'current',previousRegularMinor:null,previousWarbondMinor:null }));
const quotes = [206,207].flatMap((toId,i) => ['standard','warbond'].map(edition => ({fromId:62,toId,edition,checkedAt:Date.now(),amount:{minor:edition==='warbond'?[3270,5450][i]:[5450,8720][i],currency:'EUR',taxMode:'gross',vatBasisPoints:1900}})));
const p = basePledge('synthetic-ccu'); p.ships=[];p.name='Synthetic Warbond';p.ccus=[{instanceId:'physical-one',from:'Eclipse',to:'Galaxy',status:'unused',applicability:'unverified',insurance:p.insurance}];
const fixture = { state:{accounts:[account],selectedAccountId:a,dataDir:'Synthetischer Ordner',version:'TEST · erfundene Angebote',packaged:false,electron:'fixture',node:'fixture'},
  inventories:{[a]:{account,items:[{pledge:p,availability:'present',source:'rsi-dom-probe/1',importedAt:at}],buybacks:[]}},views:{},targets:{[a]:[62,null,null]},pricing:reportFixture().display,
  market:{schemaVersion:1,catalogue:{fetchedAt:at,ships},offers:{fetchedAt:at,sourceAt:at,checkedAt:at,items:offers},shopPrices:quotes,pending:false,errors:{catalogue:null,offers:null},refreshSchedule:{hour:17,timeZone:'Europe/Berlin'}} };
fixture.pricing.settings.taxMode='gross';
fs.writeFileSync(path.join(folder,'fixture.json'),JSON.stringify(fixture));
fs.writeFileSync(path.join(folder,'index.html'),`<!doctype html><html lang="de"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'none'"><link rel="stylesheet" href="app.css"></head><body><div id="root"></div><script src="app.js"></script></body></html>`);
const env={...process.env,TEMP:path.join(folder,'tmp'),TMP:path.join(folder,'tmp')};fs.mkdirSync(env.TEMP,{recursive:true});delete env.ELECTRON_RUN_AS_NODE;delete env.NODE_OPTIONS;
const require=createRequire(import.meta.url);let app;
try {
  app=await _electron.launch({executablePath:require('electron'),args:[path.join(folder,'fixture-main.cjs'),'--disable-gpu','--disable-background-networking','--host-resolver-rules=MAP * ~NOTFOUND'],env});
  const page=await app.firstWindow();await page.getByRole('heading',{name:'Bestand',exact:true}).waitFor();await page.getByRole('button',{name:/CCU-Planer/}).click();
  await page.locator('.outgoing-purchase').waitFor();
  assert.match(await page.locator('.outgoing-purchase').innerText(),/Eclipse → Endeavor[\s\S]*32,70[\s\S]*21,80[\s\S]*Noch nicht gekauft/);
  assert.equal(await page.locator('.outgoing-owned').count(),0);
  assert.equal(await page.locator('.outgoing-table tbody tr').count(),1);
  assert.doesNotMatch(await page.locator('.outgoing-table').innerText(),/Galaxy/);
  const colors=await page.locator('.outgoing-table').evaluate(table=>[...table.querySelectorAll('tbody tr')].map(row=>({fill:getComputedStyle(row.cells[0]).backgroundColor,warbond:getComputedStyle(row.querySelector('.outgoing-warbond-label')).color})));
  assert.deepEqual(colors.map(c=>c.fill),['rgb(48, 37, 25)']);assert.ok(colors.every(c=>c.warbond==='rgb(82, 255, 240)'));
  const dimensions=[];
  for(const [width,zoom] of [[1540,1],[1024,1],[1280,1.25]]){
    await app.evaluate(({BrowserWindow},{width,zoom})=>{const w=BrowserWindow.getAllWindows()[0];w.webContents.setZoomFactor(zoom);w.setContentSize(width,1350)},{width,zoom});
    await page.waitForTimeout(200);
    dimensions.push(await page.locator('.outgoing-scroll').evaluate(node=>({client:node.clientWidth,scroll:node.scrollWidth,overflow:getComputedStyle(node).overflowX})));
    assert.equal(dimensions.at(-1).overflow,'auto');
  }
  await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.webContents.setZoomFactor(1);w.setContentSize(1540,1350)});
  const output=path.resolve('../../visualizations/ccu-warbond-umgesetzt.png');fs.mkdirSync(path.dirname(output),{recursive:true});
  await page.locator('.fair-news').screenshot({path:path.resolve('../../visualizations/ccu-warbond-farben.png')});
  const box=await page.locator('.market-view').boundingBox(),targets=await page.locator('.market-targets').boundingBox();
  await page.screenshot({path:output,clip:{x:Math.floor(box.x),y:Math.floor(box.y),width:Math.ceil(box.width),height:Math.ceil(targets.y+targets.height-box.y+10)}});
  await page.locator('.outgoing-purchase button').click();
  const commands=await app.evaluate(()=>globalThis.fixture.commands);
  assert.ok(commands.some(c=>c.action==='market.checkOffers'));
  assert.ok(commands.filter(c=>c.action==='market.shopPrices').flatMap(c=>c.pairs).some(p=>p.fromId===62&&p.toId===206));
  assert.ok(commands.some(c=>c.action==='market.openUpgrades'));
  assert.ok(!commands.some(c=>/rsi\.(connect|open|authorize)|cart|purchase|checkout/.test(c.action)));
  const hiddenCases=[];
  for(const kind of ['no-discount-proof','standard-only','zero-discount','already-owned','locked-owned','incomplete-inventory','expired']) {
    const testQuotes=structuredClone(quotes), items=structuredClone(fixture.inventories[a].items);
    let prices=testQuotes, complete=true;
    if(kind==='no-discount-proof')prices=prices.filter(p=>p.edition==='warbond');
    if(kind==='standard-only')prices=prices.filter(p=>p.edition==='standard');
    if(kind==='zero-discount')prices.forEach(p=>{if(p.toId===206)p.amount.minor=3270});
    if(kind==='already-owned'||kind==='locked-owned'){
      const extra=structuredClone(items[0]);extra.pledge.pledgeId='new-owned';extra.pledge.ccus[0].instanceId='new-copy';extra.pledge.ccus[0].to='Endeavor';items.push(extra);
    }
    if(kind==='incomplete-inventory')complete=false;
    if(kind==='expired')prices.forEach(p=>p.checkedAt=Date.now()-301000);
    await app.evaluate((_electron,{a,at,prices,items,complete,locked})=>{
      const f=globalThis.fixture;f.market.shopPrices=prices;f.inventories[a].items=items;f.inventories[a].account.lastComplete=complete?at:null;
      f.excludedCcus={[a]:locked?[JSON.stringify(['new-owned','new-copy'])]:[]};
    },{a,at,prices,items,complete,locked:kind==='locked-owned'});
    await page.reload();await page.getByRole('heading',{name:'Bestand',exact:true}).waitFor();await page.getByRole('button',{name:/CCU-Planer/}).click();
    await page.getByRole('heading',{name:'Warbond-Angebote ab Eclipse · Schiff 1',exact:true}).waitFor();
    await page.locator('.outgoing-status').waitFor();
    assert.equal(await page.locator('.outgoing-table tbody tr').count(),0,kind);
    hiddenCases.push(kind);
  }
  await page.getByRole('combobox',{name:'Zielschiff 1',exact:true}).selectOption('207');
  await page.getByRole('heading',{name:'Warbond-Angebote ab Galaxy · Schiff 1',exact:true}).waitFor();
  const report={status:'PASS',syntheticOnly:true,realSessionRead:false,newRsiLogin:false,screenshot:output,dimensions,automaticQuoteRequested:true,ownedHidden:true,hiddenCases,colors};
  fs.writeFileSync(path.join(folder,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{if(app)await app.close()}
