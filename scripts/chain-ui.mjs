import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {createRequire} from 'node:module';import {build} from 'esbuild';import {_electron} from 'playwright-core';import {extractFile} from '@electron/asar';
const folder=path.resolve('work/temp/chain-ui',randomUUID());fs.mkdirSync(folder,{recursive:true});
const packaged=process.env.CCU_TEST_ASAR;const testVersion=JSON.parse(fs.readFileSync('package.json','utf8')).version;
if(packaged){for(const name of ['app.js','app.css','planner-worker.js','advisor-worker.js'])fs.writeFileSync(path.join(folder,name),extractFile(packaged,path.normalize('build/renderer/'+name)));}
else await Promise.all([build({entryPoints:['src/ui/App.tsx'],outfile:path.join(folder,'app.js'),bundle:true,platform:'browser',target:'chrome156'}),build({entryPoints:['src/ui/planner-worker.ts'],outfile:path.join(folder,'planner-worker.js'),bundle:true,platform:'browser',format:'esm',target:'chrome156'}),build({entryPoints:['src/ui/advisor-worker.ts'],outfile:path.join(folder,'advisor-worker.js'),bundle:true,platform:'browser',format:'esm',target:'chrome156'})]);
fs.copyFileSync('assets/app.svg',path.join(folder,'app.svg'));
fs.copyFileSync('assets/app.png',path.join(folder,'app.png'));fs.copyFileSync('tests/fixtures/ship-display-preload.cjs',path.join(folder,'fixture-preload.cjs'));
fs.mkdirSync(path.join(folder,'fonts'));
for(const name of ['brand.css','fonts/Orbitron.ttf','kofi-logo.png']){
  if(packaged)fs.writeFileSync(path.join(folder,name),extractFile(packaged,path.normalize('build/renderer/'+name)));
  else fs.copyFileSync(path.join('assets',name),path.join(folder,name));
}
let main=fs.readFileSync('tests/fixtures/upgrade-history-ui-main.cjs','utf8');const anchor='  fixture.commands.push(copy(command));';assert.equal(main.split(anchor).length,2);
main=main.replace(anchor,anchor+`
  if(command.action==='market.status'||command.action==='market.refresh')return {ok:true,data:copy(fixture.market)};
  if(command.action==='market.shopPrices')return {ok:true,data:null};
  if(command.action==='market.fairSeen'){
    fixture.market.fairNews.unread=fixture.market.fairNews.unread.filter(notice=>notice.id!==command.noticeId);
    return {ok:true,data:copy(fixture.market)};
  }
  if(command.action==='planner.draft'){fixture.drafts??={};const key=command.accountId+':'+command.targetId;if(command.draft){if(fixture.draftFailure)return {ok:false,error:'SYNTHETIC_SAVE_FAILURE'};fixture.drafts[key]=copy(command.draft);}const result={ok:true,data:copy(fixture.drafts[key]??null)};if(command.draft&&fixture.holdSave===command.accountId)return new Promise(resolve=>(fixture.pendingSaves??=[]).push(()=>resolve(result)));if(!command.draft&&fixture.holdLoad===command.accountId)return new Promise(resolve=>(fixture.pendingLoads??=[]).push(()=>resolve(result)));return result;}
  if(command.action==='rsi.refresh'){const view=fixture.views[command.accountId];return {ok:true,data:{status:'connected',revision:view?.revision??null,changed:true,view:copy(view)}};}
  if(command.action==='market.openUpgrades')return fixture.shopFailure?{ok:false,error:'SYNTHETIC_BROWSER_FAILURE'}:{ok:true,data:{opened:true,prefilled:false}};
  if(command.action==='help.openRsi')return fixture.helpFailure?{ok:false,error:'SYNTHETIC_BROWSER_FAILURE'}:{ok:true,data:{opened:true}};
  if(command.action==='help.openResource')return fixture.helpFailure?{ok:false,error:'SYNTHETIC_BROWSER_FAILURE'}:{ok:true,data:{opened:true}};
  if(command.action==='help.readDocument')return {ok:true,data:'Synthetic '+command.document+' text'};
  if(command.action==='help.checkUpdate')return {ok:true,data:copy(fixture.releaseUpdate??null)};
  if(command.action==='help.openUpdate')return fixture.helpFailure?{ok:false,error:'SYNTHETIC_BROWSER_FAILURE'}:{ok:true,data:{opened:true}};
  if(command.action==='market.targets'){if(command.ids)fixture.targets[command.accountId]=command.ids;return {ok:true,data:copy(fixture.targets[command.accountId]??[null,null,null])};}
  if(command.action==='planner.creditBudget'){fixture.creditBudgets??={};if(command.budget)fixture.creditBudgets[command.accountId]=copy(command.budget);return {ok:true,data:copy(fixture.creditBudgets[command.accountId]??null)};}
  if(command.action==='pricing.status')return {ok:true,data:copy(fixture.pricing)};
  if(command.action==='pricing.save'){fixture.pricing.settings=copy(command.settings);return {ok:true,data:copy(command.settings)};}
`);fs.writeFileSync(path.join(folder,'fixture-main.cjs'),main);
const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222',at=new Date().toISOString(),old=new Date(Date.now()-10000).toISOString();
const account={id:a,name:'SYNTHETISCH · A',mode:'real',reference:null,identityKind:null,identityStatus:'unbound',lastComplete:null},other={...account,id:b,name:'SYNTHETISCH · B',mode:'demo'};
const ships=['LTI Starter','Freelancer DUR','Constellation Mk V Test','C2 Hercules Starlifter','Liberator','Alternatives Testziel','Alternatives Zwischenmodell'].map((name,i)=>({id:i+1,name,chassisId:null,manufacturer:'Test',manufacturerCode:'TEST',status:'unknown',focus:'',length:null,storeUrl:null}));
const offers=ships.map((s,i)=>({key:'test:'+s.id,name:'Upgrade to '+s.name,targetName:s.name,toShipId:s.id,toSkuId:100+s.id,regularMinor:[1000,2000,4000,5000,10000,12000,3500][i],warbondMinor:s.id===5?9500:null,warbond:s.id===5,currency:'USD',taxBasis:'net',verification:'target-observation',firstSeenAt:at,lastSeenAt:at,change:'current',previousRegularMinor:null,previousWarbondMinor:null}));
const pledge=id=>({pledgeId:id,name:'SYNTHETISCH '+id,insurance:{kind:'lti',evidence:'Synthetic'},originalDescription:'Original Hornet; current model is authoritative',ships:[],ccus:[],protected:true,baseReleased:false,restrictions:[],acquisitionCost:null,unknownCostReason:'unknown',meltValue:null,sourceValues:{}});
const base=pledge('base');base.ships=[{childId:'current',modelName:ships[0].name,modelId:null,identity:'unresolved',role:'unverified'}];
const ccu=(id,from,to)=>({...pledge(id),name:'SYNTHETISCH Warbond '+id,
  sourceValues:{upgrade:JSON.stringify({from,to}),upgradeEvidence:JSON.stringify({resolution:'structured-unique',sourceCandidates:1,targetCandidates:1})},
  ccus:[{instanceId:id+':ccu',from,to,status:'unverified',applicability:'unverified',insurance:{kind:'unknown',reason:'synthetic'}}]});
