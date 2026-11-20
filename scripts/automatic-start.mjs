import { _electron } from 'playwright-core';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';

const root = process.cwd(), require = createRequire(import.meta.url);
const folder = path.resolve('work/temp/automatic-start', randomUUID()), appFolder = path.join(folder, 'app'), data = path.join(folder, 'data');
fs.mkdirSync(appFolder, { recursive: true });
const fixtureModule = path.join(folder, 'fixture.cjs'), mainFile = path.join(appFolder, 'main.cjs');
await build({ entryPoints: ['tests/automatic-start-harness.ts'], outfile: fixtureModule, bundle: true,
  platform: 'node', format: 'cjs', target: 'node24', external: ['electron', 'sql.js'] });
const fixture = require(fixtureModule);
const seed = await fixture.seedAutomaticStart(data, path.join(root, 'build/sql-wasm.wasm'));
const [a, b] = seed.accounts;
await build({ entryPoints: ['src/main.ts'], outfile: mainFile, bundle: true,
  platform: 'node', format: 'cjs', target: 'node24', external: ['electron', 'sql.js'], plugins: [{
    name: 'synthetic-rsi-only', setup(builder) {
      builder.onResolve({ filter: /(?:^|\/)importers\/rsi$/ }, () => ({ path: path.join(root, 'tests/automatic-start-harness.ts') }));
    },
  }] });
