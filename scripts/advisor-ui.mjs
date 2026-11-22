import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {pathToFileURL} from 'node:url';
const template=fs.readFileSync('scripts/chain-ui.mjs','utf8'),marker='const checks=[],errors=[];let app;';assert.equal(template.split(marker).length,2);
let prefix=template.slice(0,template.indexOf(marker)).replaceAll('work/temp/chain-ui','work/temp/advisor-ui');
prefix=prefix.replace("const applied=ccu(","entries.push({...base,pledgeId:'second-base',name:'SYNTHETISCH second base'});\nconst applied=ccu(");
prefix=prefix.replace("fs.writeFileSync(path.join(folder,'fixture.json')",`fixture.targets[a]=[5,6,null];fixture.market.values={schemaVersion:1,source:'rsi-from-ships',fetchedAt:at,currency:'USD',taxBasis:'net',items:[...ships.map(s=>({id:s.id,name:s.name,minor:offers.find(o=>o.toShipId===s.id).regularMinor})),...[8,9,10].map(id=>({id,name:'SYNTHETIC TIE '+id,minor:5000}))]};
fixture.drafts={};for(const id of [5,6])fixture.drafts[a+':'+id]={mode:'manual',initialized:true,baseKey:JSON.stringify([id===5?'base':'second-base','current']),baseApprovedKey:JSON.stringify([id===5?'base':'second-base','current']),anchors:[{kind:'owned',key:JSON.stringify(['owned-a','owned-a:ccu']),fromName:ships[1].name,toName:ships[2].name},{kind:'owned',key:JSON.stringify(['owned-b','owned-b:ccu']),fromName:ships[3].name,toName:ships[4].name}]};
fs.writeFileSync(path.join(folder,'fixture.json')`);
const body=String.raw`
const checks=[],errors=[];let app;
const check=async(name,fn)=>{await fn();checks.push(name);console.log('PASS: '+name);};
try{
 app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),args:[path.join(folder,'fixture-main.cjs'),'--disable-gpu','--disable-background-networking','--host-resolver-rules=MAP * ~NOTFOUND'],env});
 const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.getByRole('heading',{name:'Bestand',exact:true}).waitFor();await page.getByRole('button',{name:/CCU-Planer/}).click();
 const chain=page.getByRole('region',{name:'Kettenbauer',exact:true}),tabs=chain.getByRole('tablist',{name:'Planungsbereich'}),purchase=chain.getByLabel('Heutiger CCU-Kaufoptimierer',{exact:true});
 const before=await app.evaluate(()=>JSON.stringify(globalThis.fixture.drafts));
 await check('ECLIPSE_EXCLUDES_PHYSICAL_RESERVATIONS_AND_EXPLAINS_THE_SHARED_MDC',async()=>{
  const nav=page.getByRole('navigation',{name:'Hauptbereiche'});
  await nav.getByRole('button',{name:/Bestand/}).click();
  const names=['UTV','MDC','Shared Start','Shared End','Meteor','Eclipse','Galaxy','Liberator'];
  const nominal=[3000,4000,6000,9000,13000,17000,22000,26000];
  const catalogue=names.map((name,i)=>({...ships[0],id:101+i,name}));
  const marketOffers=catalogue.map((s,i)=>({...offers[0],key:'test:'+s.id,toShipId:s.id,toSkuId:s.id+100,
    targetName:s.name,regularMinor:nominal[i],warbond:false,warbondMinor:null}));
  const basis=(id,modelName)=>({...pledge(id),ships:[{...base.ships[0],modelName}]});
  const stock=[basis('priority-utv','UTV'),basis('reserved-mdc','MDC'),basis('free-mdc','MDC'),
    ccu('used-copy','Shared Start','Shared End'),ccu('free-copy','Shared Start','Shared End'),
    ccu('second-ccu','Shared End','Liberator'),ccu('meteor-eclipse','Meteor','Eclipse')];
  const original=await app.evaluate(({},x)=>{
    const f=globalThis.fixture,a=x.account;
    const saved={market:f.market,view:f.views[a],targets:f.targets[a],drafts:f.drafts};
    const draft=(id,anchors=[])=>{
     const baseKey=JSON.stringify([id,'current']);
     return {mode:anchors.length?'manual':'auto',initialized:anchors.length>0,baseKey,baseApprovedKey:baseKey,anchors};
    };
    const anchor=(id,fromName,toName)=>({kind:'owned',key:JSON.stringify([id,id+':ccu']),fromName,toName});
    f.market={...f.market,catalogue:{fetchedAt:x.at,ships:x.catalogue},
      offers:{fetchedAt:x.at,sourceAt:x.at,checkedAt:x.at,items:x.marketOffers},
      values:{schemaVersion:1,source:'rsi-from-ships',currency:'USD',taxBasis:'net',fetchedAt:x.at,
        items:x.catalogue.map((s,i)=>({id:s.id,name:s.name,minor:x.nominal[i]}))}};
    f.views[a]={...f.views[a],revision:x.revision,observedAt:x.at,document:{...f.views[a].document,pledges:x.stock}};
    f.targets[a]=[107,108,106];
    f.drafts={...f.drafts,[a+':107']:draft('priority-utv',[anchor('used-copy','Shared Start','Shared End')]),
      [a+':108']:draft('reserved-mdc',[anchor('second-ccu','Shared End','Liberator')]),[a+':106']:draft('reserved-mdc')};
    return saved;
  },{account:a,at:new Date().toISOString(),catalogue,marketOffers,nominal,stock,revision:randomUUID()});
  await nav.getByRole('button',{name:/CCU-Planer/}).click();
  await page.getByRole('button',{name:'Daten aktualisieren',exact:true}).click();
  const targets=page.locator('.market-target');
  await targets.nth(2).getByRole('heading',{name:'Eclipse',exact:true}).click();
  await tabs.getByRole('tab',{name:'Vorrang & freie CCUs',exact:true}).click();
  const baseSelect=chain.getByLabel('Startbasis für die Kette',{exact:true});
  await chain.getByText('MDC ist bereits für Liberator eingeplant. Bitte eine freie LTI-Basis wählen.',{exact:true}).waitFor();
  assert.equal(await baseSelect.inputValue(),'');
  const baseKey=id=>JSON.stringify([id,'current']);
  assert.deepEqual(await baseSelect.locator('option').evaluateAll(options=>options.map(o=>o.value)),['',baseKey('free-mdc')]);
  const counts=chain.locator('.ccu-priority-info');
  await counts.getByText('Ziel 1 · Galaxy · 1 CCU eingeplant',{exact:true}).waitFor();
  await counts.getByText('Ziel 2 · Liberator · 1 CCU eingeplant',{exact:true}).waitFor();
  await counts.getByText('2 freie CCU-Exemplare für Eclipse',{exact:true}).waitFor();
  const tileKeys=()=>chain.locator('.ccu-stock-tile.owned').evaluateAll(cards=>cards.map(c=>c.dataset.resourceKey).sort());
  const ccuKey=id=>JSON.stringify([id,id+':ccu']);
  assert.deepEqual(await tileKeys(),[ccuKey('free-copy'),ccuKey('meteor-eclipse')]);
  const meteor=chain.locator('.ccu-stock-tile.owned').filter({hasText:'Meteor'});
  assert.equal(await meteor.getByRole('button',{name:/CCU einfügen/}).isEnabled(),false);
  await meteor.getByRole('button',{name:'Für Planung sperren: Meteor → Eclipse',exact:true}).click();
  await counts.getByText('1 freie CCU-Exemplare für Eclipse',{exact:true}).waitFor();
  assert.deepEqual(await tileKeys(),[ccuKey('free-copy')]);
  await chain.getByRole('button',{name:'Gesperrte CCUs anzeigen',exact:true}).click();
  await meteor.getByRole('button',{name:'Für Planung freigeben: Meteor → Eclipse',exact:true}).click();
  await counts.getByText('2 freie CCU-Exemplare für Eclipse',{exact:true}).waitFor();
  await chain.getByRole('button',{name:'Freie CCUs anzeigen',exact:true}).click();
  assert.deepEqual(await tileKeys(),[ccuKey('free-copy'),ccuKey('meteor-eclipse')]);
  const earlier=await app.evaluate(({},a)=>[globalThis.fixture.drafts[a+':107'],globalThis.fixture.drafts[a+':108']],a);
  await baseSelect.selectOption(baseKey('free-mdc'));
  const rail=chain.locator('.ccu-rail');
  await rail.getByRole('button',{name:'CCU-Details: Meteor → Eclipse',exact:true}).waitFor();
  await tabs.getByRole('tab',{name:'Kette bauen',exact:true}).click();
  assert.equal(await rail.isVisible(),true);
  assert.deepEqual(await tileKeys(),[ccuKey('free-copy'),ccuKey('meteor-eclipse')]);
  assert.deepEqual(await app.evaluate(({},a)=>[globalThis.fixture.drafts[a+':107'],globalThis.fixture.drafts[a+':108']],a),earlier);
  assert.equal(await app.evaluate(({},a)=>globalThis.fixture.drafts[a+':106'].baseKey,a),baseKey('free-mdc'));
  await tabs.getByRole('tab',{name:'Vorrang & freie CCUs',exact:true}).click();
  await counts.getByText('2 freie CCU-Exemplare für Eclipse',{exact:true}).waitFor();
  await chain.screenshot({path:path.join(folder,'eclipse-freier-bestand.png')});
  await nav.getByRole('button',{name:/Bestand/}).click();
  await app.evaluate(({},x)=>{
    const f=globalThis.fixture;
    f.market=x.original.market;f.views[x.account]=x.original.view;
    f.targets[x.account]=x.original.targets;f.drafts=x.original.drafts;
  },{account:a,original});
  await nav.getByRole('button',{name:/CCU-Planer/}).click();
  await page.getByRole('button',{name:'Daten aktualisieren',exact:true}).click();
 });
 await check('PURCHASE_WORKER_RETURNS_ALL_FOUR_TIED_ENTRY_SHIPS_AND_FULL_ROUTE_COMPARISONS',async()=>{await tabs.getByRole('tab',{name:'CCU-Kaufoptimierer',exact:true}).click();await purchase.getByRole('button',{name:'Einstiege prüfen',exact:true}).click();await purchase.locator('tbody tr').nth(3).waitFor({timeout:24000});assert.equal(await purchase.locator('tbody tr').count(),4);assert.match(await purchase.innerText(),/USD/);assert.match(await purchase.innerText(),/keine gemeinsame Einkaufsliste/);await purchase.locator('tbody tr').first().getByText('Anschluss und Vergleich',{exact:true}).click();assert.match(await purchase.locator('tbody tr').first().innerText(),/Ohne Neukauf/);assert.match(await purchase.locator('tbody tr').first().innerText(),/Mit Einstieg/);assert.equal(await app.evaluate(()=>JSON.stringify(globalThis.fixture.drafts)),before);await page.screenshot({path:path.join(folder,'purchase-desktop.png')});});
 await check('TABLE_PRICE_COLUMNS_STAY_VISIBLE_AND_LAYOUT_FITS_1000_1440_1920_PIXELS',async()=>{for(const width of [1000,1440,1920]){await page.setViewportSize({width,height:900});const layout=await purchase.evaluate(e=>{const table=e.querySelector('table'),box=e.getBoundingClientRect(),cells=[...table.querySelectorAll('thead th')].map(c=>c.getBoundingClientRect());return {overflow:document.documentElement.scrollWidth>window.innerWidth+1,fit:cells.at(-1).right<=box.right+1,headings:cells.length};});assert.equal(layout.overflow,false,'document overflow at '+width);assert.equal(layout.headings,5);if(width>=1440)assert.equal(layout.fit,true);};await purchase.locator('details[open] summary').click();await page.setViewportSize({width:1440,height:1000});await chain.screenshot({path:path.join(folder,'purchase-compact.png')});});
 await check('PROFILE_SWITCH_INVALIDATES_RESULTS_AND_NEVER_ACCEPTS_THE_OLD_PROFILE_PREVIEW',async()=>{await page.evaluate(()=>{const Native=window.Worker;window.Worker=function(...args){const actual=new Native(...args),wrapped={postMessage:actual.postMessage.bind(actual),terminate:actual.terminate.bind(actual)};actual.onmessage=e=>setTimeout(()=>wrapped.onmessage?.(e),700);actual.onerror=e=>wrapped.onerror?.(e);return wrapped;};});await purchase.getByRole('button',{name:'Einstiege prüfen',exact:true}).click();await page.getByRole('combobox',{name:'Lokales Kontoprofil'}).selectOption(b);await new Promise(r=>setTimeout(r,900));await purchase.getByText('Wähle mindestens ein Zielschiff mit geladenem Bestand.',{exact:true}).waitFor();assert.equal(await purchase.locator('tbody tr').count(),0);assert.equal(await app.evaluate(()=>JSON.stringify(globalThis.fixture.drafts)),before);});
 await check('NO_LOGIN_PURCHASE_IMPORT_OR_SESSION_MUTATION_COMMANDS',async()=>{const actions=await app.evaluate(()=>globalThis.fixture.commands.map(c=>c.action));assert.equal(actions.some(a=>['rsi.open','rsi.connect','rsi.authorize','rsi.delete','import.commit','market.openUpgrades'].includes(a)),false);assert.equal(errors.length,0);});
 fs.writeFileSync(path.join(folder,'results.json'),JSON.stringify({passed:true,version:testVersion,packagedRenderer:!!packaged,checks,errors},null,2));console.log('RESULT: '+folder);
}catch(error){fs.writeFileSync(path.join(folder,'results.json'),JSON.stringify({passed:false,checks,errors,error:String(error.stack)},null,2));console.error(error);console.log('RESULT: '+folder);process.exitCode=1;}finally{if(app)await app.close();}
`;
const bootstrap=path.resolve('work/temp/advisor-ui/bootstrap-'+randomUUID()+'.mjs');fs.mkdirSync(path.dirname(bootstrap),{recursive:true});fs.writeFileSync(bootstrap,prefix+body);await import(pathToFileURL(bootstrap).href);
