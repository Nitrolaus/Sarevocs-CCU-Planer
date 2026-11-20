import { _electron } from 'playwright-core';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const require = createRequire(import.meta.url), root = process.cwd();
const folder = path.resolve('work/temp/shutdown-regression', randomUUID());
fs.mkdirSync(folder, { recursive: true });
const fixture = path.join(folder, 'synthetic-login.html');
fs.writeFileSync(fixture, '<!doctype html><p>SYNTHETIC OFFLINE LOGIN FIXTURE</p>');
const env = { ...process.env, TEMP: path.resolve('work/temp/tooling'), TMP: path.resolve('work/temp/tooling') };
delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
let application, child;
try {
  application = await _electron.launch({ executablePath: require('electron'), args: ['.', '--data-dir=' + path.join(folder, 'data'), '--disable-gpu'], cwd: root, env, timeout: 30000 });
  child = application.process();
  const page = await application.firstWindow();
  await page.getByRole('heading', { name: 'Bestand', exact: true }).waitFor();
  const account = await page.evaluate(async () => (await window.ccu.request({ action: 'account.create', name: 'SYNTHETIC SHUTDOWN ONLY', mode: 'real' })).data);
  await application.evaluate(({ BrowserWindow }, fixture) => {
    globalThis.ccuTestMainId = BrowserWindow.getAllWindows()[0].id;
    BrowserWindow.prototype.loadURL = async function () {
      this.webContents.getURL = () => 'https://robertsspaceindustries.com/en/connect';
      await this.loadFile(fixture);
    };
  }, fixture);
  const opened = await page.evaluate(async accountId => window.ccu.request({ action: 'rsi.open', accountId, remember: true }), account.id);
  assert.equal(opened.ok, true);
  await application.evaluate(async ({ safeStorage, BrowserWindow, dialog }) => {
    dialog.showErrorBox = (_title, message) => { globalThis.ccuSyntheticStorageError = message; };
    const original = safeStorage.encryptStringAsync.bind(safeStorage);
    const gate = new Promise(resolve => { globalThis.ccuReleaseEncryption = resolve; });
    globalThis.ccuEncryptionStarted = false;
    safeStorage.encryptStringAsync = async value => {
      if (!globalThis.ccuEncryptionStarted) {
        globalThis.ccuEncryptionStarted = true;
        await gate;
      }
      return original(value);
    };
    const remote = BrowserWindow.getAllWindows().find(w => w.id !== globalThis.ccuTestMainId);
    await remote.webContents.session.cookies.set({ url: 'https://robertsspaceindustries.com/', name: 'Rsi-Token', value: 'SYNTHETIC_ONLY', secure: true, httpOnly: true });
  });
  for (let i = 0; i < 100; i++) {
    if (await application.evaluate(() => globalThis.ccuEncryptionStarted)) break;
    await new Promise(r => setTimeout(r, 25));
  }
  assert.equal(await application.evaluate(() => globalThis.ccuEncryptionStarted), true);
  await application.evaluate(({ app }) => { app.quit(); app.quit(); }).catch(() => {});
  await new Promise(r => setTimeout(r, 300));
  assert.equal(child.exitCode, null, 'Repeated app.quit must not terminate while encrypted storage is blocked');
  assert.equal(fs.readdirSync(path.join(folder, 'data/Anmeldung')).filter(f => f.endsWith('.session.enc')).length, 0);
  await application.evaluate(() => { globalThis.ccuReleaseEncryption(); });
  let timer;
  try { await Promise.race([new Promise(resolve => child.once('exit', resolve)), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Synthetic app did not quit after save completion')), 12000); })]); }
  finally { clearTimeout(timer); }
  assert.equal(child.exitCode, 0);
  assert.equal(fs.readdirSync(path.join(folder, 'data/Anmeldung')).filter(f => f.endsWith('.session.enc')).length, 1);
  fs.writeFileSync(path.join(folder, 'results.json'), JSON.stringify({ status: 'PASS', data: 'synthetic-only', results: ['Actual Electron app defers repeated quit until encrypted synthetic session is saved; exit 0.'] }, null, 2));
  console.log('PASS: Wiederholtes Programmende wartet auf abgeschlossene verschluesselte Speicherung.');
  console.log('REPORT:', path.join(folder, 'results.json'));
} catch (error) {
  fs.writeFileSync(path.join(folder, 'results.json'), JSON.stringify({ status: 'FAIL', data: 'synthetic-only', error: error.message, exitCode: child?.exitCode }, null, 2));
  console.error(error.message); console.log('REPORT:', path.join(folder, 'results.json')); process.exitCode = 1;
} finally {
  if (application && child?.exitCode === null) {
    await application.evaluate(() => { globalThis.ccuReleaseEncryption?.(); }).catch(() => {});
    let cleanupTimer;
    try { await Promise.race([application.close().catch(() => {}), new Promise(resolve => { cleanupTimer = setTimeout(() => { if (child.exitCode === null) child.kill(); resolve(); }, 5000); })]); }
    finally { clearTimeout(cleanupTimer); }
  }
}