for (const file of ['preload.cjs', 'app.ico', 'tray.ico', 'sql-wasm.wasm', 'demo-inventory.json']) fs.copyFileSync(path.join(root, 'build', file), path.join(appFolder, file));
fs.cpSync(path.join(root, 'build/renderer'), path.join(appFolder, 'renderer'), { recursive: true });
const entry = path.join(folder, 'entry.cjs');
fs.writeFileSync(entry, `
const { BrowserWindow, shell } = require('electron');
require(${JSON.stringify(fixtureModule)}).installAutomaticFixture(${JSON.stringify(seed)});
BrowserWindow.prototype.loadURL = async function() { globalThis.ccuAutomaticStart.remoteLoads++; throw new Error('Remote navigation forbidden in wiring regression'); };
shell.openExternal = async function() { throw new Error('External launch forbidden in wiring regression'); };
require(${JSON.stringify(mainFile)});
`);
const env = { ...process.env, TEMP: path.resolve('work/temp/tooling'), TMP: path.resolve('work/temp/tooling') };
delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
const results = [];
let application, child, page;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, message) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) { if (await check()) return; await pause(30); }
  throw new Error(message);
}
const inspect = () => application.evaluate(() => globalThis.ccuAutomaticStart.snapshot());
const command = value => page.evaluate(value => window.ccu.request(value), value);
async function request(key, value) {
  await page.evaluate(({ key, value }) => {
    window.ccuWiringResults ??= {};
    window.ccuWiringResults[key] = null;
    window.ccu.request(value).then(result => { window.ccuWiringResults[key] = result; });
  }, { key, value });
}
async function result(key) {
  await until(() => page.evaluate(key => window.ccuWiringResults[key] !== null, key), `IPC ${key} did not complete`);
  return page.evaluate(key => window.ccuWiringResults[key], key);
}
const ledger = path.join(data, 'Daten/inventory.sqlite');
const hashLedger = () => createHash('sha256').update(fs.readFileSync(ledger)).digest('hex');
const ledgerBefore = hashLedger();
const cacheFile = path.join(data, 'Daten/LetzterStand', a.id + '.json');
const cacheBefore = fs.readFileSync(cacheFile);
async function assertCanonicalUnchanged() {
  for (const account of seed.accounts) {
    const inventory = await command({ action: 'inventory', accountId: account.id });
    assert.equal(inventory.ok, true); assert.equal(inventory.data.items.length, 0);
    assert.equal(inventory.data.account.reference, null); assert.equal(inventory.data.account.identityStatus, 'unbound');
  }
  assert.equal(hashLedger(), ledgerBefore, 'Background wiring must not persist canonical ledger changes');
}
try {
  application = await _electron.launch({ executablePath: require('electron'), args: [entry, '--data-dir=' + data,
    '--disable-gpu', '--disable-background-networking', '--disable-breakpad',
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost', '--proxy-server=http://127.0.0.1:9'], cwd: root, env, timeout: 30000 });
  child = application.process(); page = await application.firstWindow();
  await page.waitForFunction(() => !!window.ccu?.request);
  await until(async () => (await inspect()).resume.some(call => call.accountId === a.id), 'Startup did not request the selected synthetic profile');
  const initialState = await command({ action: 'state' });
  assert.equal(initialState.ok, true); assert.equal(initialState.data.selectedAccountId, a.id);
  const initial = await command({ action: 'rsi.background', accountId: a.id });
  assert.equal(initial.ok, true); assert.equal(initial.data.status, 'connecting');
  assert.equal(initial.data.revision, seed.revisions[a.id]); assert.equal(initial.data.view.accountId, a.id);
  assert.equal(initial.data.view.document.pledges[0].name, 'SYNTHETIC_CACHED_A PLEDGE 0');
  await page.waitForFunction(() => document.querySelector('tbody')?.textContent?.includes('SYNTHETIC_CACHED_A'));
  assert.equal((await inspect()).resume[0].settled, false, 'Cache must be available before resume settles');
  assert.equal((await inspect()).connect.length, 0, 'Startup must not start interactive authorization');
  assert.equal(await page.locator('dialog[open]').count(), 0, 'Startup must not open login or live-import dialogs');
  assert.equal(await page.getByRole('combobox', { name: 'Lokales Kontoprofil', exact: true }).isEnabled(), true);
  assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
  assert.equal((await inspect()).remoteLoads, 0);
  results.push('Startup: actual main/IPC returns the selected cache while resume is pending; the real renderer shows it without any remote window or navigation.');

  const beforeEarly = await inspect();
  await application.evaluate((_electron, id) => globalThis.ccuAutomaticStart.nextCloseGate(id), a.id);
  await request('early-authorize', { action: 'rsi.authorize', accountId: a.id, remember: false });
  await until(async () => (await inspect()).close.length > beforeEarly.close.length, 'Authorizer did not enter the restore cancellation gate');
  const earlyGate = beforeEarly.close.length;
  await request('early-close', { action: 'rsi.close', accountId: a.id });
  await until(async () => (await inspect()).close.length > earlyGate + 1, 'User close did not reach the pending authorizer');
  assert.equal((await inspect()).connect.length, 0, 'Connect must remain gated until old restore cancellation finishes');
  await application.evaluate((_electron, index) => globalThis.ccuAutomaticStart.releaseClose(index), earlyGate);
  const early = await result('early-authorize');
  assert.equal((await result('early-close')).ok, true);
  assert.equal(early.ok, false, 'An authorizer cancelled before connect must fail');
  assert.equal((await inspect()).connect.length, 0, 'Cancelled authorizer must never start connect after the gate');
  assert.deepEqual(fs.readFileSync(cacheFile), cacheBefore);
  results.push('Early cancel: rsi.close invalidates an authorizer waiting on restore cleanup; opening the old gate cannot start connect or replace the cache.');

  await request('late-authorize', { action: 'rsi.authorize', accountId: a.id, remember: false });
  await until(async () => (await inspect()).connect.length === 1, 'Manual authorizer did not reach the fake provider');
  await request('late-close', { action: 'rsi.close', accountId: a.id });
  await until(async () => (await inspect()).connect[0].aborted, 'Actual main did not pass and abort a signal');
  await application.evaluate(() => globalThis.ccuAutomaticStart.releaseConnect(0, 'SYNTHETIC_FORBIDDEN_LATE'));
  const late = await result('late-authorize'); assert.equal(late.ok, false);
  assert.equal((await result('late-close')).ok, true);
  const retained = await command({ action: 'rsi.background', accountId: a.id });
  assert.equal(retained.data.revision, seed.revisions[a.id]); assert.notEqual(retained.data.status, 'connected');
  assert.deepEqual(fs.readFileSync(cacheFile), cacheBefore);
  results.push('Late cancel: even a provider ignoring AbortSignal cannot publish its post-close candidate or mark the cache connected.');

  const aBeforeSwitch = (await inspect()).resume.filter(call => call.accountId === a.id).length;
  assert.equal((await command({ action: 'rsi.refresh', accountId: a.id })).ok, true);
  await until(async () => (await inspect()).resume.filter(call => call.accountId === a.id).length > aBeforeSwitch, 'Fresh A restore did not start');
  const beforeSwitch = await inspect();
  await application.evaluate((_electron, id) => globalThis.ccuAutomaticStart.nextCloseGate(id), a.id);
  assert.equal((await command({ action: 'account.select', accountId: b.id })).ok, true);
  await until(async () => (await inspect()).close.length > beforeSwitch.close.length, 'A cancellation gate was not entered');
  assert.equal((await command({ action: 'account.select', accountId: a.id })).ok, true);
  assert.equal((await command({ action: 'state' })).data.selectedAccountId, a.id, 'Selection IPC must not wait on restore cleanup');
  const aWhileBlocked = (await inspect()).resume.filter(call => call.accountId === a.id).length;
  await application.evaluate((_electron, index) => globalThis.ccuAutomaticStart.releaseClose(index), beforeSwitch.close.length);
  await until(async () => (await inspect()).resume.filter(call => call.accountId === a.id).length > aWhileBlocked, 'Returning to A did not restart A after cancellation cleanup');
  const switched = await inspect();
  const lastResume = switched.resume.length - 1; assert.equal(switched.resume[lastResume].accountId, a.id);
  await application.evaluate((_electron, index) => globalThis.ccuAutomaticStart.releaseResume(index, 'SYNTHETIC_REFRESHED_A'), lastResume);
  await until(async () => (await command({ action: 'rsi.background', accountId: a.id })).data.status === 'connected', 'Latest A result was not published');
  const refreshed = await command({ action: 'rsi.background', accountId: a.id });
  assert.notEqual(refreshed.data.revision, seed.revisions[a.id]);
  assert.equal(refreshed.data.view.document.pledges[0].name, 'SYNTHETIC_REFRESHED_A PLEDGE 0');
  results.push('A-B-A: selection replies immediately while cleanup is gated; after cleanup the latest A selection starts a new restore and receives its own new cache.');

  const callsBeforeInvalid = await inspect();
  for (const invalid of [
    { action: 'rsi.refresh', accountId: a.id, sourceUrl: 'https://example.invalid/forbidden' },
    { action: 'rsi.authorize', accountId: a.id, remember: false, script: 'forbidden' },
    { action: 'rsi.background', accountId: a.id, knownRevision: 'invalid-revision' },
    { action: 'rsi.fetch', accountId: a.id, page: 1 },
  ]) { const denied = await command(invalid); assert.equal(denied.ok, false); assert.match(denied.error, /Ungültiger Anwendungsaufruf/); }
  const callsAfterInvalid = await inspect();
  assert.equal(callsAfterInvalid.connect.length, callsBeforeInvalid.connect.length);
  assert.equal(callsAfterInvalid.resume.length, callsBeforeInvalid.resume.length); assert.equal(callsAfterInvalid.remoteLoads, 0);
  await assertCanonicalUnchanged();
  results.push('Strict IPC: unknown actions/source/script/revision parameters are rejected before providers run; both canonical accounts, items and SQLite bytes remain unchanged.');

  await application.evaluate(({ app }) => { globalThis.ccuAutomaticStart.releaseAll(); app.quit(); }).catch(() => {});
  await until(() => child.exitCode !== null, 'Synthetic application did not shut down'); assert.equal(child.exitCode, 0);
  fs.writeFileSync(path.join(folder, 'results.json'), JSON.stringify({ status: 'PASS', data: 'synthetic-only; real main/IPC/SQLite/LastSeen/BackgroundInventory; RsiLogin replaced by deferred provider; all remote navigation forbidden', results }, null, 2));
  console.log('PASS:', results.join('\nPASS: ')); console.log('REPORT:', path.join(folder, 'results.json'));
} catch (error) {
  fs.writeFileSync(path.join(folder, 'results.json'), JSON.stringify({ status: 'FAIL', data: 'synthetic-only', results, error: error.message }, null, 2));
  console.error(error); console.log('REPORT:', path.join(folder, 'results.json')); process.exitCode = 1;
} finally {
  if (application && child?.exitCode === null) {
    await application.evaluate(({ app }) => { globalThis.ccuAutomaticStart.releaseAll(); app.quit(); }).catch(() => {});
    try { await until(() => child.exitCode !== null, 'Synthetic app required forced cleanup'); }
    catch (error) { child.kill(); console.error(error.message); process.exitCode = 1; }
  }
  if (application) await application.close().catch(() => {});
}