const entries=[base,ccu('owned-a',ships[1].name,ships[2].name),ccu('owned-b',ships[3].name,ships[4].name),ccu('owned-alt',ships[1].name,ships[6].name)];
const applied=ccu('applied',ships[0].name,ships[4].name);applied.ccus[0].status='applied';entries.push(applied);
const removed=ccu('removed',ships[0].name,ships[4].name);
const revision='33333333-3333-4333-8333-333333333333';
const observedDocument={type:'sarevocs-ccu-inventory',schemaVersion:1,appVersion:testVersion,createdAt:at,dataMode:'real',account:{reference:'synthetic-account',identityKind:'manual-reference'},scope:{kind:'partial',exportComplete:false,expectedPledges:null,pagesExpected:null,pagesRead:null},pledges:entries,buybacks:[]};
const fixture={state:{accounts:[account,other],selectedAccountId:a,dataDir:'SYNTHETISCH',version:testVersion,packaged:false,electron:'fixture',node:'fixture'},inventories:{[a]:{account,items:[{pledge:removed,availability:'removed',source:'fixture',importedAt:old}],buybacks:[]},[b]:{account:other,items:[],buybacks:[]}},views:{[a]:{accountId:a,revision,observedAt:at,document:observedDocument}},targets:{[a]:[5,null,null]},pricing:{settings:{schemaVersion:1,language:'de',currency:'EUR',taxMode:'gross',vatBasisPoints:1900},configured:true,settingsError:false,rate:{source:"ECB",sourceDate:at.slice(0,10),usdPerEurMicros:1100000,fetchedAt:at},pending:false,rateError:false},market:{schemaVersion:1,catalogue:{fetchedAt:at,ships},offers:{fetchedAt:at,sourceAt:at,checkedAt:at,items:offers},pending:false,errors:{catalogue:null,offers:null},refreshSchedule: { hour: 17, timeZone: 'Europe/Berlin' }}};
fixture.drafts=Object.fromEntries([5,6,7].map(id=>[a+':'+id,{mode:'auto',initialized:false,baseKey:JSON.stringify(['base','current']),baseApprovedKey:JSON.stringify(['base','current']),anchors:[]}]));
fixture.releaseUpdate={tag:'v0.4.0-alpha',version:'0.4.0 Alpha',notes:{de:['Synthetische Neuerung für diesen Test.'],en:['Synthetic change for this test.']}};
fs.writeFileSync(path.join(folder,'fixture.json'),JSON.stringify(fixture));fs.writeFileSync(path.join(folder,'index.html'),'<!doctype html><html lang="de"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'self\'; worker-src \'self\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\'; font-src \'self\'; connect-src \'none\'"><link rel="stylesheet" href="app.css"><link rel="stylesheet" href="brand.css"><div id="root"></div><script src="app.js"></script></html>');
const env={...process.env,TEMP:path.join(folder,'tmp'),TMP:path.join(folder,'tmp')};fs.mkdirSync(env.TEMP,{recursive:true});delete env.ELECTRON_RUN_AS_NODE;delete env.NODE_OPTIONS;
const checks=[],errors=[];let app;const check=async(name,fn)=>{await fn();checks.push(name);console.log('PASS: '+name)};
try{
  app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),args:[path.join(folder,'fixture-main.cjs'),'--disable-gpu','--disable-background-networking','--host-resolver-rules=MAP * ~NOTFOUND'],env});
  const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.getByRole('heading',{name:'Bestand',exact:true}).waitFor();
  await check('GLASS_SIDEBAR_FITS_WITH_BOTH_SUPPORT_BUTTONS',async()=>{
    const nav=page.getByRole('navigation',{name:'Hauptbereiche'});
    const original=await page.evaluate(()=>({width:innerWidth,height:innerHeight}));
    await page.evaluate(()=>document.fonts.ready.then(()=>true));
    const support=page.locator('.sidebar-support');
    const kofi=support.getByRole('button',{name:'Sarevoc auf Ko-fi unterstützen'});
    const paypal=support.getByRole('button',{name:'Sarevoc über PayPal unterstützen'});
    assert.equal(await support.getByRole('button').count(),2);
    assert.equal(await kofi.locator('img').evaluate(async img=>{await img.decode();return img.naturalWidth>0;}),true);
    assert.equal(await app.evaluate(()=>globalThis.fixture.commands.some(command=>['kofi','paypal'].includes(command.resource))),false);
    for(const size of [{width:1440,height:850},{width:1024,height:700}]){
      await page.setViewportSize(size);
      assert.equal(await page.locator('aside').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
    }
    const active=nav.getByRole('button',{name:/Bestand/});
    assert.match(await active.evaluate(el=>getComputedStyle(el).backgroundImage),/linear-gradient/);
    const fleetNav=nav.getByRole('button',{name:/Flottenplan/});
    assert.equal(await active.getAttribute('aria-current'),'page');
    assert.notEqual(await active.evaluate(el=>getComputedStyle(el).backgroundImage),
      await fleetNav.evaluate(el=>getComputedStyle(el).backgroundImage));
    const iconColors=await nav.locator('.sidebar-menu-icon').evaluateAll(icons=>icons.map(icon=>getComputedStyle(icon).color));
    assert.equal(iconColors.length,6);
    assert.equal(new Set(iconColors).size,6);
    assert.equal(await nav.locator('svg[focusable="false"]').count(),6);
    await fleetNav.hover();
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('aside nav button[data-menu="fleet"]')).boxShadow.includes('13px'));
    assert.equal(await fleetNav.evaluate(el=>getComputedStyle(el).getPropertyValue('--edge-start').trim()),'#80e7d3');
    assert.equal(await fleetNav.evaluate(el=>getComputedStyle(el).getPropertyValue('--edge-end').trim()),'#ffb37d');
    await active.focus();
    await page.keyboard.press('Tab');
    assert.equal(await nav.getByRole('button',{name:'CCU-Planer',exact:true}).evaluate(el=>el.matches(':focus-visible')&&getComputedStyle(el).outlineStyle==='solid'),true);
    await kofi.click();
    await paypal.click();
    assert.deepEqual(await app.evaluate(()=>globalThis.fixture.commands.filter(command=>['kofi','paypal'].includes(command.resource))),
      [{action:'help.openResource',resource:'kofi'},{action:'help.openResource',resource:'paypal'}]);
    await page.setViewportSize(original);
  });
  await check('SHARED_GLASS_FRAME_AND_FOCUS_APPLY_TO_INVENTORY_ACTIONS_AND_TABS',async()=>{
    const action=page.locator('.connection-actions button.primary');
    const active=page.locator('.filters button[aria-pressed="true"]').first();
    const unselected=page.getByRole('button',{name:'Schiffe & Fahrzeuge',exact:true});
    const disabled=page.getByRole('button',{name:'UI-Werkstatt',exact:true});
    const frame=button=>button.evaluate(el=>getComputedStyle(el,'::after').backgroundImage);
    assert.match(await frame(action),/^linear-gradient\(90deg,/);
    assert.notEqual(await frame(active),await frame(unselected));
    await action.hover();
    assert.equal(await action.evaluate(el=>getComputedStyle(el).getPropertyValue('--edge-start').trim()),'#80e7d3');
    assert.equal(await action.evaluate(el=>getComputedStyle(el).getPropertyValue('--edge-end').trim()),'#ffb37d');
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('.connection-actions button.primary')).boxShadow.includes('13px'));
    assert.equal(await disabled.isDisabled(),true);
    assert.notEqual(await disabled.evaluate(el=>getComputedStyle(el).opacity),'1');
    await page.keyboard.press('Tab');
    await unselected.focus();
    assert.equal(await unselected.evaluate(el=>el.matches(':focus-visible')&&getComputedStyle(el).outlineStyle==='solid'),true);
    await page.emulateMedia({reducedMotion:'reduce'});
    assert.equal(await action.evaluate(el=>getComputedStyle(el).transitionDuration),'0s');
    await page.emulateMedia({reducedMotion:'no-preference'});
    const viewport=await page.evaluate(()=>({width:innerWidth,height:innerHeight}));
    await page.setViewportSize({width:1440,height:850});
    await page.screenshot({path:path.join(folder,'schaltflaechen-testdaten.png')});
    await page.setViewportSize(viewport);
  });
  await check('HELP_USES_GLOBAL_DE_EN_AND_OPENS_ONLY_FIXED_OFFICIAL_TOPICS',async()=>{
    const navDe=page.getByRole('navigation',{name:'Hauptbereiche'});
    const navEn=page.getByRole('navigation',{name:'Main sections'});
    const firstCommand=await app.evaluate(()=>globalThis.fixture.commands.length);
    const help=page.locator('.help-view');
    await navDe.getByRole('button',{name:/Hilfe & Einstieg/}).click();
    await help.getByRole('heading',{name:'Hilfe & Einstieg',exact:true}).waitFor();
    assert.equal(await help.locator('.help-update-button, .help-update-dialog').count(),0);
    assert.equal(await help.getByRole('heading',{level:2}).count(),6);
    assert.equal(await help.getByRole('button',{name:/^(Deutsch|English)$/}).count(),0);
    assert.equal(await page.locator('.connection-line').count(),0);
    const initialViewport=await page.evaluate(()=>({width:innerWidth,height:innerHeight}));
    await page.setViewportSize({width:1440,height:1100});
    const chapters=[['Spielzugang','access'],['Was ist ein CCU?','ccu'],['Beispielkette','chain']];
    for(const [name,id] of chapters){
      const topic=help.getByRole('link',{name,exact:true});
      const chapter=help.locator('#help-'+id);
      await topic.click();
      assert.equal(await page.evaluate(()=>scrollY),0,'The full help fits without scrolling');
      assert.equal(await page.evaluate(()=>document.activeElement.id),'help-'+id);
      assert.equal(await topic.getAttribute('aria-current'),'location');
      assert.equal(await help.locator('[aria-current="location"]').count(),1);
      assert.equal(await help.locator('.help-chapter[data-current="true"]').count(),1);
      assert.equal(await chapter.evaluate(el=>getComputedStyle(el).outlineStyle),'solid');
    }
    await help.screenshot({path:path.join(folder,'hilfe-und-einstieg-de.png')});
    await help.getByRole('button',{name:'Sicherheit & Download',exact:true}).click();
    assert.equal(await help.locator('.help-hash code').nth(1).textContent(),'3ede28bc5388df522765a10c5dc2c61f8b68a2cb75ef18731ac534a949bac016');
    await help.getByText('Nutzungsbedingungen',{exact:true}).click();
    await help.getByText('Synthetic terms text',{exact:true}).waitFor();
    await help.getByText('Datenschutz',{exact:true}).click();
    await help.getByText('Synthetic privacy text',{exact:true}).waitFor();
    await help.getByText('Fremdkomponenten und Lizenzen',{exact:true}).click();
    await help.getByText('Synthetic notices text',{exact:true}).waitFor();
    await help.screenshot({path:path.join(folder,'hilfe-sicherheit-de.png')});
    await help.getByRole('button',{name:'Joystick Guardian',exact:true}).click();
    await help.getByRole('heading',{name:'Belegungen prüfen',exact:true}).waitFor();
    await help.getByRole('button',{name:'Community & Tools',exact:true}).click();
    const community = help.locator('.help-resource-panel');
    const communityLinks = community.getByRole('button');
    for (const width of [1560, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      await page.mouse.move(0, 0);
      const layout = await communityLinks.evaluateAll(links => links.map(link => {
        const text = link.querySelector('.help-link-label').getBoundingClientRect();
        const icon = link.querySelector('.help-link-icon').getBoundingClientRect();
        const card = link.closest('article').getBoundingClientRect();
        return {
          framed: getComputedStyle(link, '::after').content !== 'none',
          clean: text.right < icon.left && icon.right < card.right && icon.top < text.bottom && link.scrollWidth <= link.clientWidth,
        };
      }));
      assert.equal(layout.length,5);
      assert.ok(layout.every(link => !link.framed && link.clean),`Community links fit at ${width}px`);
      await community.screenshot({path:path.join(folder,`hilfe-community-${width}.png`)});
    }
    const firstCommunityLink = community.getByRole('button',{name:'The Eternal Companions',exact:true});
    await help.getByRole('button',{name:'Community & Tools',exact:true}).press('Tab');
    assert.equal(await firstCommunityLink.evaluate(link => document.activeElement === link && getComputedStyle(link).outlineStyle === 'solid'),true);
    await page.keyboard.press('Enter');
    for(const name of ['Kerberos','Die Bauaufsicht','Arasil','Erkul']){
      await community.getByRole('button',{name,exact:true}).click();
    }
    assert.deepEqual(await app.evaluate(()=>globalThis.fixture.commands.filter(command=>command.action==='help.openResource'&&!['kofi','paypal'].includes(command.resource))),
      ['teces','kerberos','bauaufsicht','arasil','erkul'].map(resource=>({action:'help.openResource',resource})));
    await help.getByRole('button',{name:'Fehler melden',exact:true}).click();
    await help.getByRole('button',{name:'Einstieg',exact:true}).click();
    await help.getByRole('link',{name:'Was ist ein CCU?',exact:true}).press('Enter');
    assert.equal(await help.getByRole('link',{name:'Was ist ein CCU?',exact:true}).getAttribute('aria-current'),'location');
    assert.equal(await page.evaluate(()=>document.activeElement.id),'help-ccu');
    await help.getByRole('button',{name:/RSI-Anleitung zu Schiffsupgrades/}).click();
    assert.deepEqual(await app.evaluate(()=>globalThis.fixture.commands.find(command=>command.action==='help.openRsi')),{action:'help.openRsi',topic:'upgrades'});
    await page.setViewportSize(initialViewport);
    await navDe.getByRole('button',{name:/Daten & Einstellungen/}).click();
    await page.getByRole('combobox',{name:'Sprache',exact:true}).selectOption('en');
    await page.getByRole('button',{name:'Speichern',exact:true}).click();
    await navEn.getByRole('button',{name:/Help & Getting Started/}).click();
    await help.getByRole('heading',{name:'Help & Getting Started',exact:true}).waitFor();
    await help.getByRole('heading',{name:'How a chain fits together',exact:true}).waitFor();
    await help.getByRole('button',{name:'Security & Downloads',exact:true}).click();
    await help.getByRole('heading',{name:'Terms and licenses',exact:true}).waitFor();
    await help.getByRole('button',{name:'Report a bug',exact:true}).click();
    assert.deepEqual(await app.evaluate(()=>globalThis.fixture.commands.filter(command=>command.action==='help.openResource'&&command.resource.startsWith('bugReport'))),
      [{action:'help.openResource',resource:'bugReportDe'},{action:'help.openResource',resource:'bugReportEn'}]);
    await help.getByRole('button',{name:'Getting started',exact:true}).click();
    assert.equal(await page.locator('html').getAttribute('lang'),'en');
    assert.equal(await help.getByRole('heading',{level:2}).count(),6);
    assert.equal(await help.getByRole('heading',{name:'So entsteht eine Kette'}).count(),0);
    await help.screenshot({path:path.join(folder,'hilfe-und-einstieg-en.png')});
    const viewport=await page.evaluate(()=>({width:innerWidth,height:innerHeight}));
    await page.setViewportSize({width:1024,height:700});
    assert.equal(await help.evaluate(el=>el.scrollWidth<=el.clientWidth&&document.documentElement.scrollWidth<=innerWidth),true);
    const plannerTopic=help.getByRole('link',{name:'Using the planner',exact:true});
    await plannerTopic.press('Enter');
    assert.equal(await plannerTopic.getAttribute('aria-current'),'location');
    assert.equal(await page.evaluate(()=>document.activeElement.id),'help-planner');
    assert.equal(await help.locator('#help-heading-planner').evaluate(el=>el.getBoundingClientRect().bottom<=innerHeight),true);
    await navEn.getByRole('button',{name:/Help & Getting Started/}).scrollIntoViewIfNeeded();
    assert.equal(await navEn.getByRole('button',{name:/Help & Getting Started/}).getAttribute('aria-current'),'page');
    await page.setViewportSize(viewport);
    await app.evaluate(()=>{globalThis.fixture.helpFailure=true;});
    await help.getByRole('button',{name:'Report a bug',exact:true}).click();
    await help.getByText('Could not open the GitHub form.',{exact:true}).waitFor();
    await app.evaluate(()=>{globalThis.fixture.helpFailure=false;});
    await help.getByRole('button',{name:'Report a bug',exact:true}).click();
    await help.getByText('Could not open the GitHub form.',{exact:true}).waitFor({state:'hidden'});
    await app.evaluate(()=>{globalThis.fixture.helpFailure=true;});
    await help.getByRole('button',{name:/RSI store credit rules/}).click();
    await help.getByRole('alert').getByText('Could not open the RSI help page.',{exact:true}).waitFor();
    await app.evaluate(()=>{globalThis.fixture.helpFailure=false;});
    await navEn.getByRole('button',{name:/Data & settings/i}).click();
    await page.getByRole('combobox',{name:'Language',exact:true}).selectOption('de');
    await page.getByRole('button',{name:'Save',exact:true}).click();
    await navDe.getByRole('button',{name:/Bestand/}).click();
    await page.getByRole('heading',{name:'Bestand',exact:true}).waitFor();
    const commands=await app.evaluate(({},start)=>globalThis.fixture.commands.slice(start),firstCommand);
    assert.equal(commands.some(command=>/^rsi\.(open|connect|authorize|refresh)$/.test(command.action)),false);
  });
  await check('STARTUP_UPDATE_NOTICE_ONLY_ON_INVENTORY_WITH_ONE_CHECK',async()=>{
    const help=page.locator('.help-view');
    const nav=page.getByRole('navigation',{name:'Hauptbereiche'});
    const update=page.locator('.inventory-header-actions').getByRole('button',{name:'Update verfügbar · 0.4.0 Alpha',exact:true});
    const notice=page.getByRole('dialog',{name:'Update verfügbar'});
    await nav.getByRole('button',{name:/Bestand/}).click();
    await update.waitFor();
    assert.equal(await notice.count(),0);
    assert.equal(await page.locator('.connection-actions').getByRole('button',{name:'Daten aktualisieren',exact:true}).count(),1);
    assert.deepEqual(await app.evaluate(()=>globalThis.fixture.commands.filter(c=>/^help\.(checkUpdate|openUpdate)$/.test(c.action))),[{action:'help.checkUpdate'}]);
    await nav.getByRole('button',{name:/Hilfe & Einstieg/}).click();
    await help.getByRole('button',{name:'Sicherheit & Download',exact:true}).click();
    assert.equal(await update.count(),0);
    assert.equal(await notice.count(),0);
    const firstCommand=await app.evaluate(()=>globalThis.fixture.commands.length);
    await nav.getByRole('button',{name:/Bestand/}).click();
    await update.waitFor();
    assert.equal(await notice.count(),0);
    assert.deepEqual(await app.evaluate(({},start)=>globalThis.fixture.commands.slice(start).filter(c=>c.action.startsWith('help.')),firstCommand),
      []);
    const viewport=await page.evaluate(()=>({width:innerWidth,height:innerHeight}));
    await page.setViewportSize({width:1024,height:700});
    assert.equal(await page.locator('.inventory-header-actions').evaluate(el=>el.scrollWidth<=el.clientWidth&&el.getBoundingClientRect().right<=innerWidth),true);
    await update.click();
    await notice.getByRole('heading',{name:'Was ist neu?'}).waitFor();
    await notice.getByText('Synthetische Neuerung für diesen Test.',{exact:true}).waitFor();
    await page.screenshot({path:path.join(folder,'update-hinweis-testdaten.png')});
    await notice.getByRole('button',{name:'Schließen',exact:true}).click();
    await notice.waitFor({state:'hidden'});
    await update.click();
    await app.evaluate(()=>{globalThis.fixture.helpFailure=true;});
    const download=notice.getByRole('button',{name:'Auf GitHub downloaden',exact:true});
    await download.click();
    await notice.getByRole('alert').waitFor();
    await app.evaluate(()=>{globalThis.fixture.helpFailure=false;});
    await download.click();
    await notice.waitFor({state:'hidden'});
    assert.deepEqual(await app.evaluate(({},start)=>globalThis.fixture.commands.slice(start).filter(c=>c.action==='help.openUpdate'),firstCommand),
      Array(2).fill({action:'help.openUpdate',tag:'v0.4.0-alpha'}));
    await nav.getByRole('button',{name:/Daten & Einstellungen/}).click();
    await page.getByRole('combobox',{name:'Sprache',exact:true}).selectOption('en');
    await page.getByRole('button',{name:'Speichern',exact:true}).click();
    const navEn=page.getByRole('navigation',{name:'Main sections'});
    await navEn.getByRole('button',{name:'Inventory',exact:true}).click();
    await page.getByRole('button',{name:'Update available · 0.4.0 Alpha',exact:true}).click();
    const noticeEn=page.getByRole('dialog',{name:'Update available'});
    await noticeEn.getByText('Synthetic change for this test.',{exact:true}).waitFor();
    await noticeEn.getByRole('button',{name:'Download on GitHub',exact:true}).waitFor();
    await page.keyboard.press('Escape');
    await noticeEn.waitFor({state:'hidden'});
    await navEn.getByRole('button',{name:/Data & settings/i}).click();
    await page.getByRole('combobox',{name:'Language',exact:true}).selectOption('de');
    await page.getByRole('button',{name:'Save',exact:true}).click();
    await page.setViewportSize(viewport);
  });
  await page.getByRole('button',{name:/CCU-Planer/}).click();const chain=page.getByRole('region',{name:'Kettenbauer',exact:true});
  await check('FAIR_NEWS_SHOWS_ALL_TIED_STARTS_AND_CHAIN_SAVINGS_AND_KEEPS_EXPIRED_UNREAD', async()=>{
    await app.evaluate(()=>{
      const fixture=globalThis.fixture, market=fixture.market;
      const current=market.offers.items.find(offer=>offer.warbond);
      fixture.fairBackup={view:structuredClone(fixture.views[fixture.state.selectedAccountId]),offers:structuredClone(market.offers.items)};
      const view=fixture.views[fixture.state.selectedAccountId];
      view.document.pledges=view.document.pledges.filter(item=>item.pledgeId==='base');
      current.warbondMinor=9000;
      const other=market.offers.items.find(offer=>offer.toShipId===6);
      other.warbond=true;
      other.warbondMinor=11000;
      market.values={schemaVersion:1,source:'rsi-from-ships',currency:'USD',taxBasis:'net',fetchedAt:market.offers.fetchedAt,
        items:[...market.offers.items.map(o=>({id:o.toShipId,name:o.targetName,minor:o.regularMinor})),
          {id:91,name:'Nur in RSI-Ausgangsliste A',minor:8500},{id:92,name:'Nur in RSI-Ausgangsliste B',minor:8500},
          {id:93,name:'Nicht unter Warbond-Wert',minor:9000}]};
      const day=new Date().toISOString().slice(0,10), yesterday=new Date(Date.now()-86400000).toISOString().slice(0,10);
      market.fairNews={exhibition:'Synthetische Messe',sourceAt:market.offers.sourceAt,status:'fresh',unread:[
        {id:day+':openh:5:105',day,targetName:current.targetName,offerKey:current.key,usdMinor:9000,currentUsdMinor:9000},
        {id:day+':openh:6:106',day,targetName:other.targetName,offerKey:other.key,usdMinor:11000,currentUsdMinor:11000},
        {id:yesterday+':openh:4:104',day:yesterday,targetName:'Abgelaufenes Testangebot',offerKey:'test:4',usdMinor:4500,currentUsdMinor:null},
      ]};
    });
    const refresh=page.locator('.connection-actions').getByRole('button',{name:'Daten aktualisieren',exact:true});
    await refresh.click();
    const news=page.getByRole('region',{name:'Messe-Info · Neue Warbond-CCUs'});
    const expired=news.locator('.fair-news-row').filter({hasText:'Abgelaufenes Testangebot'});
    await expired.getByText('Nicht mehr verfügbar',{exact:true}).waitFor();
    assert.equal(await expired.getByRole('button',{name:'Für meine Kette prüfen'}).count(),0);
    assert.equal(await news.locator('.fair-news-day').count(),2);
    assert.equal(await news.evaluate(el=>el.compareDocumentPosition(document.querySelector('.market-targets')) & Node.DOCUMENT_POSITION_FOLLOWING),4);
    const offer=news.getByRole('article',{name:'Liberator'}), starts=offer.locator('tbody tr');
    await starts.first().locator('.fair-fit').waitFor();
    assert.equal(await starts.count(),2);
    assert.deepEqual(await starts.locator('td:first-child strong').allTextContents(),['Nur in RSI-Ausgangsliste A','Nur in RSI-Ausgangsliste B']);
    assert.deepEqual(await starts.locator('.fair-ccu-price').allTextContents(),['≈ 5,41 €','≈ 5,41 €']);
    assert.equal(await offer.locator('.fair-saving').innerText(),'≈ 10,82 € günstiger');
    assert.deepEqual(await starts.locator('.fair-fit').allTextContents(),['Liberator · ≈ 10,82 € weniger Zukauf','Liberator · ≈ 10,82 € weniger Zukauf']);
    assert.match(await starts.first().innerText(),/Nur in RSI-Ausgangsliste A → Liberator/);
    await news.getByRole('article',{name:'Alternatives Testziel'}).getByText('Kein günstigerer Weg für deine Ziele',{exact:true}).waitFor();
    await app.evaluate(()=>{
      const market=globalThis.fixture.market;
      market.offers.items.find(o=>o.key==='test:6').change='missing';
      market.fairNews.unread.find(n=>n.offerKey==='test:6').currentUsdMinor=null;
    });
    const ended=news.locator('.fair-expired').filter({hasText:'Alternatives Testziel'});
    await ended.getByText('Nicht mehr verfügbar',{exact:true}).waitFor();
    assert.equal(await ended.locator('table').count(),0);
    await ended.getByRole('button',{name:'Als gesehen markieren: Alternatives Testziel'}).click();
    await ended.waitFor({state:'hidden'});
    await news.screenshot({path:path.join(folder,'messe-info-testdaten.png')});
    await page.setViewportSize({width:1024,height:900});
    const metrics=await page.context().newCDPSession(page);
    await metrics.send('Emulation.setDeviceMetricsOverride',{width:1024,height:900,mobile:false,deviceScaleFactor:1.25});
    assert.equal(await offer.locator('th, td').evaluateAll(cells=>cells.every(cell=>cell.scrollWidth<=cell.clientWidth+1)),true);
    await metrics.send('Emulation.clearDeviceMetricsOverride');
    await metrics.detach();
    await page.setViewportSize({width:1440,height:1000});
    await news.getByRole('button',{name:'Für meine Kette prüfen'}).click();
    const choice=chain.getByRole('combobox',{name:'Warbond-Ziel für Kaufoptimierer'});
    await choice.waitFor();assert.equal(await choice.inputValue(),'test:5');
    await refresh.click();
    assert.equal(await news.locator('.fair-news-row').count(),2);
    await expired.getByRole('button',{name:'Als gesehen markieren: Abgelaufenes Testangebot'}).click();
    await expired.waitFor({state:'hidden'});
    await page.getByRole('button',{name:/Bestand/}).click();
    await page.getByRole('button',{name:/CCU-Planer/}).click();
    await news.getByRole('article',{name:'Liberator'}).waitFor();
    assert.equal(await expired.count(),0);
    await app.evaluate(()=>{
      const f=globalThis.fixture;
      f.views[f.state.selectedAccountId]=f.fairBackup.view;
      f.market.offers.items=f.fairBackup.offers;
      delete f.market.values;
      delete f.market.fairNews;
    });
    await refresh.click();
    await offer.waitFor({state:'hidden'});
  });
  async function dragAcrossScroll(source,target){await source.scrollIntoViewIfNeeded();const from=await source.boundingBox();assert.ok(from);await page.mouse.move(from.x+25,from.y+25);await page.mouse.down();await page.mouse.move(from.x+35,from.y+35,{steps:5});await target.scrollIntoViewIfNeeded();const to=await target.boundingBox();assert.ok(to);await page.mouse.move(to.x+to.width/2,to.y+to.height/2,{steps:12});await page.mouse.up();}
  await check('CACHED_CURRENT_INVENTORY_DRIVES_REAL_CCUS_AND_STANDARD_GAPS',async()=>{
    assert.equal(await page.locator('.market-update small').innerText(),'beim Start und täglich um 17:05 Uhr (Berlin)');
    await chain.locator('.ccu-step.owned').first().waitFor();assert.equal(await chain.locator('.ccu-step.owned').count(),2);assert.equal(await chain.locator('.ccu-step.purchase').count(),2);
    assert.equal(await chain.getByRole('button',{name:'CCU-Details: LTI Starter → Freelancer DUR',exact:true}).count(),1);assert.equal(await chain.getByRole('button',{name:'CCU-Details: C2 Hercules Starlifter → Liberator',exact:true}).count(),1);assert.doesNotMatch(await chain.locator('.ccu-rail').innerText(),/Original Hornet/);
    assert.match(await chain.locator('button.ccu-total').innerText(),/≈.*21,64/);assert.equal(await chain.locator('.ccu-step').count(),4);
  });
  await check('AUTOMATIC_SHOP_OR_ECB_MATCHES_CHAIN_AND_FLEET_WITHOUT_CREDITS', async()=>{
    const nav=page.getByRole('navigation',{name:'Hauptbereiche'});
    await nav.getByRole('button',{name:/Daten & Einstellungen/}).click();
    await page.getByText('Preisquelle für CCUs · Automatisch · RSI-Shoppreis, sonst EZB',{exact:true}).waitFor();
    assert.equal(await page.getByLabel('Euro-Preisbasis',{exact:true}).count(),0);
    await app.evaluate(()=>{globalThis.fixture.market.shopPrices=[[1,2],[3,4]].map(([fromId,toId])=>({fromId,toId,
      checkedAt:Date.now(),edition:'standard',amount:{minor:1040,currency:'EUR',taxMode:'gross',vatBasisPoints:1900}}));});
    await nav.getByRole('button',{name:/CCU-Planer/}).click();
    const sum=chain.getByRole('button',{name:/Noch zu zahlen.*Summe.*20,80/});
    await sum.waitFor();
    assert.ok(await sum.locator('strong').evaluate(el=>parseFloat(getComputedStyle(el).fontSize)>=20));
    await sum.press('Enter');
    assert.equal(await sum.getAttribute('aria-expanded'),'true');
    assert.match(await chain.locator('.ccu-total-detail').innerText(),/RSI-Shoppreis/);
    await chain.getByRole('button',{name:'CCU-Details schließen'}).click();
    assert.equal(await sum.evaluate(el=>el===document.activeElement),true);
    await nav.getByRole('button',{name:/Flottenplan/}).click();
    await page.locator('.fleet-cash').first().filter({hasText:/20,80/}).waitFor();
    assert.doesNotMatch(await page.locator('.fleet-cash').first().innerText(),/≈/);
    await app.evaluate(()=>{globalThis.fixture.market.shopPrices=[];});
    await nav.getByRole('button',{name:/CCU-Planer/}).click();
    await chain.getByRole('button',{name:/Noch zu zahlen.*Summe.*21,64/}).waitFor();
  });
  await check('ONE_PLANNER_NAVIGATION_AND_REFRESH_READS_HANGAR_WITHOUT_STARTING_LOGIN',async()=>{
    const nav=page.getByRole('navigation',{name:'Hauptbereiche'});
    assert.equal(await nav.getByRole('button',{name:/CCU-Planer/}).count(),1);
    assert.equal(await nav.getByRole('button',{name:/Zielschiffe & Ketten|Kettenbauer|Angebote & Aktionen/}).count(),0);
    assert.equal(await nav.locator('button.active').count(),1);
    const before=await app.evaluate(()=>globalThis.fixture.commands.length);
    await page.locator('.connection-actions').getByRole('button',{name:'Daten aktualisieren',exact:true}).click();
    const commands=await app.evaluate(({},before)=>globalThis.fixture.commands.slice(before),before);
    assert.equal(commands.filter(c=>c.action==='rsi.refresh').length,1);assert.equal(commands.filter(c=>c.action==='market.refresh').length,1);
    assert.equal(commands.some(c=>/^rsi\.(authorize|connect|open)$/.test(c.action)),false);
    await nav.getByRole('button',{name:/Bestand/}).click();await page.getByRole('heading',{name:'Bestand',exact:true}).waitFor();
    await nav.getByRole('button',{name:/CCU-Planer/}).click();await page.getByRole('heading',{name:'CCU-Planer',exact:true}).waitFor();
    assert.equal(await nav.getByRole('button',{name:/CCU-Planer/}).getAttribute('aria-current'),'page');
  });
  await check('BRIGHT_TURQUOISE_OWNED_AND_ORANGE_PURCHASE_ARE_DISTINCT',async()=>{
    const values=await chain.locator('.ccu-step').evaluateAll(cards=>cards.map(e=>{const s=getComputedStyle(e),b=getComputedStyle(e.querySelector('.ccu-ownership'));return {kind:e.classList.contains('owned')?'owned':'purchase',background:s.backgroundColor,border:s.borderTopStyle,badge:b.backgroundColor}}));
    assert.ok(values.filter(v=>v.kind==='owned').every(v=>v.badge==='rgb(0, 240, 219)'&&v.border==='solid'));
    assert.ok(values.filter(v=>v.kind==='purchase').every(v=>v.badge==='rgb(255, 189, 105)'&&v.border==='dashed'));
  });
  await check('OWNED_DETAILS_AND_OPEN_COSTS_DO_NOT_RECHARGE_PAID_CCUS',async()=>{
    await chain.locator('.ccu-step.owned').last().click();assert.match(await chain.locator('.ccu-detail').innerText(),/owned-b/);assert.match(await chain.locator('.ccu-detail').innerText(),/Anwendbarkeit/);
    await chain.getByRole('button',{name:'CCU-Details schließen'}).click();await chain.locator('button.ccu-total').click();assert.match(await chain.locator('.ccu-detail').innerText(),/Zielschiffpreise sind keine CCU-Preise/);assert.match(await chain.locator('.ccu-detail').innerText(),/inkl\. 19 % MwSt\./);await chain.getByRole('button',{name:'CCU-Details schließen'}).click();
  });
  await check('ORANGE_BUTTON_OPENS_ONLY_UPGRADE_ACTION_WHILE_DETAILS_AND_BROWSER_FAILURE_REMAIN_SEPARATE',async()=>{
    const before=await app.evaluate(()=>globalThis.fixture.commands.filter(c=>c.action==='market.openUpgrades').length);
    const gap=chain.locator('.ccu-step.purchase').first();
    await gap.getByRole('button',{name:/CCU-Details/}).click();assert.equal(await app.evaluate(()=>globalThis.fixture.commands.filter(c=>c.action==='market.openUpgrades').length),before);
    await chain.getByRole('button',{name:'CCU-Details schließen'}).click();
    await gap.getByRole('button',{name:/RSI-Upgrades öffnen/}).click();
    const calls=await app.evaluate(()=>globalThis.fixture.commands.filter(c=>c.action==='market.openUpgrades'));assert.equal(calls.length,before+1);assert.deepEqual(calls.at(-1),{action:'market.openUpgrades'});
    assert.equal(await chain.locator('.ccu-detail').isVisible(),false);
    assert.equal(await page.locator('button button, button a, a button').count(),0);
    await app.evaluate(()=>{globalThis.fixture.shopFailure=true});await gap.getByRole('button',{name:/RSI-Upgrades öffnen/}).click();
    await page.getByRole('alert').filter({hasText:'RSI-Upgrade-Seite konnte nicht geöffnet werden.'}).waitFor();await app.evaluate(()=>{globalThis.fixture.shopFailure=false});
  });
  await check('APPROVED_CHAIN_ABOVE_STOCK_GRID_COLUMNS_AND_PRICE_POSITIONS',async()=>{
    assert.equal(await chain.getByLabel('Spalten im Vorratsraster',{exact:true}).inputValue(),'5');assert.equal(await chain.getByRole('button',{name:'Raster',exact:true}).getAttribute('aria-pressed'),'true');
    const rail=await chain.locator('.ccu-rail').boundingBox(),stock=await chain.locator('.ccu-stock').boundingBox();assert.ok(stock.y>rail.y+rail.height);
    assert.ok(await chain.locator('.ccu-drop-slot svg').count()>=3);assert.match(await chain.locator('.ccu-cost-summary').innerText(),/Gesamte Investition.*Preis offen/);
    for(const columns of [3,4,5]){await chain.getByLabel('Spalten im Vorratsraster',{exact:true}).selectOption(String(columns));assert.equal(await chain.locator('.ccu-stock-row').evaluate(e=>getComputedStyle(e).gridTemplateColumns.split(' ').length),columns);}
    await chain.getByRole('button',{name:'Kartenband',exact:true}).click();assert.equal(await chain.locator('.ccu-stock-row').evaluate(e=>getComputedStyle(e).display),'flex');
    await chain.getByRole('button',{name:'Raster',exact:true}).click();await chain.getByLabel('Spalten im Vorratsraster',{exact:true}).selectOption('5');
    assert.ok((await chain.locator('.ccu-step.owned .ccu-step-price strong').allTextContents()).every(v=>v==='0,00 €'));
    assert.match(await chain.locator('.ccu-step.purchase .ccu-step-price').first().getAttribute('title'),/Richtwert aus Schiffswertdifferenz/);
    const geometry=await chain.locator('.ccu-step').evaluateAll(cards=>cards.map(e=>({width:e.getBoundingClientRect().width,price:e.querySelector('.ccu-step-price').getBoundingClientRect().top,labels:[...e.querySelectorAll('.ccu-model>small')].map(x=>x.textContent)})));assert.ok(geometry.every(g=>g.width===185&&Math.abs(g.price-geometry[0].price)<1),JSON.stringify(geometry));assert.ok(geometry.every(g=>JSON.stringify(g.labels)==='["Von","Nach"]'));
  });
  await check('COLLECTED_VIEW_EXCLUDES_APPLIED_AND_REMOVED_INSTANCES',async()=>{
    assert.equal(await chain.locator('.ccu-stock-tile.owned').count(),3);assert.equal(await chain.locator('.ccu-stock-tile.purchase').count(),2);
    await chain.getByRole('button',{name:'Vorschlag',exact:true}).click();
    await chain.getByLabel('Startbasis für die Kette',{exact:true}).selectOption(JSON.stringify(['base','current']));assert.match(await chain.locator('.ccu-step').first().innerText(),/LTI Starter/);
  });
  await check('PROFILE_SWITCH_NEVER_REUSES_ANOTHER_PROFILE_RESOURCES',async()=>{
    await page.getByLabel('Lokales Kontoprofil',{exact:true}).first().selectOption(b);await page.waitForFunction(()=>document.querySelector('[aria-label="Zielschiff 1"]').value==='');assert.equal(await chain.locator('.ccu-step.owned').count(),0);
    await page.getByLabel('Lokales Kontoprofil',{exact:true}).first().selectOption(a);await chain.locator('.ccu-step.owned').first().waitFor();assert.equal(await chain.locator('.ccu-step.owned').count(),2);
  });
  await check('AUTO_TARGETS_RETAIN_INDEPENDENT_BASE_CHOICES_AND_BLOCK_REUSED_BASES',async()=>{
    await page.getByLabel('Zielschiff 2',{exact:true}).selectOption('6');
    await chain.getByText('Ressourcenkonflikt',{exact:true}).first().waitFor();
    const badges=await page.locator('.market-target-body>.badge').allTextContents();
    assert.match(badges[0],/2 Bestand · 2 Lücken/);assert.match(badges[1],/Kettenvorschau unten/);
    assert.equal(await chain.locator('.ccu-step').count(),0);
    await chain.getByLabel('Startbasis für die Kette',{exact:true}).selectOption(JSON.stringify(['base','current']));
    await page.locator('.market-target').first().getByRole('heading',{name:'Liberator',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.ccu-builder h2').textContent.includes('Liberator'));
    await chain.getByLabel('Startbasis für die Kette',{exact:true}).selectOption(JSON.stringify(['base','current']));
    await page.getByLabel('Zielschiff 2',{exact:true}).focus();
    assert.equal(await chain.getByLabel('Startbasis für die Kette',{exact:true}).inputValue(),JSON.stringify(['base','current']));
    await page.getByLabel('Zielschiff 1',{exact:true}).focus();
    await page.locator('.market-targets > p').evaluate(e=>{e.textContent='SYNTHETISCHE TESTDATEN · Beispielvergleich, keine echten Angebote oder Kontodaten.'});
    await page.locator('.market-targets').screenshot({path:path.join(folder,'zielvergleich-testdaten.png')});
    await page.locator('.market-update').getByText('beim Start und täglich um 17:05 Uhr (Berlin)',{exact:true}).waitFor();
  });
  await check('LAYOUT_1440_1024_AND_125_PERCENT_WITH_HORIZONTAL_PAGING',async()=>{
    for(const [width,scale] of [[1440,1],[1024,1],[1024,1.25]]){
      await page.setViewportSize({width,height:1200});const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setDeviceMetricsOverride',{width,height:1200,mobile:false,deviceScaleFactor:scale});
      await page.waitForFunction(()=>document.querySelectorAll('.ccu-step').length===4);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      const geometry=await chain.locator('.ccu-step').evaluateAll(cards=>cards.map(e=>({top:e.getBoundingClientRect().top,scroll:e.scrollWidth,client:e.clientWidth})));
      assert.ok(geometry.every(e=>e.top===geometry[0].top&&e.scroll<=e.client));
      const gaps=await chain.locator('.ccu-step').evaluateAll(cards=>cards.slice(1).map((e,i)=>e.getBoundingClientRect().left-cards[i].getBoundingClientRect().right));assert.ok(gaps.every(g=>g>=12));
      await chain.screenshot({path:path.join(folder,`chain-${width}-${scale}.png`)});await cdp.detach();
    }
    await chain.getByRole('button',{name:'Kartenband',exact:true}).click();
    await chain.locator('.ccu-stock-row').evaluate(e=>{e.scrollLeft=e.scrollWidth;});assert.ok(await chain.locator('.ccu-stock-row').evaluate(e=>e.scrollLeft>0));
    await chain.getByRole('button',{name:'Raster',exact:true}).click();
  });
  await check('VARIANTS_DRAG_REPLACE_REORDER_UNDO_REMOVE_AND_PERSIST_PER_PROFILE',async()=>{
    await page.setViewportSize({width:1440,height:1300});
    await chain.getByLabel('Kettenvariante',{exact:true}).selectOption('1');await chain.locator('.ccu-step.owned').filter({hasText:'Alternatives Zwischenmodell'}).waitFor();
    const original=chain.locator('.ccu-stock-tile.owned').filter({hasText:'Constellation Mk V Test'});
    await original.scrollIntoViewIfNeeded();const alternate=chain.locator('.ccu-step.owned').filter({hasText:'Alternatives Zwischenmodell'});
    await original.dragTo(alternate);await chain.locator('.ccu-step.owned').filter({hasText:'Constellation Mk V Test'}).waitFor();
    assert.equal(await chain.locator('.ccu-step.owned').filter({hasText:'Alternatives Zwischenmodell'}).count(),0);
    const beforeRejected=await app.evaluate(()=>JSON.stringify(globalThis.fixture.drafts));
    const last=chain.locator('.ccu-step.owned').filter({hasText:'Liberator'});await last.dragTo(chain.locator('.ccu-drop-slot').first());
    assert.equal(await chain.locator('.ccu-connection-conflict').count(),0);assert.equal(await app.evaluate(()=>JSON.stringify(globalThis.fixture.drafts)),beforeRejected);
    await chain.locator('.ccu-step.owned').first().getByRole('button',{name:'Schritt entfernen',exact:true}).click();assert.equal(await chain.locator('.ccu-step.owned').count(),1);
    await chain.getByRole('button',{name:'↶ Rückgängig',exact:true}).click();assert.equal(await chain.locator('.ccu-step.owned').count(),2);
    await page.getByRole('navigation',{name:'Hauptbereiche'}).getByRole('button',{name:/Bestand/}).click();await page.getByRole('navigation',{name:'Hauptbereiche'}).getByRole('button',{name:/CCU-Planer/}).click();
    await chain.getByRole('button',{name:'Selbst bauen',exact:true}).waitFor();await page.waitForFunction(()=>document.querySelector('.ccu-views button[aria-pressed="true"]').textContent==='Selbst bauen');
    assert.equal(await chain.locator('.ccu-step.owned').count(),2);assert.equal(await chain.locator('.ccu-connection-conflict').count(),0);
    const snapshot=await app.evaluate(()=>JSON.stringify(globalThis.fixture.drafts));await app.evaluate(()=>{globalThis.fixture.draftFailure=true;});
    await chain.locator('.ccu-step.owned').first().getByRole('button',{name:'Schritt entfernen',exact:true}).click();await chain.getByText('Entwurf konnte nicht gespeichert werden.',{exact:true}).waitFor();assert.equal(await app.evaluate(()=>JSON.stringify(globalThis.fixture.drafts)),snapshot);
    await app.evaluate(()=>{globalThis.fixture.draftFailure=false;});await chain.getByRole('button',{name:'↶ Rückgängig',exact:true}).click();
    await chain.getByRole('button',{name:'Vorschlag',exact:true}).click();
    await chain.evaluate(e=>{const label=document.createElement('div');label.textContent='SYNTHETISCHE TESTDATEN · keine echten Angebote oder Kontodaten';label.style.cssText='color:#83e4d5;font-size:11px;letter-spacing:1px;margin-bottom:10px';e.prepend(label);});
    await chain.screenshot({path:path.join(folder,'freier-kettenbauer-testdaten.png')});
  });
  await check('LATE_SAVE_RESPONSE_CANNOT_COPY_ANOTHER_PROFILE_DRAFT_ON_RETURN',async()=>{
    await app.evaluate(({},{a,b})=>{const f=globalThis.fixture;f.targets[b]=[5,null,null];f.drafts[b+':5']={mode:'manual',initialized:true,baseKey:JSON.stringify(['foreign-base','foreign-ship']),anchors:[{kind:'owned',key:JSON.stringify(['foreign-pledge','foreign-ccu']),fromName:'FOREIGN_PROFILE_FROM',toName:'FOREIGN_PROFILE_TO'}]};f.holdSave=a;},{a,b});
    await chain.getByRole('button',{name:'Selbst bauen',exact:true}).click();
    await page.getByLabel('Lokales Kontoprofil',{exact:true}).first().selectOption(b);await chain.getByText('Wähle zuerst deine Startbasis',{exact:true}).waitFor();assert.equal(await chain.locator('.ccu-rail .ccu-step').count(),0);
    await app.evaluate(({},a)=>{globalThis.fixture.holdLoad=a;},a);
    await page.getByLabel('Lokales Kontoprofil',{exact:true}).first().selectOption(a);
    await app.evaluate(()=>{const f=globalThis.fixture;f.holdSave=null;for(const done of f.pendingSaves??[])done();f.pendingSaves=[];});
    await page.waitForFunction(()=>document.querySelector('.ccu-empty')?.textContent==='Entwurf wird geladen …');
    assert.equal(await chain.getByRole('button',{name:'CCU-Details: FOREIGN_PROFILE_FROM → FOREIGN_PROFILE_TO',exact:true}).count(),0);
    await app.evaluate(()=>{const f=globalThis.fixture;f.holdLoad=null;for(const done of f.pendingLoads??[])done();f.pendingLoads=[];});
    await chain.locator('.ccu-step.owned').first().waitFor();assert.equal(await chain.getByRole('button',{name:'CCU-Details: FOREIGN_PROFILE_FROM → FOREIGN_PROFILE_TO',exact:true}).count(),0);
    await chain.getByRole('button',{name:'Vorschlag',exact:true}).click();
  });
  await check('MISSING_CONNECTION_TILE_CAN_BE_DRAGGED_AND_CLICK_ADDITION_REMAINS_LOCAL',async()=>{
    const before=await app.evaluate(()=>globalThis.fixture.commands.filter(c=>c.action==='market.openUpgrades').length);
    const missing=chain.locator('.ccu-stock-tile.purchase').filter({hasText:'LTI Starter'}).first();await missing.scrollIntoViewIfNeeded();await missing.dragTo(chain.locator('.ccu-drop-slot').first());
    const anchors=await app.evaluate(()=>globalThis.fixture.drafts[globalThis.fixture.state.selectedAccountId+':5'].anchors);
    assert.equal(anchors[0].kind,'purchase');assert.equal(await chain.locator('.ccu-step.owned').count(),2);
    assert.equal(await app.evaluate(()=>globalThis.fixture.commands.filter(c=>c.action==='market.openUpgrades').length),before);
    await chain.getByRole('button',{name:'↶ Rückgängig',exact:true}).click();
    const alternative=chain.locator('.ccu-stock-tile.owned').filter({hasText:'Alternatives Zwischenmodell'});await alternative.getByRole('button',{name:/CCU einfügen/}).click();
    await chain.locator('.ccu-connection-conflict').first().waitFor();await chain.getByRole('button',{name:'↶ Rückgängig',exact:true}).click();
    assert.equal(await chain.locator('.ccu-connection-conflict').count(),0);await chain.getByRole('button',{name:'Vorschlag',exact:true}).click();
  });
  await check('ZERO_ADDITIONAL_FOR_ALL_OWNED_AND_NO_REAL_SESSION_OR_PROTECTION_MUTATION',async()=>{
    const before=await app.evaluate(()=>JSON.stringify(globalThis.fixture.views));
    const extra=ccu('all-owned-start',ships[0].name,ships[1].name),middle=ccu('all-owned-middle',ships[2].name,ships[3].name);
    await app.evaluate(({},{extra,middle})=>{const f=globalThis.fixture,v=f.views[f.state.selectedAccountId];v.document.pledges.push(extra,middle);v.revision='44444444-4444-4444-8444-444444444444';v.observedAt=new Date().toISOString();},{extra,middle});
    await page.waitForFunction(()=>/0,00/.test(document.querySelector('button.ccu-total').textContent));assert.equal(await chain.locator('.ccu-step.purchase').count(),0);
    assert.match(await page.locator('.market-target-body>.badge').first().innerText(),/4 Bestand · 0 Lücken/);
    assert.ok(before.includes('"protected":true'));const held=await app.evaluate(()=>globalThis.fixture.views[globalThis.fixture.state.selectedAccountId].document.pledges);assert.ok(held.every(p=>p.protected&&!p.baseReleased));
    const commands=await app.evaluate(()=>globalThis.fixture.commands);assert.equal(commands.some(c=>/^rsi\.(connect|open|authorize)$|^import\.commit$/.test(c.action)),false);assert.equal(await app.evaluate(()=>globalThis.blockedRequests),0);
  });
  await check('SILVER_LINKS_AND_OPENING_PREVIEW_MOVE_NEIGHBORS_ONLY_DURING_DRAG',async()=>{
    await app.evaluate(({},a)=>{globalThis.fixture.drafts[a+':5']={mode:'manual',initialized:true,baseKey:JSON.stringify(['base','current']),baseApprovedKey:JSON.stringify(['base','current']),anchors:[{kind:'owned',key:JSON.stringify(['owned-b','owned-b:ccu']),fromName:'C2 Hercules Starlifter',toName:'Liberator'}]};},a);
    await page.getByRole('navigation',{name:'Hauptbereiche'}).getByRole('button',{name:/Bestand/}).click();await page.getByRole('navigation',{name:'Hauptbereiche'}).getByRole('button',{name:/CCU-Planer/}).click();
    await page.waitForFunction(()=>document.querySelectorAll('.ccu-step').length===2);
    const slot=chain.getByLabel('Hier einfügen 2',{exact:true}),stock=chain.locator('.ccu-stock-tile.owned').filter({hasText:'Alternatives Zwischenmodell'});
    await slot.hover();assert.equal(await chain.locator('.ccu-drop-slot.open').count(),0);
    assert.ok(await chain.locator('.ccu-metal-ring').count()>0);assert.ok(await chain.locator('.ccu-silver-chain stop').count()>0);
    const before=await chain.locator('.ccu-step').evaluateAll(cards=>cards.map(c=>c.getBoundingClientRect().x));
    const transfer=await page.evaluateHandle(()=>new DataTransfer());await stock.dispatchEvent('dragstart',{dataTransfer:transfer});await slot.dispatchEvent('dragenter',{dataTransfer:transfer});await slot.dispatchEvent('dragover',{dataTransfer:transfer});await page.waitForTimeout(260);
    assert.equal(await slot.getAttribute('data-fit'),'gap');assert.ok((await slot.boundingBox()).width>270);assert.match(await chain.locator('.ccu-snap-ghost').innerText(),/Passt mit Restlücke/);
    const after=await chain.locator('.ccu-step').evaluateAll(cards=>cards.map(c=>c.getBoundingClientRect().x));assert.ok(after[0]<before[0]-60&&after[1]>before[1]+60);
    await chain.screenshot({path:path.join(folder,'silver-drag-open.png')});
    const saved=await app.evaluate(()=>JSON.stringify(globalThis.fixture.drafts));await stock.dispatchEvent('dragend',{dataTransfer:transfer});await page.waitForTimeout(260);await transfer.dispose();
    assert.equal(await chain.locator('.ccu-drop-slot.open').count(),0);assert.equal(await app.evaluate(()=>JSON.stringify(globalThis.fixture.drafts)),saved);
  });
  await check('NATIVE_STOCK_DROP_SNAPS_WITH_REMAINING_GAPS_AND_UNDO',async()=>{
    const stock=chain.locator('.ccu-stock-tile.owned').filter({hasText:'Alternatives Zwischenmodell'});await stock.dragTo(chain.getByLabel('Hier einfügen 2',{exact:true}));
    await chain.locator('.ccu-step.owned').filter({hasText:'Alternatives Zwischenmodell'}).waitFor();assert.equal(await chain.locator('.ccu-connection-conflict').count(),0);
    assert.match(await chain.locator('.ccu-workbench-message').innerText(),/Restlücken bleiben sichtbar/);assert.equal(await chain.locator('.ccu-drop-slot.open').count(),0);assert.equal(await chain.locator('.ccu-step.snapped').count(),1);
    const persisted=await app.evaluate(()=>globalThis.fixture.drafts[globalThis.fixture.state.selectedAccountId+':5']);assert.equal(persisted.anchors.length,2);
    await chain.screenshot({path:path.join(folder,'silver-snapped.png')});await chain.getByRole('button',{name:'↶ Rückgängig',exact:true}).click();assert.equal(await chain.locator('.ccu-step.owned').filter({hasText:'Alternatives Zwischenmodell'}).count(),0);
  });
  await check('REAL_WORKER_CHECKS_VARIANTS_AND_BEST_WITHOUT_OVERWRITING_OWN_DRAFT',async()=>{
    const before=await app.evaluate(()=>JSON.stringify(globalThis.fixture.drafts));await chain.getByRole('button',{name:'Varianten prüfen',exact:true}).click();
    const comparison=chain.locator('.ccu-price-details');await comparison.waitFor();assert.equal(await comparison.getAttribute('open'),null);await comparison.locator('summary').click();await chain.locator('.ccu-price-comparison').waitFor();assert.match(await chain.locator('.ccu-comparison-head').innerText(),/5 Wege angezeigt.*1 Basen geprüft.*5 CCUs geprüft/);
    assert.equal(await app.evaluate(()=>JSON.stringify(globalThis.fixture.drafts)),before);assert.equal(await chain.locator('.ccu-step').count(),2);
    await chain.getByRole('button',{name:'Bester bekannter Weg',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.ccu-step.owned').length===4);
    assert.equal(await chain.locator('.ccu-step.purchase').count(),0);assert.equal(await chain.locator('.ccu-step[draggable=true]').count(),4);assert.equal(await app.evaluate(()=>JSON.stringify(globalThis.fixture.drafts)),before);
    assert.match(await chain.locator('.ccu-price-comparison tr.selected').innerText(),/noch nicht erfasst.*Preis offen/);
    await chain.getByLabel('Kettenvariante',{exact:true}).selectOption('own');assert.equal(await chain.locator('.ccu-step').count(),2);assert.equal(await app.evaluate(()=>JSON.stringify(globalThis.fixture.drafts)),before);
  });
  await check('BEST_ROUTE_ACCEPTS_NATIVE_DRAG_AS_UNSAVED_WORKING_DRAFT_AND_UNDO',async()=>{
    const before=await app.evaluate(()=>JSON.stringify(globalThis.fixture.drafts));await chain.getByRole('button',{name:'Bester bekannter Weg',exact:true}).click();
    await page.waitForFunction(()=>document.querySelectorAll('.ccu-step.owned').length===4);
    await page.evaluate(()=>{window.__dragEvents=[];for(const name of ['dragstart','dragover','drop','dragend'])document.addEventListener(name,e=>{const card=e.target.closest?.('.ccu-step,.ccu-stock-tile,.ccu-drop-slot');if(card)window.__dragEvents.push([name,card.className,card.dataset.dropFit??card.dataset.fit]);},{capture:true});});
    const old=chain.locator('.ccu-step.owned').filter({hasText:'Constellation Mk V Test'}).first(),alternative=chain.locator('.ccu-stock-tile.owned').filter({hasText:'Alternatives Zwischenmodell'});
    await dragAcrossScroll(alternative,old);await chain.screenshot({path:path.join(folder,'working-drop.png')});const events=await page.evaluate(()=>({events:window.__dragEvents,notice:document.querySelector('.ccu-workbench-message')?.textContent}));fs.writeFileSync(path.join(folder,'drag-events.json'),JSON.stringify(events,null,2));assert.ok(events.events.some(e=>e[0]==='dragstart'&&e[1]==='ccu-stock-tile owned'));assert.match(await chain.locator('.ccu-comparison-head [role=status]').innerText(),/Freier Testentwurf · eigener Entwurf bleibt erhalten/);
    assert.equal(await chain.locator('.ccu-step.owned').filter({hasText:'Alternatives Zwischenmodell'}).count(),1);assert.equal(await app.evaluate(()=>JSON.stringify(globalThis.fixture.drafts)),before);assert.equal(await chain.getByRole('button',{name:'Bester bekannter Weg',exact:true}).getAttribute('aria-pressed'),'false');
    await chain.getByRole('button',{name:'↶ Rückgängig',exact:true}).click();assert.equal(await chain.locator('.ccu-step.owned').filter({hasText:'Alternatives Zwischenmodell'}).count(),0);assert.equal(await app.evaluate(()=>JSON.stringify(globalThis.fixture.drafts)),before);
    await dragAcrossScroll(alternative,old);await chain.getByRole('button',{name:'Übernehmen',exact:true}).click();const applied=await app.evaluate(()=>globalThis.fixture.drafts[globalThis.fixture.state.selectedAccountId+':5']);assert.ok(applied.anchors.some(a=>a.kind==='owned'&&a.key.includes('owned-alt')));await chain.getByRole('button',{name:'↶ Rückgängig',exact:true}).click();assert.equal(await app.evaluate(()=>JSON.stringify(globalThis.fixture.drafts)),before);
  });
  await check('EXPLICIT_APPLY_AND_UNDO_PRESERVE_PREVIOUS_DRAFT',async()=>{
    const before=await app.evaluate(()=>structuredClone(globalThis.fixture.drafts[globalThis.fixture.state.selectedAccountId+':5']));
    await chain.getByRole('button',{name:'Bester bekannter Weg',exact:true}).click();await chain.getByRole('button',{name:'Übernehmen',exact:true}).click();
    const after=await app.evaluate(()=>globalThis.fixture.drafts[globalThis.fixture.state.selectedAccountId+':5']);assert.equal(after.anchors.length,4);assert.ok(after.anchors.every(a=>a.kind==='owned'));assert.equal(after.mode,'manual');
    await chain.getByRole('button',{name:'↶ Rückgängig',exact:true}).click();assert.deepEqual(await app.evaluate(()=>globalThis.fixture.drafts[globalThis.fixture.state.selectedAccountId+':5']),before);
  });
  await check('PRICE_TABLE_SUMS_RECORDED_COSTS_AND_NEVER_FABRICATES_MISSING_TOTALS',async()=>{
    await app.evaluate(()=>{const v=globalThis.fixture.views[globalThis.fixture.state.selectedAccountId];for(const p of v.document.pledges){p.acquisitionCost={minor:1000,currency:'EUR',taxBasis:'gross',evidence:'SYNTHETIC invoice'};p.unknownCostReason=null;}v.revision='55555555-5555-4555-8555-555555555555';v.observedAt=new Date().toISOString();});
    await page.waitForFunction(()=>document.querySelector('.ccu-stock-tile>small')?.textContent.includes('10,00'));
    await chain.getByRole('button',{name:'Bester bekannter Weg',exact:true}).click();await chain.locator('.ccu-price-details').waitFor();await chain.locator('.ccu-price-details summary').click();await chain.locator('.ccu-price-comparison tr.selected').waitFor();
    const cells=await chain.locator('.ccu-price-comparison tr.selected td').allTextContents();assert.deepEqual(cells.slice(0,3),['50,00 €','0,00 €','50,00 €']);assert.equal(cells[3],'Kaufpreise belegt');
    const draft=await app.evaluate(()=>JSON.stringify(globalThis.fixture.drafts));await app.evaluate(()=>{const v=globalThis.fixture.views[globalThis.fixture.state.selectedAccountId];v.document.pledges.find(p=>p.pledgeId==='base').acquisitionCost=null;v.revision='66666666-6666-4666-8666-666666666666';v.observedAt=new Date().toISOString();});
    await chain.locator('.ccu-price-comparison').waitFor({state:'hidden'});await chain.getByRole('button',{name:'Bester bekannter Weg',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.ccu-price-comparison tr.selected')?.textContent.includes('40,00'));
    assert.match((await chain.locator('.ccu-price-comparison tr.selected td').allTextContents())[2],/Preis offen/);assert.equal(await app.evaluate(()=>JSON.stringify(globalThis.fixture.drafts)),draft);
    for(const width of [1440,1024]){await page.setViewportSize({width,height:1300});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
    await chain.screenshot({path:path.join(folder,'variant-price-comparison.png')});
    await chain.getByLabel('Kettenvariante',{exact:true}).selectOption('own');
  });
  await check('STALE_WORKER_RESULT_AND_WORKER_FAILURE_CANNOT_REPLACE_ANOTHER_PROFILE',async()=>{
    await page.evaluate(()=>{const Original=window.Worker;window.__OriginalWorker=Original;window.Worker=class extends Original{set onmessage(fn){super.onmessage=e=>setTimeout(()=>fn(e),250);}};});
    await chain.getByRole('button',{name:'Varianten prüfen',exact:true}).click();await page.getByLabel('Lokales Kontoprofil',{exact:true}).first().selectOption(b);await page.waitForTimeout(350);
    assert.equal(await chain.locator('.ccu-comparison').count(),0);await page.evaluate(()=>{window.Worker=window.__OriginalWorker;});await page.getByLabel('Lokales Kontoprofil',{exact:true}).first().selectOption(a);await chain.locator('.ccu-step.owned').first().waitFor();
    const before=await app.evaluate(()=>JSON.stringify(globalThis.fixture.drafts));await page.evaluate(()=>{window.Worker=class{constructor(){throw new Error('SYNTHETIC_WORKER_FAILURE')}};});await chain.getByRole('button',{name:'Varianten prüfen',exact:true}).click();
    await chain.getByText('Variantenprüfung fehlgeschlagen. Eigener Entwurf bleibt erhalten.',{exact:true}).waitFor();assert.equal(await app.evaluate(()=>JSON.stringify(globalThis.fixture.drafts)),before);await page.evaluate(()=>{window.Worker=window.__OriginalWorker;});
    const commands=await app.evaluate(()=>globalThis.fixture.commands);assert.equal(commands.some(c=>/^rsi\.(connect|open|authorize)$|^import\.commit$/.test(c.action)),false);assert.equal(await app.evaluate(()=>globalThis.blockedRequests),0);
  });
  await check('PURCHASE_ANCHOR_NOW_COVERED_BY_STOCK_REMAINS_DRAGGABLE',async()=>{
    await app.evaluate(({},a)=>{globalThis.fixture.drafts[a+':5']={mode:'manual',initialized:true,baseKey:JSON.stringify(['base','current']),baseApprovedKey:JSON.stringify(['base','current']),anchors:[{kind:'purchase',fromKey:'matrix:1',toKey:'matrix:2',fromName:'LTI Starter',toName:'Freelancer DUR'},{kind:'owned',key:JSON.stringify(['owned-a','owned-a:ccu']),fromName:'Freelancer DUR',toName:'Constellation Mk V Test'}]};},a);
    await page.getByRole('navigation',{name:'Hauptbereiche'}).getByRole('button',{name:/Bestand/}).click();await page.getByRole('navigation',{name:'Hauptbereiche'}).getByRole('button',{name:/CCU-Planer/}).click();
    const converted=chain.locator('.ccu-step.owned').filter({hasText:'LTI Starter'});await converted.waitFor();await converted.dragTo(chain.getByLabel('Hier einfügen 2',{exact:true}));assert.match(await chain.locator('.ccu-workbench-message').innerText(),/eingerastet/);assert.equal(await chain.locator('.ccu-step.owned').filter({hasText:'LTI Starter'}).count(),1);assert.equal(await chain.locator('.ccu-connection-conflict').count(),0);
  });
  await check('AUTO_PURCHASE_REFRESH_RESPECTS_PRIORITY_IN_CHAIN_AND_SHOPPING_LIST',async()=>{
    const names=['UTV','MDC','Guardian','Hull B','Apollo Medivac','MOLE','Galaxy','Liberator'];
    const prices=[5000,6000,10000,14000,15000,19000,22000,30000];
    const shipsForCase=names.map((name,i)=>({...ships[0],id:91+i,name}));
    const currentOffers=shipsForCase.map((ship,i)=>({...offers[0],key:'test:'+ship.id,toShipId:ship.id,toSkuId:ship.id+100,
      name:'Upgrade to '+ship.name,targetName:ship.name,regularMinor:prices[i],warbond:ship.name==='Guardian',warbondMinor:ship.name==='Guardian'?9500:null}));
    const basis=(id,name)=>({...pledge(id),ships:[{...base.ships[0],modelName:name}]});
    const stock=[basis('basis-galaxy','UTV'),basis('basis-liberator','MDC'),ccu('hull-a','Guardian','Hull B'),ccu('hull-to-galaxy','Hull B','Galaxy')];
    const acquired=[ccu('hull-b','Guardian','Hull B'),ccu('apollo-to-mole','Apollo Medivac','MOLE')];
    const navigation=page.getByRole('navigation',{name:'Hauptbereiche'});
    await navigation.getByRole('button',{name:/Bestand/}).click();
    await app.evaluate(({},args)=>{
      const f=globalThis.fixture;
      f.market.catalogue={fetchedAt:args.at,ships:args.shipsForCase};
      f.market.offers={fetchedAt:args.at,sourceAt:args.at,checkedAt:args.at,items:args.currentOffers};
      f.market.values={schemaVersion:1,source:'rsi-from-ships',currency:'USD',taxBasis:'net',fetchedAt:args.at,
        items:args.shipsForCase.map((ship,i)=>({id:ship.id,name:ship.name,minor:args.prices[i]}))};
      f.views[args.account].document.pledges=args.stock;
      f.views[args.account].document.storeCredit={minor:6000,currency:'USD',observedAt:args.at,source:'rsi-credit-ledger'};
      f.views[args.account].revision='77777777-7777-4777-8777-777777777777';
      f.targets[args.account]=[97,98,null];
      for(const [id,pledge] of [[97,'basis-galaxy'],[98,'basis-liberator']]){
        const baseKey=JSON.stringify([pledge,'current']);
        f.drafts[args.account+':'+id]={mode:'auto',initialized:false,baseKey,baseApprovedKey:baseKey,anchors:[]};
      }
    },{account:a,at:new Date().toISOString(),shipsForCase,prices,currentOffers,stock});
    await navigation.getByRole('button',{name:/CCU-Planer/}).click();
    const refresh=page.locator('.connection-actions').getByRole('button',{name:'Daten aktualisieren',exact:true});
    await refresh.click();
    const hullCard=chain.getByRole('button',{name:'CCU-Details: Guardian → Hull B',exact:true});
    await hullCard.click();
    await chain.locator('.ccu-detail').getByText(/Pledge: hull-a ·/).waitFor();
    await chain.getByRole('button',{name:'CCU-Details schließen'}).click();
    await page.locator('.market-target').nth(1).getByRole('heading',{name:'Liberator',exact:true}).click();
    await chain.getByRole('heading',{name:'CCU-Kette → Liberator',exact:true}).waitFor();
    const targetCards = page.getByRole('region',{name:'Zielschiffkarten',exact:true});
    const priorityBadge = targetCards.getByText('Ziel 1 · CCU-Vorrang',{exact:true});
    await priorityBadge.waitFor();
    const selectedTarget = targetCards.locator('.market-target[aria-current="true"]');
    await selectedTarget.getByRole('heading',{name:'Liberator',exact:true}).waitFor();
    await selectedTarget.getByText('Ziel 2 · nach Ziel 1',{exact:true}).waitFor();
    await selectedTarget.getByText('In Bearbeitung',{exact:true}).waitFor();
    assert.equal(await selectedTarget.locator('.market-priority-label.first').count(),0);
    await chain.locator('.ccu-priority-info').getByText('Ziel 1 · Galaxy · 2 CCUs eingeplant',{exact:true}).waitFor();
    await chain.locator('.ccu-priority-info').getByText('0 freie CCU-Exemplare für Liberator',{exact:true}).waitFor();
    const viewport = await page.evaluate(() => ({width:innerWidth,height:innerHeight}));
    for (const width of [1440, 1024]) {
      await page.setViewportSize({width,height:850});
      assert.equal(await targetCards.locator('.market-priority').evaluateAll(rows =>
        rows.every(row => row.scrollWidth <= row.clientWidth + 1)),true);
    }
    await page.setViewportSize(viewport);
    await targetCards.screenshot({path:path.join(folder,'zielkarten-vorrang-testdaten.png')});
    await chain.locator('.ccu-priority-info').screenshot({path:path.join(folder,'ketten-vorrang-testdaten.png')});
    assert.equal(await chain.locator('.ccu-step.owned').count(),0);
    const draftsBefore=await app.evaluate(()=>JSON.stringify(globalThis.fixture.drafts));
    await app.evaluate(({},args)=>{
      const view=globalThis.fixture.views[args.account];
      view.document.pledges.push(...args.acquired);
      view.revision='88888888-8888-4888-8888-888888888888';
      view.observedAt=new Date().toISOString();
    },{account:a,acquired});
    await refresh.click();
    const mole=chain.locator('.ccu-step.owned').getByRole('button',{name:'CCU-Details: Apollo Medivac → MOLE',exact:true});
    await mole.waitFor();
    await hullCard.click();
    await chain.locator('.ccu-detail').getByText(/Pledge: hull-b ·/).waitFor();
    const stockHull=chain.locator('.ccu-stock-tile.owned').filter({hasText:'Hull B'}).filter({hasText:'Guardian'});
    assert.equal(await stockHull.count(),1);
    assert.equal(await chain.getByText('Ressourcenkonflikt',{exact:true}).count(),0);
    assert.equal(await app.evaluate(()=>JSON.stringify(globalThis.fixture.drafts)),draftsBefore);
    const cart=page.getByRole('region',{name:'Einkaufsliste fürs Messefinale',exact:true});
    const galaxyGap=cart.locator('tr').filter({hasText:'UTV → MDC'}).filter({hasText:'Galaxy'});
    const warbonds=cart.locator('tr').filter({hasText:'MDC → Guardian'});
    const cashOnly=warbonds.filter({hasText:'Liberator'});
    const liberatorGap=cart.locator('tr').filter({hasText:'Hull B → Apollo Medivac'});
    await cashOnly.waitFor();
    assert.match(await cart.locator('.shopping-head').innerText(),/Vorrang: Galaxy → Liberator/);
    assert.equal(await galaxyGap.locator('.shopping-credit').innerText(),'10,00 $');
    assert.equal(await warbonds.count(),2);
    assert.equal(await warbonds.filter({hasText:'Galaxy'}).getAttribute('data-kind'),'warbond');
    assert.equal(await cashOnly.getAttribute('data-kind'),'warbond');
    assert.equal(await cashOnly.locator('.shopping-credit').innerText(),'—');
    assert.equal(await cashOnly.locator('.shopping-cash').innerText(),'≈ 37,86 €');
    assert.equal(await liberatorGap.locator('.shopping-credit').innerText(),'10,00 $');
    assert.equal(await cart.locator('.shopping-cash-total').innerText(),'≈ 151,45 €');
    assert.equal(await cart.locator('tr').filter({hasText:'Apollo Medivac → MOLE'}).count(),0);
    assert.equal(await cart.locator('.shopping-owned [title*="Apollo Medivac → MOLE"]').count(),1);
    assert.equal(await cart.evaluate(el=>!!(el.compareDocumentPosition(document.querySelector('.market-offers-heading')) & Node.DOCUMENT_POSITION_FOLLOWING)),true);
    await cart.screenshot({path:path.join(folder,'messefinale-einkaufsliste.png')});
    const creditBudget=cart.getByRole('spinbutton',{name:'Store Credits einplanen'});
    await creditBudget.fill('40');
    assert.equal(await cart.locator('.shopping-credit-total').innerText(),'40,00 $');
    assert.equal(await cart.locator('.shopping-cash-total').innerText(),'≈ 173,08 €');
    await creditBudget.press('Enter');
    await page.waitForFunction(()=>{const field=document.querySelector('#shopping-credit-budget');return field?.value==='40.00'&&!field.disabled;});
    assert.deepEqual(await app.evaluate(({},account)=>globalThis.fixture.creditBudgets[account],a),{minor:4000,currency:'USD'});
    await app.evaluate(()=>{globalThis.fixture.market.offers.items.find(offer=>offer.targetName==='Liberator').change='missing';});
    const unavailable='Kein Vorschlag mit vollständig berechenbaren Preisen.';
    await chain.getByText(unavailable,{exact:true}).waitFor();
    await cart.locator('.shopping-issue').filter({hasText:'Liberator'}).filter({hasText:unavailable}).waitFor();
    assert.equal(await cart.locator('tr').filter({hasText:'MOLE → Liberator'}).count(),0);
    assert.equal(await galaxyGap.count(),1);
    assert.equal(await app.evaluate(()=>JSON.stringify(globalThis.fixture.drafts)),draftsBefore);
    await page.locator('.market-target').first().getByRole('heading',{name:'Galaxy',exact:true}).click();
    await hullCard.click();
    await chain.locator('.ccu-detail').getByText(/Pledge: hull-a ·/).waitFor();
    assert.equal(await mole.count(),0);
    await app.evaluate(({},account)=>{
      const f=globalThis.fixture, lower=f.drafts[account+':98'];
      f.drafts[account+':98']={...lower,mode:'manual',initialized:true,anchors:[
        {kind:'owned',key:JSON.stringify(['hull-a','hull-a:ccu']),fromName:'Guardian',toName:'Hull B'},
        {kind:'owned',key:JSON.stringify(['apollo-to-mole','apollo-to-mole:ccu']),fromName:'Apollo Medivac',toName:'MOLE'},
      ]};
    },a);
    const manual=await app.evaluate(()=>JSON.stringify(globalThis.fixture.drafts));
    await navigation.getByRole('button',{name:/Bestand/}).click();
    await navigation.getByRole('button',{name:/CCU-Planer/}).click();
    await page.locator('.market-target').nth(1).getByRole('heading',{name:'Liberator',exact:true}).click();
    await chain.getByText('Ressourcenkonflikt',{exact:true}).first().waitFor();
    assert.equal(await app.evaluate(()=>JSON.stringify(globalThis.fixture.drafts)),manual);
  });
  await check('FLEET_COMPARES_THREE_OPTIONS_AND_APPLIES_TARGETS_WITH_SLOT_PRIORITY',async()=>{
    const navigation=page.getByRole('navigation',{name:'Hauptbereiche'});
    await navigation.getByRole('button',{name:/Bestand/}).click();
    await app.evaluate(({},account)=>{
      const f=globalThis.fixture;
      for(const [oldId,id] of [[97,244],[98,224]]){
        f.market.catalogue.ships.find(ship=>ship.id===oldId).id=id;
        f.market.values.items.find(ship=>ship.id===oldId).id=id;
        const offer=f.market.offers.items.find(offer=>offer.toShipId===oldId);
        offer.toShipId=id;
        offer.change='current';
        f.drafts[account+':'+id]={...f.drafts[account+':'+oldId],mode:'auto',anchors:[]};
      }
      f.targets[account]=[224,244,null];
      const view=f.views[account];
      view.document.pledges=view.document.pledges.filter(pledge=>pledge.pledgeId!=='hull-b');
      view.revision='99999999-9999-4999-8999-999999999999';
      view.observedAt=new Date().toISOString();
    },a);
    await navigation.getByRole('button',{name:/CCU-Planer/}).click();
    await page.locator('.connection-actions').getByRole('button',{name:'Daten aktualisieren',exact:true}).click();
    await chain.getByRole('heading',{name:'CCU-Kette → Liberator',exact:true}).waitFor();
    await page.locator('.market-target').first().getByText(/Selbst gewählte LTI-Basis: MDC/).waitFor();
    assert.match(await page.locator('.market-target').first().evaluate(card=>getComputedStyle(card).backgroundImage),/^linear-gradient\(/);
    const draftBefore=await app.evaluate(()=>JSON.stringify(globalThis.fixture.drafts));
    const firstCommand=await app.evaluate(()=>globalThis.fixture.commands.length);
    await navigation.getByRole('button',{name:/Flottenplan/}).click();
    const view=page.getByRole('region',{name:'Flottenplan',exact:true});
    const together=view.getByRole('button',{name:'Liberator + Galaxy',exact:true});
    const galaxy=view.getByRole('button',{name:'Nur Galaxy',exact:true});
    await together.getByText('Vorrang 1 · Liberator → 2 · Galaxy · gemeinsames Budget').waitFor();
    await galaxy.getByText(/^Zielplatz 2 ·/).waitFor();
    assert.equal(await view.locator('.fleet-scenario').count(),3);
    assert.equal(await together.getAttribute('aria-pressed'),'true');
    assert.match(await together.evaluate(card=>getComputedStyle(card).backgroundImage),/^linear-gradient\(/);
    assert.notEqual(await together.evaluate(card=>getComputedStyle(card,'::after').backgroundImage),
      await galaxy.evaluate(card=>getComputedStyle(card,'::after').backgroundImage));
    assert.match(await view.locator('.fleet-budget strong').innerText(),/40,00\s*\$/);
    assert.match(await together.locator('.fleet-credit').innerText(),/40,00\s*\$/);
    assert.match(await together.locator('.fleet-cash').innerText(),/€$/);
    assert.equal(await together.locator('.fleet-art .market-ship').count(),2);
    assert.equal(await together.locator('.fleet-art img').count(),0);
    await view.locator('.fleet-resource').filter({hasText:/Guardian → Hull B.*Liberator/}).waitFor();
    const viewport=await page.evaluate(()=>({width:innerWidth,height:innerHeight}));
    await page.setViewportSize({width:1440,height:850});
    await page.screenshot({path:path.join(folder,'glasoptik-testdaten.png')});
    await page.setViewportSize({width:1024,height:760});
    assert.equal(await view.evaluate(el=>el.scrollWidth<=el.clientWidth && document.documentElement.scrollWidth<=innerWidth),true);
    assert.equal(new Set(await view.locator('.fleet-scenario').evaluateAll(cards=>cards.map(card=>card.getBoundingClientRect().top))).size,1);
    await view.screenshot({path:path.join(folder,'flottenplan-testdaten.png')});
    await page.setViewportSize(viewport);
    await galaxy.press('Enter');
    assert.equal(await galaxy.getAttribute('aria-pressed'),'true');
    assert.equal(await view.getByRole('region',{name:'Vorrang und Mehrkosten'}).count(),0);
    assert.deepEqual(await app.evaluate(({},account)=>globalThis.fixture.targets[account],a),[224,244,null]);
    assert.equal(await app.evaluate(()=>JSON.stringify(globalThis.fixture.drafts)),draftBefore);
    await view.getByRole('button',{name:'Variante übernehmen',exact:true}).click();
    await chain.getByRole('heading',{name:'CCU-Kette → Galaxy',exact:true}).waitFor();
    assert.equal(await page.getByRole('spinbutton',{name:'Store Credits einplanen'}).inputValue(),'40.00');
    assert.deepEqual(await app.evaluate(({},account)=>globalThis.fixture.targets[account],a),[null,244,null]);
    assert.equal(await app.evaluate(()=>JSON.stringify(globalThis.fixture.drafts)),draftBefore);
    const commands=await app.evaluate(({},start)=>globalThis.fixture.commands.slice(start),firstCommand);
    assert.equal(commands.filter(command=>command.action==='market.targets'&&command.ids).length,1);
    assert.deepEqual(commands.filter(command=>/^rsi\./.test(command.action)&&command.action!=='rsi.background'),[]);
  });
  await check('FLEET_SHOWS_ORIGINAL_SLOT_NUMBERS_WITH_GAPS_AND_ALL_THREE_TARGETS',async()=>{
    const nav=page.getByRole('navigation',{name:'Hauptbereiche'});
    for(const {ids,order} of [
      {ids:[224,null,244],order:'Vorrang 1 · Liberator → 3 · Galaxy · gemeinsames Budget'},
      {ids:[224,96,244],order:'Vorrang 1 · Liberator → 2 · MOLE → 3 · Galaxy · gemeinsames Budget'},
    ]){
      await nav.getByRole('button',{name:/Bestand/}).click();
      await app.evaluate(({},args)=>{globalThis.fixture.targets[args.account]=args.ids;},{account:a,ids});
      await nav.getByRole('button',{name:/Flottenplan/}).click();
      const view=page.getByRole('region',{name:'Flottenplan',exact:true});
      await view.getByText(order,{exact:true}).waitFor();
      await view.getByRole('button',{name:'Nur Galaxy',exact:true}).getByText(/^Zielplatz 3 ·/).waitFor();
      assert.equal(await view.locator('.fleet-scenario').count(),ids.filter(id=>id!==null).length+1);
    }
  });
  await check('BUYBACK_LIST_IS_READ_ONLY_AND_DISTINGUISHES_NOT_READ_EMPTY_AND_AVAILABLE',async()=>{
    const bundle=await build({stdin:{contents:"export {buybackFetchProbe} from './src/importers/rsi-buyback'",resolveDir:process.cwd()},
      bundle:true,platform:'node',format:'esm',write:false});
    const {buybackFetchProbe}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].contents).toString('base64'));
    const probe=buybackFetchProbe(1);
    const runProbe=html=>page.evaluate(`(async () => {
      const previous = window.fetch; let request;
      window.fetch = async (url, options) => {request={url,method:options.method,redirect:options.redirect};
        return new Response(${JSON.stringify(html)},{headers:{'content-type':'text/html; charset=utf-8'}});};
      try {return {result:await (${probe}),request};} finally {window.fetch=previous;}
    })()`);
    const fixtureHtml='<p role="alert">You have a credit buy-back token available.</p><ul class="pledges"><li><article class="pledge">'
      +'<h1>Test Cutter Package</h1><a href="/account/buy-back-pledges/42">Buy back</a>'
      +'<div class="package-listing ship"><ul><li><div class="info"><span>Test Cutter</span></div></li></ul></div>'
      +'<div class="package-listing item"><ul><li>Lifetime Insurance</li></ul></div>'
      +'<span class="final-price" data-value="4500" data-currency="USD" data-tax-basis="net">45</span></article></li></ul>';
    const parsed=await runProbe(fixtureHtml);
    assert.deepEqual(parsed.request,{url:'https://robertsspaceindustries.com/en/account/buy-back-pledges?page=1&pagesize=250',method:'GET',redirect:'error'});
    const entry=parsed.result.buybacks[0];
    assert.equal(entry.entryId,'42');assert.equal(entry.insurance.kind,'lti');
    assert.equal(entry.currentPrice.minor,4500);assert.deepEqual(entry.originalShips,['Test Cutter']);
    assert.equal(parsed.result.token,'available');assert.equal('href' in entry,false);
    assert.equal((await runProbe('<input type="password"><ul class="pledges"><li class="no-buy-backs"></li></ul>')).result,null);
    assert.deepEqual((await runProbe('<ul class="pledges"><li class="no-buy-backs">No Buy Backs</li></ul>')).result.buybacks,[]);

    const nav=page.getByRole('navigation',{name:'Hauptbereiche'});
    await nav.getByRole('button',{name:/Bestand/}).click();
    const firstCommand=await app.evaluate(()=>globalThis.fixture.commands.length);
    await page.getByRole('button',{name:'Buy Back',exact:true}).click();
    const panel=page.getByRole('region',{name:'Buy Back',exact:true});
    await panel.getByText('Rückkaufliste noch nicht eingelesen',{exact:true}).waitFor();
    const publish=async (revision,buybacks,token)=>{
      await app.evaluate(({},data)=>{
        const view=globalThis.fixture.views[data.account];
        view.revision=data.revision;view.observedAt=new Date().toISOString();
        view.document.buybacks=data.buybacks;
        view.document.buybackObservation={observedAt:view.observedAt,token:data.token,current:true};
      },{account:a,revision,buybacks,token});
      await page.locator('.connection-actions').getByRole('button',{name:'Daten aktualisieren',exact:true}).click();
    };
    await publish('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',[],'unknown');
    await panel.getByText('Keine Rückkaufeinträge gefunden',{exact:true}).waitFor();
    await publish('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',[entry],'available');
    await panel.getByText('Test Cutter',{exact:true}).waitFor();
    assert.equal(await panel.getByText('LTI',{exact:true}).count(),1);
    assert.match(await panel.locator('.buyback-price').innerText(),/40,91\s*€/);
    assert.equal(await panel.getByText('Ja, mit Token',{exact:true}).count(),1);
    assert.equal(await panel.getByRole('button').count(),0);
    assert.equal(await panel.getByRole('link').count(),0);
    const commands=await app.evaluate(({},start)=>globalThis.fixture.commands.slice(start),firstCommand);
    assert.deepEqual(commands.filter(command=>/^rsi\./.test(command.action)&&!['rsi.background','rsi.refresh'].includes(command.action)),[]);
    await panel.screenshot({path:path.join(folder,'buyback-testdaten.png')});
  });
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(folder,'results.json'),JSON.stringify({status:'PASS',version:testVersion,packagedRenderer:!!packaged,checks,errors,newRsiLogin:false,realUserFilesRead:false,networkRequests:0},null,2));console.log('REPORT: '+path.join(folder,'results.json'));
}catch(error){fs.writeFileSync(path.join(folder,'results.json'),JSON.stringify({status:'FAIL',checks,error:String(error),errors},null,2));console.log('REPORT: '+path.join(folder,'results.json'));throw error;}finally{if(app)await app.close();}
