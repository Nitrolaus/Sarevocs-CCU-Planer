import { _electron } from 'playwright-core';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const root = process.cwd(), require = createRequire(import.meta.url);
const folder = path.resolve('work/temp/connect-tray', randomUUID()), appFolder = path.join(folder, 'app');
fs.mkdirSync(appFolder, { recursive: true });
await build({ entryPoints: ['src/main.ts'], outfile: path.join(appFolder, 'main.cjs'), bundle: true,
  platform: 'node', format: 'cjs', target: 'node24', external: ['electron', 'sql.js'] });
for (const file of ['preload.cjs', 'app.ico', 'tray.ico', 'sql-wasm.wasm', 'demo-inventory.json']) fs.copyFileSync(path.join(root, 'build', file), path.join(appFolder, file));
fs.cpSync(path.join(root, 'build/renderer'), path.join(appFolder, 'renderer'), { recursive: true });
const fixture = path.join(folder, 'synthetic-hangar.html');
fs.writeFileSync(fixture, `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'">
<div class="c-account-sidebar__profile-info-handle">SYNTHETIC_HANDLE</div><ul class="list-items"><li>
<input class="js-pledge-id" value="synthetic-001"><input class="js-pledge-name" value="SYNTHETIC PLEDGE">
<div class="items-col">Synthetic contents</div><div class="date-col">Synthetic date</div>
<div class="item"><span class="title">Demo Ship</span><span class="kind">Ship</span></div><div class="without-images"></div></li></ul>`);
const env = { ...process.env, TEMP: path.resolve('work/temp/tooling'), TMP: path.resolve('work/temp/tooling') };
delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
const results = []; let application, child;
async function waitFor(check, message) {
  const until = Date.now() + 12000;
  while (Date.now() < until) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 50)); }
  throw new Error(message);
}
try {
  application = await _electron.launch({ executablePath: require('electron'), args: [path.join(appFolder, 'main.cjs'),
    '--data-dir=' + path.join(folder, 'data'), '--disable-gpu', '--disable-background-networking',
    '--host-resolver-rules=MAP * ~NOTFOUND', '--proxy-server=http://127.0.0.1:9'], cwd: root, env });
  child = application.process();
  const page = await application.firstWindow();
  await page.getByRole('heading', { name: 'Bestand', exact: true }).waitFor();
  await application.evaluate(({ BrowserWindow }, fixture) => {
    const main = BrowserWindow.getAllWindows()[0]; globalThis.ccuMain = main;
    const focus = main.focus.bind(main), show = main.show.bind(main);
    main.focus = function() { globalThis.ccuActions.focus++; return focus(); };
    main.show = function() { globalThis.ccuActions.show++; return show(); };
    globalThis.ccuActions = { focus: 0, show: 0 };
    BrowserWindow.prototype.loadURL = async function(url) {
      if (url !== 'https://robertsspaceindustries.com/en/connect') throw new Error('Unexpected synthetic navigation');
      this.webContents.getURL = () => 'about:blank';
      globalThis.ccuLoadEntered = true;
      await new Promise(resolve => { globalThis.ccuReleaseHangar = resolve; });
      await this.loadFile(fixture);
      this.webContents.getURL = () => 'https://robertsspaceindustries.com/account/pledges';
    };
  }, fixture);
  const cases = process.argv.includes('--hidden-only') ? ['hidden'] : ['hidden', 'minimized', 'visible'];
  for (const state of cases) {
    await application.evaluate(({ Menu }) => { Menu.getApplicationMenu().getMenuItemById('app.open').click(); globalThis.ccuLoadEntered = false; });
    const created = await page.evaluate(async () => window.ccu.request({ action: 'account.create', name: 'SYNTHETIC CONNECT TRAY', mode: 'real' }));
    assert.equal(created.ok, true);
    await page.evaluate(accountId => { window.ccuConnectResult = null; window.ccu.request({ action: 'rsi.connect', accountId, remember: false }).then(result => { window.ccuConnectResult = result; }); }, created.data.id);
    await waitFor(() => application.evaluate(() => globalThis.ccuLoadEntered === true), 'Local synthetic navigation did not start');
    await application.evaluate((_electron, state) => {
      const main = globalThis.ccuMain;
      if (state === 'hidden') main.close();
      else if (state === 'minimized') main.minimize();
      globalThis.ccuActions = { focus: 0, show: 0 };
    }, state);
    await application.evaluate(() => globalThis.ccuReleaseHangar());
    await waitFor(() => page.evaluate(() => window.ccuConnectResult !== null), 'Actual rsi.connect did not return a preview');
    const result = await page.evaluate(() => window.ccuConnectResult);
    assert.equal(result.ok, true, result.error); assert.equal(result.data.adapter, 'rsi-dom-probe/1'); assert.ok(result.data.token);
    const windowState = await application.evaluate(() => ({ visible: globalThis.ccuMain.isVisible(), minimized: globalThis.ccuMain.isMinimized(), ...globalThis.ccuActions }));
    assert.equal(windowState.show, 0, 'Connect must not show the main window');
    if (state === 'hidden') { assert.equal(windowState.visible, false); assert.equal(windowState.focus, 0); }
    if (state === 'minimized') { assert.equal(windowState.minimized, true); assert.equal(windowState.focus, 0); }
    if (state === 'visible') { assert.equal(windowState.visible, true); assert.equal(windowState.focus, 1); }
    const inventory = await page.evaluate(async accountId => window.ccu.request({ action: 'inventory', accountId }), created.data.id);
    assert.equal(inventory.data.items.length, 0, 'Preview must not commit the synthetic inventory');
    await page.evaluate(async accountId => window.ccu.request({ action: 'rsi.close', accountId }), created.data.id);
    results.push(state + ': actual Main/RsiLogin/local DOM preview succeeds and preserves window visibility/minimization; no automatic import.');
  }
  await application.evaluate(({ app }) => app.quit()).catch(() => {});
  await waitFor(() => child.exitCode !== null, 'Synthetic app did not exit'); assert.equal(child.exitCode, 0);
  fs.writeFileSync(path.join(folder, 'results.json'), JSON.stringify({ status: 'PASS', data: 'synthetic-only', results }, null, 2));
  console.log('PASS:', results.join('\nPASS: ')); console.log('REPORT:', path.join(folder, 'results.json'));
} catch (error) {
  fs.writeFileSync(path.join(folder, 'results.json'), JSON.stringify({ status: 'FAIL', data: 'synthetic-only', results, error: error.message }, null, 2));
  console.error(error); console.log('REPORT:', path.join(folder, 'results.json')); process.exitCode = 1;
} finally {
  if (application && child?.exitCode === null) await application.evaluate(({ app }) => { globalThis.ccuReleaseHangar?.(); app.quit(); }).catch(() => {});
  if (application) await application.close().catch(() => {});
}
