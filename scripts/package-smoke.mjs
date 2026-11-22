import { chromium } from 'playwright-core';
import { spawn,spawnSync } from 'node:child_process';
import net from 'node:net';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { getCurrentFuseWire, FuseV1Options, FuseState } from '@electron/fuses';
import { conciergePageProbe } from '../src/importers/rsi-concierge-data.ts';
const root = process.cwd();
const expected = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const executable = process.env.CCU_TEST_EXE ?? path.join(root, 'work/temp/packaged/Sarevocs-CCU-Planer-win32-x64/Sarevocs-CCU-Planer.exe');
const runDir = path.join(root, 'work/temp/package-smoke', randomUUID()); fs.mkdirSync(runDir, { recursive: true });
const environment = { ...process.env, TEMP: path.join(root, 'work/temp/tooling'), TMP: path.join(root, 'work/temp/tooling') };
delete environment.ELECTRON_RUN_AS_NODE; delete environment.NODE_OPTIONS;
const results = []; let child; let browser; let proxyPort; let blockedTunnels = 0;
const marketFixture = process.argv.includes('--market-fixture');
const marketDirectory = path.join(runDir, 'data/Daten/Marktdaten');
if (marketFixture) {
  fs.mkdirSync(marketDirectory, { recursive: true }); const at = new Date().toISOString();
  fs.writeFileSync(path.join(marketDirectory, 'public-v1.json'), JSON.stringify({ schemaVersion: 1,
    catalogue: { fetchedAt: at, ships: [{ id: 62, name: 'Synthetic Market Ship', chassisId: 22, manufacturer: 'Synthetic', manufacturerCode: 'SYN', status: 'flight-ready', focus: '', length: 126 }] },
    offers: { fetchedAt: at, sourceAt: at, checkedAt: at, items: [{ key: 'openh:62:19062', name: 'Upgrade to Synthetic Market Ship', targetName: 'Synthetic Market Ship', toShipId: 62, toSkuId: 19062,
      regularMinor: 40000, warbondMinor: 36000, warbond: true, currency: 'USD', taxBasis: 'net', verification: 'target-observation', firstSeenAt: at, lastSeenAt: at, change: 'new', previousRegularMinor: null, previousWarbondMinor: null }] } }));
}
const pricingDirectory=path.join(runDir,'data/Daten/Anzeige');
if(marketFixture){fs.mkdirSync(pricingDirectory,{recursive:true});fs.writeFileSync(path.join(pricingDirectory,'display-v1.json'),JSON.stringify({schemaVersion:1,language:'de',currency:'EUR',taxMode:'net',vatBasisPoints:1900}));fs.writeFileSync(path.join(pricingDirectory,'ecb-v1.json'),JSON.stringify({source:'ECB',sourceDate:new Date(Date.now()-86400000).toISOString().slice(0,10),usdPerEurMicros:1105200,fetchedAt:new Date().toISOString()}));}
// Rejecting loopback proxy: the packaged diagnostics test can never reach RSI.
const proxy = http.createServer((_request, response) => { response.writeHead(502); response.end(); });
proxy.on('connect', (_request, socket) => { blockedTunnels++; socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n'); });
async function open() {
  const socket = net.createServer(); await new Promise(r => socket.listen(0, '127.0.0.1', r));
  const port = socket.address().port; await new Promise(r => socket.close(r));
  child = spawn(executable, ['--data-dir=' + path.join(runDir, 'data'), '--disable-gpu', '--proxy-server=http://127.0.0.1:' + proxyPort, '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=' + port], { cwd: path.dirname(executable), env: environment, windowsHide: true, stdio: 'ignore' });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error('Paket vorzeitig beendet: ' + child.exitCode);
    try { browser = await chromium.connectOverCDP('http://127.0.0.1:' + port, { timeout: 500 }); break; }
    catch { await new Promise(r => setTimeout(r, 100)); }
  }
  if (!browser) throw new Error('Paket stellt kein bedienbares Fenster bereit.');
  const page = browser.contexts()[0].pages()[0] ?? await browser.contexts()[0].waitForEvent('page');
  await page.waitForFunction(()=>!!window.ccu);
  const preferences=await page.evaluate(async()=>(await window.ccu.request({action:'pricing.status'})).data);
  if(!preferences.configured){await page.getByRole('heading',{name:'Erste Einrichtung'}).waitFor();await page.getByRole('button',{name:'Speichern',exact:true}).click();await page.getByText('Einstellungen gespeichert.',{exact:true}).waitFor();await page.getByRole('button',{name:'Bestand',exact:true}).click();}
  await page.getByRole('heading', { name: 'Bestand', exact: true }).waitFor(); return page;
}
async function close() {
  if (browser) {
    if (child?.exitCode === null) {
      // X hides to the tray. Browser.close enters Electron's guarded app.quit;
      // desktop-cdp-shutdown proves that this path awaits pending session saves.
      const cdp = await browser.newBrowserCDPSession();
      await cdp.send('Browser.close').catch(() => {}); // A successful quit also closes this transport.
    }
    await browser.close().catch(() => {}); browser = undefined;
  }
  if (child && child.exitCode === null) {
    await Promise.race([new Promise(r => child.once('exit', r)), new Promise(r => setTimeout(r, 12000))]);
    if (child.exitCode === null) { child.kill(); await new Promise(r => child.once('exit', r)); throw new Error('Testprozess musste erzwungen beendet werden.'); }
  }
  child = undefined;
}
try {
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve)); proxyPort = proxy.address().port;
  const fuseWire = await getCurrentFuseWire(executable);
  for (const fuse of [FuseV1Options.RunAsNode, FuseV1Options.EnableNodeOptionsEnvironmentVariable, FuseV1Options.EnableNodeCliInspectArguments]) assert.equal(fuseWire[fuse], FuseState.DISABLE);
  assert.equal(fuseWire[FuseV1Options.EnableCookieEncryption], FuseState.ENABLE);
  assert.equal(fuseWire[FuseV1Options.OnlyLoadAppFromAsar], FuseState.ENABLE);
  assert.equal(fuseWire[FuseV1Options.EnableEmbeddedAsarIntegrityValidation], FuseState.ENABLE);
  results.push('Verpackte Fuses geprüft, Node-Inspektion bleibt deaktiviert.');
  const page = await open();
  const paintStatus=await page.evaluate(()=>window.ccu.request({action:'paints.status'}));
  assert.equal(paintStatus.ok,true);assert.deepEqual(paintStatus.data,{data:null,pending:false,error:null});
  results.push('Paint-Status aus echter Installer-EXE über strikte IPC gelesen: kein automatischer Preisabruf, Kontoaufruf oder Login.');
  if(process.platform==='win32'){
    const driver=path.join(runDir,'WindowAppDetailsDriver.exe');
    const compile=spawnSync('C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe',['/nologo','/noconfig','/target:exe','/platform:x64','/main:WindowAppDetailsDriver','/reference:System.dll','/out:'+driver,path.resolve('tests/fixtures/WindowAppDetailsDriver.cs')],{env:environment,windowsHide:true,encoding:'utf8'});
    assert.equal(compile.status,0,compile.stdout+compile.stderr);
    const protocol=await browser.newBrowserCDPSession();const processInfo=await protocol.send('SystemInfo.getProcessInfo');await protocol.detach();const mainPid=processInfo.processInfo.find(p=>p.type==='browser')?.id;assert.ok(mainPid);
    const read=spawnSync(driver,[String(mainPid)],{env:environment,windowsHide:true,encoding:'utf8'});assert.equal(read.status,0,read.stderr);
    const details=JSON.parse(read.stdout);const actualExe=path.resolve(executable);
    assert.equal(details.appId,'com.squirrel.SarevocsCCUPlaner.Sarevocs-CCU-Planer');
    assert.equal(details.iconResource.toLowerCase(),(actualExe+',0').toLowerCase());
    assert.equal(details.relaunchCommand,'"'+actualExe+'"');assert.equal(details.displayName,'Sarevoc´s CCU Planer');
    fs.writeFileSync(path.join(runDir,'windows-taskbar-details.json'),JSON.stringify(details,null,2));
    results.push('Native Windows-Taskleistenmetadaten: stabile AppID, aktuelles EXE-Icon und korrekter Neustartpfad statt altem Squirrel-Icon.');
  }
  const runtime = await page.evaluate(async () => (await window.ccu.request({ action: 'state' })).data);
  assert.equal(runtime.packaged, true); assert.equal(runtime.electron, '45.3.2');
  assert.equal(runtime.version, expected.version);
  const diagnosticFile = path.join(runDir, 'data/Diagnose/Verbindung/rsi-verbindung.json');
  assert.equal(fs.existsSync(diagnosticFile), false, 'Normal start must not open RSI or create connection diagnostics');
  assert.equal(await page.getByRole('button', { name: 'Demo-Datei ansehen' }).count(), 0);
  assert.equal(await page.locator('.concierge-card').count(), 1);
  assert.ok(await page.locator('.inventory-panel').evaluate(panel => {
    const header = panel.querySelector(':scope > .panel-head');
    const card = panel.querySelector(':scope > .concierge-card');
    const table = panel.querySelector('.ship-value-table');
    return !!header && !!card && !!table && header.nextElementSibling === card &&
      !!(card.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING);
  }), 'Concierge card must be between the inventory filters and table');
  results.push('Concierge-Karte steht in der verpackten Anwendung zwischen Filtern und Bestandstabelle.');
  const pledgeLayout = await page.locator('.concierge-private').evaluate(controls => ({
    button: controls.querySelector('button').getBoundingClientRect().left,
    hint: controls.querySelector('p').getBoundingClientRect().left,
  }));
  assert.ok(Math.abs(pledgeLayout.button - pledgeLayout.hint) <= 1, 'Pledge button and hint must align');
  const conciergeFixture = attribute => '<div class="c-status__rank"><p>Grand Admiral</p></div>' +
    '<section class="c-next-level"><h2 class="c-next-level__title">Space Marshal</h2><div ' + attribute +
    '><div class="l-progress-counter"><h1>0</h1><span>% of the way</span></div></div></section>';
  for (const [attribute, progress] of [
    ['data-spend-until-next-rank="64"', 64],
    ['data-spend-until-next-rank="0"', 0],
    ['data-spend-until-next-rank="101"', null],
    ['', null],
  ]) {
    assert.deepEqual(await page.evaluate(conciergePageProbe(conciergeFixture(attribute), 'rank')),
      { status: 'loaded', rank: 'Grand Admiral', nextRank: 'Space Marshal', progress });
  }
  results.push('Concierge-Fortschritt aus dem RSI-Datenfeld, ignorierte Animations-Null und bündige Ausrichtung geprüft.');
  assert.equal(await page.getByRole('button', { name: 'Datei importieren', exact: true }).count(), 1);
  const seeded = await page.evaluate(async () => {
    const profile = await window.ccu.request({ action: 'account.create', name: 'Demo – synthetischer Bestand', mode: 'demo' });
    if (!profile.ok) return profile;
    const accountId = profile.data.id;
    const selected = await window.ccu.request({ action: 'account.select', accountId });
    if (!selected.ok) return selected;
    const preview = await window.ccu.request({ action: 'import.demo', accountId });
    if (!preview.ok) return preview;
    return window.ccu.request({ action: 'import.commit', accountId, token: preview.data.token, bindingConfirmed: true, reviewed: true });
  });
  assert.equal(seeded.ok, true, JSON.stringify(seeded));
  await page.reload();
  await page.locator('tbody tr').first().waitFor();
  assert.equal(await page.getByRole('button', { name: 'CCUs', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.getByRole('button', { name: 'Alle Gegenstände', exact: true }).click();
  assert.equal(await page.locator('tbody tr').count(), 5);
  const protection = await page.evaluate(async () => {
    const state = (await window.ccu.request({ action: 'state' })).data;
    return window.ccu.request({ action: 'rsi.settings', accountId: state.accounts[0].id });
  });
  assert.equal(protection.ok, true); assert.equal(protection.data.available, true);
  assert.equal(protection.data.saved, false); assert.equal(protection.data.stored, false);
  results.push('Verpackte App bestaetigt Windows-/Schluesselordnerschutz; leeres Profil gilt nicht als gespeicherte Anmeldung.');
  await page.screenshot({ path: path.join(runDir, 'packaged-inventory.png'), fullPage: true });
  results.push('Verpackte EXE gestartet; Concierge-Karte und Dateiimport sichtbar, synthetischer Bestand über die Bridge geprüft.');
  const exportPreview=await page.evaluate(async()=>{const state=(await window.ccu.request({action:'state'})).data;return window.ccu.request({action:'report.preview',accountId:state.accounts[0].id,kind:'inventory'});});
  assert.equal(exportPreview.ok,true);assert.ok(exportPreview.data.count>0);assert.equal(exportPreview.data.rows.length,Math.min(2,exportPreview.data.count));
  assert.match(exportPreview.data.title,/Bestand|Inventory/);assert.doesNotMatch(JSON.stringify(exportPreview.data),/sourceValues|originalDescription|session\.enc/);
  results.push('Neue Exportvorschau aus echter Installer-EXE: profilgebundener lokaler Bestand, geladene Excel-Laufzeit und keine Roh-/Sitzungsdaten.');
  const giveawayRejected=await page.evaluate(async()=>{
    const accountId=(await window.ccu.request({action:'state'})).data.accounts[0].id;
    const before=(await window.ccu.request({action:'inventory',accountId})).data;
    const edit={pledgeId:'demo-base-alpha',organizer:'Synthetic donor'};
    const ordinary=await window.ccu.request({action:'inventory.giveaways',accountId,edit});
    const missing=await window.ccu.request({action:'inventory.giveaways',accountId,edit:{...edit,pledgeId:'absent-pledge'}});
    const foreign=await window.ccu.request({action:'inventory.giveaways',accountId:'99999999-9999-4999-8999-999999999999',edit});
    const report=await window.ccu.request({action:'report.preview',accountId,kind:'inventory'});
    const notes=await window.ccu.request({action:'inventory.giveaways',accountId});
    return {ordinary,missing,foreign,report,notes,unchanged:JSON.stringify(before)===JSON.stringify((await window.ccu.request({action:'inventory',accountId})).data)};
  });
  assert.equal(giveawayRejected.ordinary.ok,false);
  assert.equal(giveawayRejected.notes.ok,true);assert.deepEqual(giveawayRejected.notes.data.entries,[]);
  assert.equal(giveawayRejected.missing.ok,false);assert.equal(giveawayRejected.foreign.ok,false);assert.equal(giveawayRejected.unchanged,true);
  assert.equal(giveawayRejected.report.ok,true);assert.doesNotMatch(JSON.stringify(giveawayRejected.report.data),/Synthetic donor/);
  results.push('Giveaway-IPC lehnt normale Schiffe, fehlende Exemplare und fremde Profile ab. Bestand und lokale Spenderliste bleiben unveraendert.');
  const reviewSaved=await page.evaluate(async()=>{
    const accountId=(await window.ccu.request({action:'state'})).data.accounts[0].id,key='a'.repeat(64);
    const before=(await window.ccu.request({action:'inventory',accountId})).data;
    const saved=await window.ccu.request({action:'loaners.review',accountId,key,state:'present'});
    const invalid=await window.ccu.request({action:'loaners.review',accountId:'99999999-9999-4999-8999-999999999999',key,state:'present'});
    return {saved,invalid,inventoryUnchanged:JSON.stringify(before)===JSON.stringify((await window.ccu.request({action:'inventory',accountId})).data)};
  });
  assert.equal(reviewSaved.saved.ok,true);assert.equal(reviewSaved.saved.data.entries['a'.repeat(64)].state,'present');assert.equal(reviewSaved.invalid.ok,false);assert.equal(reviewSaved.inventoryUnchanged,true);
  results.push('Echte Review-IPC speichert eine synthetische Benutzerangabe nur fuer ein vorhandenes lokales Profil; Inventar unveraendert, keine RSI-Authentifizierung.');
  const planSaved=await page.evaluate(async()=>{
    const accountId=(await window.ccu.request({action:'state'})).data.accounts[0].id,before=(await window.ccu.request({action:'inventory',accountId})).data;
    const base=before.items.find(i=>i.pledge.ships.length).pledge,held=before.items.find(i=>i.pledge.ccus.length).pledge,ccu=held.ccus[0];
    const draft={mode:'manual',initialized:true,baseKey:JSON.stringify([base.pledgeId,base.ships[0].childId]),anchors:[{kind:'owned',key:JSON.stringify([held.pledgeId,ccu.instanceId]),fromName:ccu.from,toName:ccu.to}]};
    const saved=await window.ccu.request({action:'planner.draft',accountId,targetId:990,draft});
    const invalid=await window.ccu.request({action:'planner.draft',accountId:'99999999-9999-4999-8999-999999999999',targetId:990,draft});
    return {saved,invalid,draft,inventoryUnchanged:JSON.stringify(before)===JSON.stringify((await window.ccu.request({action:'inventory',accountId})).data)};
  });
  assert.equal(planSaved.saved.ok,true);assert.deepEqual(planSaved.saved.data,planSaved.draft);assert.equal(planSaved.invalid.ok,false);assert.equal(planSaved.inventoryUnchanged,true);
  results.push('Echte Planungs-IPC speichert nur im vorhandenen lokalen Profil; Reihenfolge und Basis erhalten, Inventar unveraendert.');
  const batchSaved=await page.evaluate(async()=>{
    const accountId=(await window.ccu.request({action:'state'})).data.accounts[0].id,empty={mode:'auto',initialized:false,baseKey:'',anchors:[]};
    const before=JSON.stringify((await window.ccu.request({action:'inventory',accountId})).data),draft={...empty,mode:'manual',initialized:true};
    const entries=[991,992].map(targetId=>({targetId,expected:empty,draft}));
    const saved=await window.ccu.request({action:'planner.batch',accountId,entries});
    const stale=await window.ccu.request({action:'planner.batch',accountId,entries});
    const foreign=await window.ccu.request({action:'planner.batch',accountId:'99999999-9999-4999-8999-999999999999',entries});
    return {saved,stale,foreign,draft,unchanged:before===JSON.stringify((await window.ccu.request({action:'inventory',accountId})).data)};
  });
  assert.equal(batchSaved.saved.ok,true);assert.equal(batchSaved.saved.data.length,2);assert.equal(batchSaved.stale.ok,false);assert.equal(batchSaved.foreign.ok,false);assert.equal(batchSaved.unchanged,true);
  results.push('Berater-Batch ueber echte IPC atomar gespeichert; veraltete Vorschau und fremdes Profil abgewiesen, Inventar unveraendert.');
  const exclusionSaved=await page.evaluate(async()=>{
    const accountId=(await window.ccu.request({action:'state'})).data.accounts[0].id,before=(await window.ccu.request({action:'inventory',accountId})).data;
    const pledge=before.items.find(i=>i.availability==='present'&&i.pledge.ccus.length).pledge,key=JSON.stringify([pledge.pledgeId,pledge.ccus[0].instanceId]);
    const saved=await window.ccu.request({action:'planner.exclude',accountId,ccuKey:key,excluded:true});
    const foreign=await window.ccu.request({action:'planner.exclude',accountId,ccuKey:JSON.stringify(['NOT_IN_THIS_PROFILE','one']),excluded:true});
    const missing=await window.ccu.request({action:'planner.exclude',accountId:'99999999-9999-4999-8999-999999999999',ccuKey:key,excluded:true});
    return {saved,foreign,missing,key,unchanged:JSON.stringify(before)===JSON.stringify((await window.ccu.request({action:'inventory',accountId})).data)};
  });
  assert.equal(exclusionSaved.saved.ok,true);assert.deepEqual(exclusionSaved.saved.data,[exclusionSaved.key]);assert.equal(exclusionSaved.foreign.ok,false);assert.equal(exclusionSaved.missing.ok,false);assert.equal(exclusionSaved.unchanged,true);
  results.push('Echte Sperr-IPC akzeptiert nur ein vorhandenes CCU-Exemplar dieses Profils; fremde Exemplare und Profile abgewiesen, Inventar unveraendert.');
  const prioritySaved=await page.evaluate(async()=>{const accountId=(await window.ccu.request({action:'state'})).data.accounts[0].id,before=JSON.stringify((await window.ccu.request({action:'inventory',accountId})).data);const initial=await window.ccu.request({action:'planner.priorities',accountId}),saved=await window.ccu.request({action:'planner.priorities',accountId,order:[1,0,2]}),invalid=await window.ccu.request({action:'planner.priorities',accountId:'99999999-9999-4999-8999-999999999999',order:[2,1,0]});return {initial,saved,invalid,unchanged:before===JSON.stringify((await window.ccu.request({action:'inventory',accountId})).data)};});
  assert.deepEqual(prioritySaved.initial.data,[0,1,2]);assert.equal(prioritySaved.saved.ok,true);assert.deepEqual(prioritySaved.saved.data,[1,0,2]);assert.equal(prioritySaved.invalid.ok,false);assert.equal(prioritySaved.unchanged,true);results.push('Echte Vorrang-IPC speichert nur im vorhandenen Profil; Standardfolge korrekt, Fremdprofil abgewiesen und Inventar unveraendert.');
  const budgetSaved=await page.evaluate(async()=>{
    const accountId=(await window.ccu.request({action:'state'})).data.accounts[0].id;
    const before=JSON.stringify((await window.ccu.request({action:'inventory',accountId})).data);
    const initial=await window.ccu.request({action:'planner.creditBudget',accountId});
    const saved=await window.ccu.request({action:'planner.creditBudget',accountId,budget:{minor:4000,currency:'USD'}});
    const invalid=await window.ccu.request({action:'planner.creditBudget',accountId:'99999999-9999-4999-8999-999999999999',budget:{minor:0,currency:'USD'}});
    return {initial,saved,invalid,unchanged:before===JSON.stringify((await window.ccu.request({action:'inventory',accountId})).data)};
  });
  assert.deepEqual(budgetSaved.initial,{ok:true,data:null});
  assert.deepEqual(budgetSaved.saved,{ok:true,data:{minor:4000,currency:'USD'}});
  assert.equal(budgetSaved.invalid.ok,false);assert.equal(budgetSaved.unchanged,true);
  results.push('Echte Budget-IPC speichert den Betrag nur in einem vorhandenen lokalen Profil; Inventar unveraendert.');
  if (marketFixture) {
    await page.getByRole('button', { name: /CCU-Planer/ }).click();
    await page.waitForFunction(async () => !(await window.ccu.request({ action: 'market.status' })).data.pending);
    await page.locator('.market-offer').waitFor(); await page.getByLabel('Zielschiff 1', { exact: true }).selectOption('62');
    await page.waitForFunction(() => document.querySelector('.market-target h2').textContent === 'Synthetic Market Ship');
    assert.match(await page.locator('.market-target').first().innerText(), /Kettenvorschau unten/);
    assert.match(await page.locator('.ccu-total').innerText(), /noch offen/);
    assert.ok(await page.locator('.ccu-step.purchase').count() > 0, 'Unpriced standard gaps must remain visible, not turn into quoted target values');
    assert.match(await page.locator('.market-target').first().innerText(), /≈\s*325,73\s*€/);
    assert.match(await page.locator('.market-target').first().innerText(), /360,00\s*\$/);
    const reject=await page.evaluate(async()=>window.ccu.request({action:'market.openShip',shipId:62,url:'https://example.invalid'}));assert.equal(reject.ok,false);
    const savedPreferences=await page.evaluate(async()=>window.ccu.request({action:'pricing.save',settings:{schemaVersion:1,language:'de',currency:'EUR',taxMode:'net',vatBasisPoints:850}}));assert.equal(savedPreferences.ok,true);assert.equal(JSON.parse(fs.readFileSync(path.join(pricingDirectory,'display-v1.json'),'utf8')).vatBasisPoints,850);
    results.push('Anzeige-IPC speichert echte synthetische Praeferenzen; freie externe URLs werden abgewiesen, kein Standardbrowser geoeffnet.');
    assert.equal((await page.evaluate(async () => (await window.ccu.request({ action: 'market.status' })).data)).catalogue.ships.length, 1, 'Public transport must respect the rejecting test proxy');
    assert.equal(fs.readdirSync(marketDirectory).some(n => n.startsWith('targets-')), true);
    results.push('Neue Markt-IPC, synthetischer Offlinecache und Zielwahl in echter Installer-Nutzlast geprueft; Proxy nicht umgangen und Zusatzkosten ungeprueft.');
    await page.getByRole('button', { name: 'Bestand', exact: true }).click();
  }
  await close(); const second = await open();
  assert.equal(await second.getByRole('button', { name: 'CCUs', exact: true }).getAttribute('aria-pressed'), 'true');
  await second.getByRole('button', { name: 'Alle Gegenstände', exact: true }).click();
  const currentShip = second.locator('tbody tr[data-pledge="demo-base-alpha"] td').first();
  await currentShip.waitFor();
  assert.equal((await currentShip.innerText()).trim(), 'Demo Alpha');
  assert.match(await currentShip.getAttribute('title'), /Demo-Basisschiff Alpha/);
  assert.doesNotMatch(await currentShip.innerText(), /Demo-Basisschiff Alpha/);
  assert.equal(await second.locator('tbody tr').count(), 5);
  results.push('Verpackte EXE erneut gestartet: gespeicherter Bestand erhalten.');
  const reviewRestored=await second.evaluate(async()=>{
    const accountId=(await window.ccu.request({action:'state'})).data.accounts[0].id,key='a'.repeat(64);
    const restored=await window.ccu.request({action:'loaners.reviews',accountId});
    const corrected=await window.ccu.request({action:'loaners.review',accountId,key,state:'absent'});
    const reset=await window.ccu.request({action:'loaners.review',accountId,key,state:'unconfirmed'});
    return {restored,corrected,reset};
  });
  assert.equal(reviewRestored.restored.ok,true);assert.equal(reviewRestored.restored.data.entries['a'.repeat(64)].state,'present');assert.equal(reviewRestored.corrected.data.entries['a'.repeat(64)].state,'absent');assert.equal(reviewRestored.reset.data.entries['a'.repeat(64)],undefined);
  results.push('Benutzerangabe nach echtem EXE-Neustart erhalten, ueber echte IPC korrigiert und zurueckgesetzt; kein Loaner- oder Inventarbesitz daraus erzeugt.');
  const planRestored=await second.evaluate(async()=>{
    const accountId=(await window.ccu.request({action:'state'})).data.accounts[0].id;
    const restored=await window.ccu.request({action:'planner.draft',accountId,targetId:990});
    const corrected=await window.ccu.request({action:'planner.draft',accountId,targetId:990,draft:{...restored.data,mode:'auto'}});
    return {restored,corrected};
  });
  assert.equal(planRestored.restored.ok,true);assert.deepEqual(planRestored.restored.data,planSaved.draft);assert.equal(planRestored.corrected.ok,true);assert.equal(planRestored.corrected.data.mode,'auto');assert.deepEqual(planRestored.corrected.data.anchors,planSaved.draft.anchors);
  results.push('Manueller Entwurf nach echtem EXE-Neustart erhalten; Wechsel zum Vorschlag bewahrt die persoenlichen Anker.');
  const batchRestored=await second.evaluate(async()=>{const accountId=(await window.ccu.request({action:'state'})).data.accounts[0].id;return Promise.all([991,992].map(targetId=>window.ccu.request({action:'planner.draft',accountId,targetId})));});
  assert.ok(batchRestored.every(r=>r.ok));assert.ok(batchRestored.every(r=>JSON.stringify(r.data)===JSON.stringify(batchSaved.draft)));
  results.push('Beide gemeinsam uebernommenen Berater-Entwuerfe bleiben nach echtem EXE-Neustart erhalten.');
  const exclusionRestored=await second.evaluate(async()=>{
    const accountId=(await window.ccu.request({action:'state'})).data.accounts[0].id,before=JSON.stringify((await window.ccu.request({action:'planner.draft',accountId,targetId:990})).data);
    const loaded=await window.ccu.request({action:'planner.exclusions',accountId});
    const reset=await window.ccu.request({action:'planner.exclude',accountId,ccuKey:loaded.data[0],excluded:false});
    return {loaded,reset,draftUnchanged:before===JSON.stringify((await window.ccu.request({action:'planner.draft',accountId,targetId:990})).data)};
  });
  assert.deepEqual(exclusionRestored.loaded.data,[exclusionSaved.key]);assert.equal(exclusionRestored.reset.ok,true);assert.deepEqual(exclusionRestored.reset.data,[]);assert.equal(exclusionRestored.draftUnchanged,true);
  results.push('CCU-Sperre nach echtem Nutzlast-Neustart erhalten und freigegeben; gespeicherter eigener Entwurf bleibt unveraendert.');
  const priorityRestored=await second.evaluate(async()=>{const accountId=(await window.ccu.request({action:'state'})).data.accounts[0].id,before=JSON.stringify((await window.ccu.request({action:'planner.draft',accountId,targetId:990})).data);const restored=await window.ccu.request({action:'planner.priorities',accountId}),changed=await window.ccu.request({action:'planner.priorities',accountId,order:[2,1,0]});return {restored,changed,draftUnchanged:before===JSON.stringify((await window.ccu.request({action:'planner.draft',accountId,targetId:990})).data)};});
  assert.equal(priorityRestored.restored.ok,true);assert.deepEqual(priorityRestored.restored.data,[1,0,2]);assert.deepEqual(priorityRestored.changed.data,[2,1,0]);assert.equal(priorityRestored.draftUnchanged,true);results.push('Vorrang nach echtem EXE-Neustart erhalten und korrigierbar; gespeicherter Kettenentwurf bleibt unveraendert.');
  const budgetRestored=await second.evaluate(async()=>{
    const accountId=(await window.ccu.request({action:'state'})).data.accounts[0].id;
    return window.ccu.request({action:'planner.creditBudget',accountId});
  });
  assert.deepEqual(budgetRestored,budgetSaved.saved);
  results.push('Grenze und Waehrung des Store-Credit-Budgets nach echtem Nutzlast-Neustart wiederhergestellt.');
  if (marketFixture) {
    await second.getByRole('button', { name: /CCU-Planer/ }).click();
    await second.waitForFunction(() => document.querySelector('[aria-label="Zielschiff 1"]').value === '62');
    await second.locator('.market-target h2').first().filter({ hasText: 'Synthetic Market Ship' }).waitFor();
    const priceState=await second.evaluate(async()=>(await window.ccu.request({action:'pricing.status'})).data);assert.equal(priceState.settings.currency,'EUR');assert.equal(priceState.settings.vatBasisPoints,850);assert.equal(priceState.rate.usdPerEurMicros,1105200);
    await second.getByRole('button', { name: 'Bestand', exact: true }).click();
    results.push('Lokale Zielwahl nach echtem Nutzlast-Neustart wiederhergestellt; Inventar getrennt erhalten.');
  }
  assert.equal(fs.existsSync(diagnosticFile), false);
  if(process.env.CCU_SKIP_RSI_PROBE!=='1'){
  const diagnosticResponse = await second.evaluate(async () => {
    const profile = await window.ccu.request({ action: 'account.create', name: 'Synthetisches Diagnoseprofil', mode: 'real' });
    if (!profile.ok) return profile;
    return window.ccu.request({ action: 'rsi.connect', accountId: profile.data.id, remember: false });
  });
  assert.equal(diagnosticResponse.ok, false);
  assert.match(diagnosticResponse.error, /ERR_TUNNEL_CONNECTION_FAILED.*lokal gespeichert/);
  assert.ok(blockedTunnels > 0);
  const diagnostics = JSON.parse(fs.readFileSync(diagnosticFile, 'utf8'));
  assert.equal(diagnostics.appVersion, expected.version);
  assert.ok(diagnostics.events.every(e => e.appVersion === expected.version));
  assert.ok(diagnostics.events.some(e => e.networkError === 'ERR_TUNNEL_CONNECTION_FAILED' && e.event === 'load-failed'));
  assert.equal(fs.readFileSync(diagnosticFile, 'utf8').includes('https://'), false);
  results.push('Automatische Fehlererfassung in echter Installer-Nutzlast: abweisender lokaler Proxy, Fehlercode in IPC und Datei, kein RSI-Zugriff oder Zugangsdaten. Normaler Start erzeugt keine Verbindungsdiagnose.');
  }else results.push('RSI-Verbindungsprobe ausdruecklich ausgelassen; kein Anmeldefenster und keine Verbindungsdiagnose gestartet.');
  fs.writeFileSync(path.join(runDir, 'results.json'), JSON.stringify({ status: 'PASS', data: 'synthetic-only', executable, runtime, results }, null, 2));
  console.log('PASS:', results.join('\nPASS: ')); console.log('REPORT:', path.join(runDir, 'results.json'));
} catch (error) {
  fs.writeFileSync(path.join(runDir, 'results.json'), JSON.stringify({ status: 'FAIL', results, error: error.message }, null, 2)); console.error(error); process.exitCode = 1;
} finally { await close(); if (proxy.listening) await new Promise(resolve => proxy.close(resolve)); }
