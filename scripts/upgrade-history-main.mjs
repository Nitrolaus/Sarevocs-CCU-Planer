import { _electron } from 'playwright-core';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const root = process.cwd(), require = createRequire(import.meta.url);
const folder = path.resolve('work/temp/upgrade-history-main', randomUUID()), appFolder = path.join(folder, 'app'), data = path.join(folder, 'data');
fs.mkdirSync(appFolder, { recursive: true });
const fixtureFile = path.join(folder, 'fixture.cjs');
await build({ entryPoints: ['tests/automatic-start-harness.ts'], outfile: fixtureFile, bundle: true, platform: 'node', format: 'cjs', external: ['electron', 'sql.js'] });
const fixture = require(fixtureFile), seed = await fixture.seedAutomaticStart(data, path.join(root, 'build/sql-wasm.wasm'));
const [a, b] = seed.accounts;
for (const account of seed.accounts) {
  const file = path.join(data, 'Daten/LetzterStand', account.id + '.json');
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  value.document.pledges.forEach((p, i) => { p.pledgeId = String(12345 + i); });
  fs.writeFileSync(file, JSON.stringify(value));
}
const mainFile = path.join(appFolder, 'main.cjs');
await build({ entryPoints: ['src/main.ts'], outfile: mainFile, bundle: true, platform: 'node', format: 'cjs', external: ['electron', 'sql.js'], plugins: [{ name: 'synthetic-history-wiring', setup(builder) {
  builder.onResolve({ filter: /(?:^|\/)importers\/rsi$/ }, () => ({ path: path.join(root, 'tests/automatic-start-harness.ts') }));
  builder.onResolve({ filter: /(?:^|\/)importers\/upgrade-history$/ }, () => ({ path: 'history-stub', namespace: 'fixture' }));
  builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `
    export class UpgradeHistoryReader {
      read(accountId,pledgeId,revision){return new Promise(resolve=>globalThis.ccuHistory.calls.push({accountId,pledgeId,revision,resolve}));}
      async close(id){globalThis.ccuHistory.closed.push(id);}
      async shutdown(){globalThis.ccuHistory.shutdown++; for(const c of globalThis.ccuHistory.calls)c.resolve({status:'cancelled',steps:[],partial:false});}
    }`, loader: 'js' }));
} }] });
for (const file of ['preload.cjs', 'app.ico', 'tray.ico', 'sql-wasm.wasm', 'demo-inventory.json']) fs.copyFileSync(path.join(root, 'build', file), path.join(appFolder, file));
fs.cpSync(path.join(root, 'build/renderer'), path.join(appFolder, 'renderer'), { recursive: true });
const entry = path.join(folder, 'entry.cjs');
fs.writeFileSync(entry, `
const {BrowserWindow,shell}=require('electron');
require(${JSON.stringify(fixtureFile)}).installAutomaticFixture(${JSON.stringify(seed)});
globalThis.ccuHistory={calls:[],closed:[],shutdown:0};
BrowserWindow.prototype.loadURL=async function(){throw Error('No remote navigation permitted');};
shell.openExternal=async function(){throw Error('No external application permitted');};
require(${JSON.stringify(mainFile)});`);
const env = { ...process.env, TEMP: path.resolve('work/temp/tooling'), TMP: path.resolve('work/temp/tooling') };
delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
let application, child, page;
const groups = [], pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn) { for (let i = 0; i < 200; i++) { if (await fn()) return; await pause(30); } throw Error('Synthetic history wiring timed out'); }
const command = value => page.evaluate(value => window.ccu.request(value), value);
const historyState = () => application.evaluate(() => ({ calls: globalThis.ccuHistory.calls.map(({accountId,pledgeId,revision}) => ({accountId,pledgeId,revision})), closed: globalThis.ccuHistory.closed }));
async function pending(key, value) { await page.evaluate(({key,value}) => {window.historyResults??={}; window.historyResults[key]=null;void window.ccu.request(value).then(result=>window.historyResults[key]=result);}, {key,value}); }
async function result(key) { await until(() => page.evaluate(key => !!window.historyResults[key], key)); return page.evaluate(key => window.historyResults[key], key); }
const request = (account = a) => ({ action: 'rsi.upgradeHistory', accountId: account.id, revision: seed.revisions[account.id], pledgeId: '12345' });
try {
  application = await _electron.launch({ executablePath: require('electron'), args: [entry, '--data-dir=' + data, '--disable-gpu', '--disable-background-networking', '--disable-breakpad', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost', '--proxy-server=http://127.0.0.1:9'], cwd: root, env });
  child = application.process(); page = await application.firstWindow(); await page.waitForFunction(() => !!window.ccu?.request);
  assert.equal((await command({action:'state'})).ok, true);
  for (const bad of [{...request(),pledgeId:'99999'}, {...request(),pledgeId:'12347'}, {...request(),revision:randomUUID()}, request(b)]) {
    const reply=await command(bad);assert.equal(reply.ok,true);assert.equal(reply.data.status,'unavailable');
  }
  assert.equal((await historyState()).calls.length,0);groups.push('Actual main IPC rejects unknown/CCU/old-revision/foreign-profile capabilities without invoking reader.');
  await pending('valid', request()); await until(async()=> (await historyState()).calls.length===1);
  assert.equal((await historyState()).calls[0].pledgeId,12345);
  await application.evaluate(()=>globalThis.ccuHistory.calls[0].resolve({status:'loaded',steps:[{from:'Synthetic Alpha',to:'Synthetic Beta',appliedAt:null}],partial:false}));
  assert.equal((await result('valid')).data.steps[0].to,'Synthetic Beta');groups.push('Valid observed ship resolves through typed numeric reader call and returns its steps.');
  await pending('stale',request());await until(async()=>(await historyState()).calls.length===2);
  await command({action:'account.select',accountId:b.id});
  await until(async()=>(await historyState()).closed.includes(a.id));
  await application.evaluate(()=>globalThis.ccuHistory.calls[1].resolve({status:'loaded',steps:[{from:'Synthetic Old',to:'Synthetic Foreign',appliedAt:null}],partial:false}));
  assert.equal((await result('stale')).data.status,'cancelled');groups.push('Profile switch closes history and suppresses a provider that returns stale data after cancellation.');
  await pending('close',request(b));await until(async()=>(await historyState()).calls.length===3);
  await command({action:'rsi.close',accountId:b.id});assert.equal((await historyState()).closed.includes(b.id),true);
  // Reader.close normally cancels these jobs. This intentionally misbehaving test provider verifies Main's revision gate separately.
  await application.evaluate(()=>globalThis.ccuHistory.calls[2].resolve({status:'cancelled',steps:[],partial:false}));
  assert.equal((await result('close')).data.status,'cancelled');
  assert.equal(await page.locator('dialog[open]').count(),0);
  assert.equal(await application.evaluate(()=>globalThis.ccuAutomaticStart.connectCalls.length),0);
  assert.equal(await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length),1);
  groups.push('Explicit close reaches reader; no auth dialog, connect, remote navigation, or extra window in wiring checks.');
  await application.evaluate(()=>globalThis.ccuAutomaticStart.releaseAll());
  await application.close(); application=undefined;
  fs.writeFileSync(path.join(folder,'results.json'),JSON.stringify({status:'PASS',groups,realSessionUsed:false,noNewLogin:true},null,2));
  console.log(JSON.stringify({status:'PASS',groups:groups.length,report:path.join(folder,'results.json')}));
} finally {
  if(application){await application.evaluate(()=>globalThis.ccuAutomaticStart.releaseAll()).catch(()=>{});await application.close().catch(()=>{});}
  if(child&&child.exitCode===null)child.kill();
}
