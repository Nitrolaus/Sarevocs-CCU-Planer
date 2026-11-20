import { _electron } from 'playwright-core';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const root = process.cwd(), require = createRequire(import.meta.url);
const folder = path.resolve('work/temp/desktop-lifecycle', randomUUID());
const appFolder = path.join(folder, 'app');
fs.mkdirSync(appFolder, { recursive: true });
// Build the actual main source, retaining the normal renderer/preload/assets.
await build({ entryPoints: ['src/main.ts'], outfile: path.join(appFolder, 'main.cjs'), bundle: true,
  platform: 'node', format: 'cjs', target: 'node24', external: ['electron', 'sql.js'] });
for (const file of ['preload.cjs', 'app.ico', 'tray.ico', 'sql-wasm.wasm', 'demo-inventory.json']) fs.copyFileSync(path.join(root, 'build', file), path.join(appFolder, file));
fs.cpSync(path.join(root, 'build/renderer'), path.join(appFolder, 'renderer'), { recursive: true });
const wrapper = path.join(folder, 'entry.cjs');
fs.writeFileSync(wrapper, `
const { app, Tray, safeStorage, BrowserWindow, shell } = require('electron');
const fs = require('node:fs');
const journal = process.argv.find(x => x.startsWith('--journal=')).slice('--journal='.length);
const test = globalThis.ccuDesktopTest = { trays: [], menus: [], destroyed: 0, second: 0, remoteLoads: 0, external: 0 };
const write = () => fs.writeFileSync(journal, JSON.stringify({ trays: test.trays.length, destroyed: test.destroyed, second: test.second, remoteLoads: test.remoteLoads, external: test.external, queryPrevented: test.queryPrevented }));
const setMenu = Tray.prototype.setContextMenu, destroy = Tray.prototype.destroy;
Tray.prototype.setContextMenu = function(menu) {
  test.trays.push(this); test.menus.push(menu);
  if (process.argv.includes('--no-tray-fixture')) throw new Error('SYNTHETIC TRAY UNAVAILABLE');
  return setMenu.call(this, menu);
};
Tray.prototype.destroy = function() { test.destroyed++; const result = destroy.call(this); write(); return result; };
BrowserWindow.prototype.loadURL = async function() { test.remoteLoads++; throw new Error('Remote load forbidden in desktop-only regression'); };
shell.openExternal = async () => { test.external++; throw new Error('External launch forbidden in desktop-only regression'); };
app.on('second-instance', () => { test.second++; });
if (process.argv.includes('--gate-startup-fixture')) {
  const available = safeStorage.isAsyncEncryptionAvailable.bind(safeStorage);
  safeStorage.isAsyncEncryptionAvailable = async () => {
    test.startupWaiting = true;
    await new Promise(resolve => { test.releaseStartup = resolve; });
    return available();
  };
}
process.on('exit', write);
require(${JSON.stringify(path.join(appFolder, 'main.cjs'))});
`);
const env = { ...process.env, TEMP: path.resolve('work/temp/tooling'), TMP: path.resolve('work/temp/tooling') };
delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
const flags = ['--disable-gpu', '--disable-background-networking', '--disable-breakpad',
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost', '--proxy-server=http://127.0.0.1:9'];
const results = [];
const cdpOnly = process.argv.includes('--cdp-only');
let application, child, secondary;
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function waitFor(check, message, timeout = 12000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) { if (await check()) return; await pause(50); }
  throw new Error(message);
}
async function launch(name, extra = []) {
  const data = path.join(folder, name, 'data'), journal = path.join(folder, name, 'exit.json');
  fs.mkdirSync(path.dirname(journal), { recursive: true });
  // This regression concerns window/tray lifecycle after setup, not the first-run settings page.
  const preferences = path.join(data, 'Daten/Anzeige/display-v1.json');
  fs.mkdirSync(path.dirname(preferences), { recursive: true });
  if (!fs.existsSync(preferences)) {
    fs.writeFileSync(preferences, JSON.stringify({ schemaVersion: 1, language: 'de', currency: 'EUR', taxMode: 'net', vatBasisPoints: 1900 }));
  }
  application = await _electron.launch({ executablePath: require('electron'),
    args: [wrapper, '--data-dir=' + data, '--journal=' + journal, ...extra, ...flags], cwd: root, env, timeout: 30000 });
  child = application.process();
  return { data, journal, preferences };
}
async function second(data) {
  secondary = spawn(require('electron'), [wrapper, '--data-dir=' + data, '--journal=' + path.join(path.dirname(data), 'secondary.json'),
    'https://example.invalid/MUST_NOT_OPEN', '--unexpected-test-argument=NO_ACTION', ...flags], { cwd: root, env, windowsHide: true, stdio: 'ignore' });
  await waitFor(() => secondary.exitCode !== null, 'Zweite Instanz beendet sich nicht.');
  assert.equal(secondary.exitCode, 0); secondary = undefined;
}
async function exited(journal) {
  await waitFor(() => child.exitCode !== null, 'Anwendung beendet sich nicht geordnet.');
  assert.equal(child.exitCode, 0);
  const state = JSON.parse(fs.readFileSync(journal, 'utf8'));
  assert.equal(state.trays, 1); assert.equal(state.destroyed, 1);
  assert.equal(state.remoteLoads, 0); assert.equal(state.external, 0);
  await application.close(); application = undefined; child = undefined;
  return state;
}
try {
  if (!cdpOnly) {
  const first = await launch('normal', ['--gate-startup-fixture']);
  await waitFor(() => application.evaluate(() => globalThis.ccuDesktopTest.startupWaiting === true), 'Startgate nicht erreicht.');
  assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 0);
  await second(first.data);
  await waitFor(() => application.evaluate(() => globalThis.ccuDesktopTest.second === 1), 'Fruehe Zweitaktivierung fehlt.');
  await application.evaluate(() => globalThis.ccuDesktopTest.releaseStartup());
  const page = await application.firstWindow();
  await page.getByRole('heading', { name: 'Bestand', exact: true }).waitFor();
  const initial = await application.evaluate(({ BrowserWindow }) => {
    const windows = BrowserWindow.getAllWindows(), test = globalThis.ccuDesktopTest;
    return { count: windows.length, id: windows[0].id, visible: windows[0].isVisible(), trays: test.trays.length,
      labels: test.menus[0].items.map(item => item.label) };
  });
  assert.equal(initial.count, 1); assert.equal(initial.visible, true); assert.equal(initial.trays, 1);
  assert.deepEqual(initial.labels, ['Öffnen', 'Beenden']);
  results.push('Reale Hauptquelle: zweite Instanz waehrend asynchronem Start beendet sich; genau ein Hauptfenster und ein natives Tray-Icon.');
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  assert.deepEqual(await application.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]; return { id: window.id, visible: window.isVisible() };
  }), { id: initial.id, visible: false });
  assert.equal(child.exitCode, null);
  await application.evaluate(() => { const test = globalThis.ccuDesktopTest; test.menus[0].getMenuItemById('tray.open').click(); });
  await waitFor(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), 'Tray-Oeffnen zeigt Fenster nicht.');
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
  await waitFor(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized()), 'Fenster wird nicht minimiert.');
  await second(first.data);
  await waitFor(() => application.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]; return window.isVisible() && !window.isMinimized() && window.isFocused();
  }), 'Zweite Instanz stellt Hauptfenster nicht wieder her und fokussiert es nicht.');
  assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].id), initial.id);
  assert.equal(await application.evaluate(() => globalThis.ccuDesktopTest.trays.length), 1);
  await application.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].close(); globalThis.ccuDesktopTest.trays[0].emit('click'); });
  assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), true);
  results.push('X versteckt dasselbe Fenster; natives Tray-Menue/Klick zeigen es; zweite Instanz stellt minimiertes Fenster wieder her und fokussiert es. Keine Argument-/URL-Ausfuehrung.');
  await application.evaluate(() => globalThis.ccuDesktopTest.menus[0].getMenuItemById('tray.quit').click()).catch(() => {});
  assert.equal((await exited(first.journal)).second, 2);
  results.push('Natives Tray-Menue Beenden: geordneter Exit 0 und genau einmalige Icon-Entfernung.');
  const closeMode = await launch('close-mode');
  const settingsPage = await application.firstWindow();
  await settingsPage.getByRole('button', { name: 'Daten & Einstellungen' }).click();
  const closeChoice = settingsPage.getByRole('combobox', { name: 'Beim Schließen mit X' });
  assert.equal(await closeChoice.inputValue(), 'tray');
  await closeChoice.selectOption('quit');
  await settingsPage.getByRole('button', { name: 'Speichern', exact: true }).click();
  await settingsPage.getByText('Einstellungen gespeichert.', { exact: true }).waitFor();
  assert.equal(JSON.parse(fs.readFileSync(closeMode.preferences, 'utf8')).windowClose, 'quit');
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close()).catch(() => {});
  await exited(closeMode.journal);

  const closeRestart = await launch('close-mode');
  const restartPage = await application.firstWindow();
  await restartPage.getByRole('button', { name: 'Daten & Einstellungen' }).click();
  assert.equal(await restartPage.getByRole('combobox', { name: 'Beim Schließen mit X' }).inputValue(), 'quit');
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close()).catch(() => {});
  await exited(closeRestart.journal);
  results.push('„Programm beenden“ wirkt sofort und nach Neustart. X nutzt beide Male den geordneten Quitweg samt Tray-Aufräumen.');

  const shortcut = await launch('shortcut');
  const shortcutPage = await application.firstWindow();
  await shortcutPage.getByRole('heading', { name: 'Bestand', exact: true }).waitFor();
  await shortcutPage.bringToFront();
  await waitFor(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFocused()), 'Hauptfenster fuer Tastaturtest nicht fokussiert.');
  await application.evaluate(({ BrowserWindow }) => {
    const contents = BrowserWindow.getAllWindows()[0].webContents;
    contents.sendInputEvent({ type: 'keyDown', keyCode: 'Q', modifiers: ['control'] });
    contents.sendInputEvent({ type: 'keyUp', keyCode: 'Q', modifiers: ['control'] });
  }).catch(() => {});
  await exited(shortcut.journal);
  results.push('Electron-Tastatureingabe Ctrl+Q erreicht den nativen Accelerator: Exit 0 und Tray-Icon entfernt.');
  }
  const cdpRun = await launch('cdp-close');
  const cdpPage = await application.firstWindow();
  await cdpPage.getByRole('heading', { name: 'Bestand', exact: true }).waitFor();
  const cdp = await cdpPage.context().newCDPSession(cdpPage);
  await cdp.send('Browser.close').catch(() => {});
  await exited(cdpRun.journal);
  results.push('Vorhandenes CDP Browser.close beendet die echte Hauptquelle mit Exit 0 und entfernt das Tray-Icon.');
  if (!cdpOnly) {
  const os = await launch('session-query');
  await (await application.firstWindow()).getByRole('heading', { name: 'Bestand', exact: true }).waitFor();
  await application.evaluate(({ BrowserWindow }) => {
    let prevented = false;
    BrowserWindow.getAllWindows()[0].emit('query-session-end', { preventDefault() { prevented = true; }, reasons: ['logoff'] });
    globalThis.ccuDesktopTest.queryPrevented = prevented;
  }).catch(() => {});
  assert.equal((await exited(os.journal)).queryPrevented, true);
  results.push('Synthetisches Windows-query-session-end leitet in den geordneten Quitweg; kein tatsaechliches Windows-Abmelden getestet.');
  const fallback = await launch('tray-unavailable', ['--no-tray-fixture']);
  await (await application.firstWindow()).getByRole('heading', { name: 'Bestand', exact: true }).waitFor();
  assert.equal(await application.evaluate(() => globalThis.ccuDesktopTest.destroyed), 1);
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close()).catch(() => {});
  await exited(fallback.journal);
  results.push('Bei synthetisch nicht verfuegbarem Tray wird das unbrauchbare Icon entfernt und X beendet die Anwendung erreichbar.');
  }
  fs.writeFileSync(path.join(folder, 'results.json'), JSON.stringify({ status: 'PASS', data: 'synthetic-only', source: 'src/main.ts', results }, null, 2));
  console.log('PASS:', results.join('\nPASS: ')); console.log('REPORT:', path.join(folder, 'results.json'));
} catch (error) {
  fs.writeFileSync(path.join(folder, 'results.json'), JSON.stringify({ status: 'FAIL', data: 'synthetic-only', results, error: error.message }, null, 2));
  console.error(error); console.log('REPORT:', path.join(folder, 'results.json')); process.exitCode = 1;
} finally {
  if (secondary?.exitCode === null) secondary.kill();
  if (application && child?.exitCode === null) {
    await application.evaluate(({ app }) => { globalThis.ccuDesktopTest.releaseStartup?.(); app.quit(); }).catch(() => {});
    try { await waitFor(() => child.exitCode !== null, 'Testprozess musste erzwungen beendet werden.', 12000); }
    catch (error) { child.kill(); console.error(error.message); process.exitCode = 1; }
  }
  if (application) await application.close().catch(() => {});
}
