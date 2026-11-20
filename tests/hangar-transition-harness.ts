import { app, BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { RsiLogin } from '../src/importers/rsi';
import { SessionVault } from '../src/security/session-vault';
import { ConnectionDiagnostics } from '../src/diagnostics/connection';
import { APP_VERSION } from '../src/domain/model';

const root = path.resolve(process.argv.find(x => x.startsWith('--test-root='))!.slice(12));
app.setPath('userData', path.join(root, 'runtime')); app.setPath('sessionData', path.join(root, 'memory')); app.setPath('crashDumps', path.join(root, 'crashes'));
app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND');
app.commandLine.appendSwitch('proxy-server', 'http://127.0.0.1:1');
const results: string[] = [], canary = 'SYNTHETIC_TRANSITION_PRIVATE_VALUE';
const auth = '<div class="c-account-sidebar__profile-info-handle">SYNTHETIC_HANDLE</div><ul class="list-items"><li><input class="js-pledge-id" value="synthetic-001"><input class="js-pledge-name" value="SYNTHETIC PLEDGE"><div class="items-col">Synthetic</div><div class="date-col">Synthetic</div><div class="item"><span class="title">Demo Ship</span><span class="kind">Ship</span></div><div class="without-images"></div></li></ul>';
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const diagnostics = new ConnectionDiagnostics(path.join(root, 'diagnostics'), APP_VERSION);
app.whenReady().then(async () => {
  const original = BrowserWindow.prototype.loadURL;
  const parent = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, sandbox: true } });
  const vault = { load: async () => [], save: async () => false } as unknown as SessionVault;
  const login = new RsiLogin(vault, diagnostics), account = randomUUID();
  const requests: string[] = [];
  let hangarBody = auth, hangarUrl = 'https://robertsspaceindustries.com/account/pledges', unapprovedReads = 0;
  BrowserWindow.prototype.loadURL = async function(url) {
    requests.push(url);
    const isHangar = url === 'https://robertsspaceindustries.com/account/pledges';
    this.webContents.getURL = () => isHangar ? hangarUrl : url;
    const fixture = path.join(root, 'fixture-' + requests.length + '.html');
    fs.writeFileSync(fixture, isHangar ? hangarBody : '<input type="password"><p>Local synthetic login only</p>');
    await this.loadFile(fixture);
  };
  async function remote() {
    for (let i = 0; i < 150; i++) {
      const w = BrowserWindow.getAllWindows().find(w => w !== parent);
      if (w && !w.webContents.isLoadingMainFrame() && w.webContents.getURL().startsWith('https://')) { w.hide(); return w; }
      await wait(20);
    }
    throw new Error('Synthetic remote window missing');
  }
  async function token(w: BrowserWindow) {
    await w.webContents.session.cookies.set({ url: 'https://robertsspaceindustries.com/', name: 'Rsi-Token', value: canary,
      secure: true, httpOnly: true, sameSite: 'lax', path: '/', expirationDate: Date.now() / 1000 + 3600 });
  }
  async function bounded<T>(task: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([task, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Synthetic transition timed out')), 6000); })]); }
    finally { if (timer) clearTimeout(timer); }
  }
  try {
    // The URL change represents history.pushState, which does not emit will-navigate.
    const spa = login.connect(account, parent, false).then(candidate => ({ candidate, error: undefined }), error => ({ candidate: undefined, error }));
    const w = await remote(); await token(w);
    const execute = w.webContents.executeJavaScript.bind(w.webContents);
    w.webContents.executeJavaScript = (async (...args: Parameters<typeof execute>) => {
      if (w.webContents.getURL().includes('/synthetic-return')) unapprovedReads++;
      return execute(...args);
    }) as typeof w.webContents.executeJavaScript;
    w.webContents.getURL = () => 'https://robertsspaceindustries.com/synthetic-return?token=' + canary;
    const spaResult = await bounded(spa);
    assert.equal(spaResult.error?.message, undefined, 'Post-login URL must hand off to the fixed hangar instead of the old generic navigation error');
    assert.equal(spaResult.candidate?.document.pledges.length, 1);
    assert.equal(unapprovedReads, 0); assert.equal(w.isDestroyed(), false);
    assert.deepEqual(requests, ['https://robertsspaceindustries.com/en/connect', 'https://robertsspaceindustries.com/account/pledges']);
    await login.close(account); assert.equal(w.isDestroyed(), true);
    results.push('Synthetic SPA return with auth cookie reaches exactly the fixed hangar and produces a partial preview with the window retained until explicit close; unapproved URL not loaded or read.');

    requests.length = 0;
    const redirected = login.connect(account, parent, false).then(candidate => ({ candidate, error: undefined }), error => ({ candidate: undefined, error }));
    const redirectWindow = await remote(); await token(redirectWindow);
    let prevented = false;
    redirectWindow.webContents.emit('will-redirect', { preventDefault: () => { prevented = true; } }, 'https://robertsspaceindustries.com/synthetic-return?token=' + canary, false, true);
    const redirectResult = await bounded(redirected);
    assert.equal(prevented, true); assert.equal(redirectResult.error, undefined);
    assert.equal(redirectResult.candidate?.document.pledges.length, 1); assert.equal(requests.length, 2);
    assert.equal(redirectWindow.isDestroyed(), false);
    await login.close(account); assert.equal(redirectWindow.isDestroyed(), true);
    results.push('Unknown official main-frame redirect is cancelled; existing auth cookie permits only the single fixed hangar handoff.');

    requests.length = 0;
    const pending = login.connect(account, parent, false).then(() => null, error => error);
    const pendingWindow = await remote(); pendingWindow.webContents.getURL = () => 'https://robertsspaceindustries.com/synthetic-return';
    await wait(1800); assert.equal(requests.length, 1); assert.equal(pendingWindow.isDestroyed(), false);
    await login.close(account); assert.match((await bounded(pending))?.message ?? '', /beendet/);
    results.push('Without auth cookies an unapproved in-page return causes no request, preview or repeated login; cancellation remains possible.');

    requests.length = 0;
    const delayed = login.connect(account, parent, false).then(candidate => ({ candidate, error: undefined }), error => ({ candidate: undefined, error }));
    const delayedWindow = await remote(); delayedWindow.webContents.getURL = () => 'https://robertsspaceindustries.com/synthetic-return';
    await wait(1100); assert.equal(requests.length, 1); await token(delayedWindow);
    const delayedResult = await bounded(delayed);
    assert.equal(delayedResult.error, undefined); assert.equal(delayedResult.candidate?.document.pledges.length, 1); assert.equal(requests.length, 2);
    assert.equal(delayedWindow.isDestroyed(), false);
    await login.close(account); assert.equal(delayedWindow.isDestroyed(), true);
    results.push('Delayed auth-cookie arrival completes the pending handoff without another login request or premature unknown-page read.');

    for (const target of ['https://example.invalid/synthetic-return', 'https://robertsspaceindustries.com/api/gift', 'https://robertsspaceindustries.com/store/cart', 'https://robertsspaceindustries.com/connect/mfa']) {
      requests.length = 0;
      const blocked = login.connect(account, parent, false).then(() => null, error => error);
      const blockedWindow = await remote(); await token(blockedWindow);
      blockedWindow.webContents.getURL = () => target;
      assert.match((await bounded(blocked))?.message ?? '', /NAVIGATION_BLOCKED/); assert.equal(requests.length, 1);
      assert.equal(blockedWindow.isDestroyed(), false);
      await login.close(account); assert.equal(blockedWindow.isDestroyed(), true);
    }
    results.push('External, purchase/change and separate MFA routes remain blocked even with a synthetic auth cookie; no hangar or login loop.');

    requests.length = 0;
    const subframe = login.connect(account, parent, false).then(() => null, error => error);
    const subframeWindow = await remote(); await token(subframeWindow);
    let subframePrevented = false;
    subframeWindow.webContents.emit('will-redirect', { preventDefault: () => { subframePrevented = true; } }, 'https://robertsspaceindustries.com/synthetic-return', false, false);
    assert.match((await bounded(subframe))?.message ?? '', /NAVIGATION_BLOCKED/); assert.equal(subframePrevented, true); assert.equal(requests.length, 1);
    assert.equal(subframeWindow.isDestroyed(), false);
    await login.close(account); assert.equal(subframeWindow.isDestroyed(), true);
    results.push('A child-frame redirect cannot trigger a top-level hangar handoff.');

    requests.length = 0; hangarUrl = 'https://robertsspaceindustries.com/synthetic-return';
    const repeated = login.connect(account, parent, false).then(() => null, error => error);
    const repeatedWindow = await remote(); await token(repeatedWindow);
    repeatedWindow.webContents.getURL = () => 'https://robertsspaceindustries.com/synthetic-return';
    assert.match((await bounded(repeated))?.message ?? '', /NAVIGATION_BLOCKED/); assert.equal(requests.length, 2);
    assert.equal(repeatedWindow.isDestroyed(), false);
    await login.close(account); assert.equal(repeatedWindow.isDestroyed(), true);
    hangarUrl = 'https://robertsspaceindustries.com/account/pledges';
    results.push('A second unsupported return after the fixed hangar attempt is diagnosed and stopped instead of causing a request loop.');

    requests.length = 0; hangarBody = '<p>You must be authenticated to reach this area.</p>';
    const denied = login.connect(account, parent, false).then(() => null, error => error);
    const deniedWindow = await remote(); await token(deniedWindow);
    deniedWindow.webContents.getURL = () => 'https://robertsspaceindustries.com/synthetic-return';
    assert.match((await bounded(denied))?.message ?? '', /nicht frei/); assert.equal(requests.length, 2);
    assert.equal(deniedWindow.isDestroyed(), false);
    await login.close(account); assert.equal(deniedWindow.isDestroyed(), true);
    results.push('A cookie alone never proves hangar access: unauthenticated hangar stops after one attempt without submitting or reopening login.');

    requests.length = 0; hangarBody = auth; hangarUrl = 'https://robertsspaceindustries.com/en-US/account/pledges';
    const regional = login.connect(account, parent, false).then(candidate => ({ candidate, error: undefined }), error => ({ candidate: undefined, error }));
    const regionalWindow = await remote(); await token(regionalWindow);
    regionalWindow.webContents.getURL = () => 'https://robertsspaceindustries.com/synthetic-return';
    const regionalResult = await bounded(regional);
    assert.equal(regionalResult.error, undefined); assert.equal(regionalResult.candidate?.document.pledges.length, 1); assert.equal(requests.length, 2);
    assert.equal(regionalWindow.isDestroyed(), false);
    await login.close(account); assert.equal(regionalWindow.isDestroyed(), true);
    results.push('Regional language prefix on the exact official hangar path is accepted without broadening purchase or account-action navigation.');

    const bytes = fs.readFileSync(diagnostics.file, 'utf8'), events = JSON.parse(bytes).events;
    assert.equal(bytes.includes(canary), false); assert.equal(bytes.includes('https://'), false); assert.equal(bytes.includes(account), false);
    assert.ok(events.some((e: { event: string }) => e.event === 'login-return-pending'));
    assert.ok(events.some((e: { event: string }) => e.event === 'hangar-transition'));
    results.push('Fixed transition events survive window close without URLs, auth-cookie values or account IDs.');
  } finally { BrowserWindow.prototype.loadURL = original; await login.shutdown(); parent.destroy(); }
  fs.writeFileSync(path.join(root, 'results.json'), JSON.stringify({ status: 'PASS', data: 'synthetic-only; every loadURL replaced by local files; external network unavailable', results }, null, 2));
  console.log('PASS: ' + results.join('\nPASS: ')); console.log('REPORT: ' + path.join(root, 'results.json')); app.quit();
}).catch(error => {
  fs.writeFileSync(path.join(root, 'results.json'), JSON.stringify({ status: 'FAIL', results, error: error.message }, null, 2));
  console.error(error.message); console.log('REPORT: ' + path.join(root, 'results.json')); app.exit(1);
});
