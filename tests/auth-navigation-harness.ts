import { app, BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { RsiLogin } from '../src/importers/rsi';
import { SessionVault } from '../src/security/session-vault';
import { ConnectionDiagnostics } from '../src/diagnostics/connection';
import { APP_VERSION } from '../src/domain/model';
const root = path.resolve(process.argv.find(a => a.startsWith('--test-root='))!.slice(12));
assert(root.startsWith(path.resolve('work/temp/auth-navigation') + path.sep));
const baseline = process.argv.includes('--baseline');
app.setPath('userData', path.join(root, 'runtime')); app.setPath('sessionData', path.join(root, 'memory')); app.setPath('crashDumps', path.join(root, 'crashes'));
app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND');
app.commandLine.appendSwitch('proxy-server', 'http://127.0.0.1:1');
app.commandLine.appendSwitch('disable-background-networking'); app.commandLine.appendSwitch('disable-breakpad');
const origin = 'https://robertsspaceindustries.com';
const canary = 'SYNTHETIC_AUTH_NAVIGATION_PRIVATE_VALUE';
const diagnostics = new ConnectionDiagnostics(path.join(root, 'diagnostics'), baseline ? '0.3.6' : APP_VERSION);
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const results: string[] = [];
let stage = 'setup', navigationBlocked = false;
app.whenReady().then(async () => {
  const original = BrowserWindow.prototype.loadURL;
  const parent = new BrowserWindow({ show: false, webPreferences: { sandbox: true, nodeIntegration: false } });
  const vault = { load: async () => [], save: async () => false } as unknown as SessionVault;
  const login = new RsiLogin(vault, diagnostics), account = randomUUID();
  const loads: string[] = [];
  let authDomReads = 0;
  const authHtml = '<div class="c-account-sidebar__profile-info-handle">SYNTHETIC</div><ul class="list-items"><li><input class="js-pledge-id" value="synthetic-001"><input class="js-pledge-name" value="SYNTHETIC"><div class="items-col">Synthetic</div><div class="item"><span class="title">Demo Ship</span><span class="kind">Ship</span></div></li></ul>';
  BrowserWindow.prototype.loadURL = async function(url) {
    this.hide(); loads.push(url); this.webContents.getURL = () => url;
    const file = path.join(root, 'fixture-' + loads.length + '.html');
    fs.writeFileSync(file, url === origin + '/account/pledges' ? authHtml : '<input type="password"><p>Synthetic CAPTCHA/MFA wait</p>');
    const execute = this.webContents.executeJavaScript.bind(this.webContents);
    this.webContents.executeJavaScript = (async (...args: Parameters<typeof execute>) => {
      if (this.webContents.getURL().includes('/sign-in')) authDomReads++;
      return execute(...args);
    }) as typeof this.webContents.executeJavaScript;
    await this.loadFile(file);
  };
  try {
    let settled = false;
    const connection = login.connect(account, parent, false).then(candidate => { settled = true; return { candidate, error: null }; }, error => {
      settled = true; navigationBlocked = String(error?.message).includes('NAVIGATION_BLOCKED'); return { candidate: null, error };
    });
    let remote: BrowserWindow | undefined;
    for (let i = 0; i < 150; i++) {
      remote = BrowserWindow.getAllWindows().find(w => w !== parent);
      if (remote && !remote.webContents.isLoadingMainFrame() && remote.webContents.getURL().startsWith(origin)) break;
      await wait(20);
    }
    assert(remote);
    await remote.webContents.session.cookies.set({ url: origin, name: 'Rsi-Token', value: canary, path: '/', secure: true, httpOnly: true, sameSite: 'lax' });
    // A restored/stale auth cookie must never make the controller skip the modern login/MFA route.
    stage = 'modern-sign-in-wait'; remote.webContents.getURL = () => origin + '/en/sign-in';
    await wait(1700);
    assert.equal(settled, false, 'Modern sign-in must remain usable after CAPTCHA rather than NAVIGATION_BLOCKED');
    assert.equal(remote.isDestroyed(), false); assert.equal(loads.length, 1); assert.equal(authDomReads, 0);
    results.push('Modern sign-in remains open without DOM extraction or forced hangar while CAPTCHA/MFA is unfinished, even with an existing auth cookie.');

    stage = 'confirmation-step'; let prevented = false;
    remote.webContents.emit('will-redirect', { preventDefault: () => { prevented = true; } }, origin + '/en/sign-in/send-confirmation-code', false, true);
    assert.equal(prevented, false);
    remote.webContents.getURL = () => origin + '/en/sign-in/send-confirmation-code';
    await wait(1000); assert.equal(settled, false); assert.equal(loads.length, 1); assert.equal(authDomReads, 0);
    results.push('Exact confirmation-code step passes the real navigation guard and waits without triggering or bypassing verification.');

    stage = 'completed-return'; remote.webContents.getURL = () => origin + '/synthetic-return';
    const final = await Promise.race([connection, wait(6000).then(() => { throw new Error('SYNTHETIC_TIMEOUT'); })]);
    assert.equal(final.error, null); assert.equal(final.candidate?.document.pledges.length, 1);
    assert.deepEqual(loads, [origin + '/en/sign-in', origin + '/account/pledges']);
    assert.equal(remote.isDestroyed(), false); assert.equal(authDomReads, 0);
    results.push('Only after leaving authentication does the existing single fixed-hangar handoff produce a partial preview while retaining the RSI window.');

    stage = 'privacy'; const log = fs.readFileSync(diagnostics.file, 'utf8');
    assert.equal(log.includes(canary), false); assert.equal(log.includes(account), false); assert.equal(log.includes('https://'), false);
    results.push('Diagnostics contain no synthetic secret, profile identifier, URL, password or remote-page content.');
    await login.close(account); assert.equal(remote.isDestroyed(), true);
    assert.equal(login.status(account).state, 'closed');
    results.push('Explicit user close destroys the retained window and completes isolated-session cleanup.');
    fs.writeFileSync(path.join(root, 'results.json'), JSON.stringify({ status: 'PASS', baseline, data: 'synthetic-only; all loadURL replaced; DNS and proxy blocked', results }, null, 2));
  } catch {
    fs.writeFileSync(path.join(root, 'results.json'), JSON.stringify({ status: 'FAIL', baseline, stage, navigationBlocked, results }, null, 2));
    process.exitCode = 1;
  } finally { BrowserWindow.prototype.loadURL = original; await login.shutdown(); parent.destroy(); }
  app.exit(process.exitCode ? 1 : 0);
}).catch(() => { fs.writeFileSync(path.join(root, 'results.json'), JSON.stringify({ status: 'UNAVAILABLE', baseline, stage })); app.exit(1); });
