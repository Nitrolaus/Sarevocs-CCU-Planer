import { app, BrowserWindow, safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { RsiLogin } from '../src/importers/rsi';
import { SessionVault } from '../src/security/session-vault';
const root = path.resolve(process.argv.find(x => x.startsWith('--test-root='))!.slice(12));
fs.mkdirSync(root, { recursive: true });
app.setPath('userData', path.join(root, 'runtime')); app.setPath('sessionData', path.join(root, 'memory')); app.setPath('crashDumps', path.join(root, 'crashes'));
app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND');
app.commandLine.appendSwitch('proxy-server', 'http://127.0.0.1:1');
const localPolicy = '<meta http-equiv="Content-Security-Policy" content="connect-src \'none\'">';
const results: string[] = [];
const consent = `<button id="consent" style="position:absolute;left:20px;top:20px;width:240px;height:50px" onclick="window.clicks++;this.remove()">Use necessary cookies only</button>`;
const auth = `<div class="c-account-sidebar__profile-info-handle">SYNTHETIC_HANDLE</div><ul class="list-items"><li>
<input class="js-pledge-id" value="synthetic-001"><input class="js-pledge-name" value="SYNTHETIC PLEDGE">
<div class="items-col">Synthetic contents</div><div class="date-col">Synthetic date</div>
<div class="item"><span class="title">Demo Ship</span><span class="kind">Ship</span></div><div class="without-images"></div></li></ul>`;
app.whenReady().then(async () => {
  const fixture = path.join(root, 'unauthenticated.html');
  fs.writeFileSync(fixture, `<html>${localPolicy}<body style="margin:0"><script>window.clicks=0;window.actionClicks=0</script>${consent}<input id="entry" style="position:absolute;left:20px;top:100px;width:240px;height:50px"><p style="position:absolute;top:200px">SYNTHETIC TEST ONLY: You must be authenticated to reach this area.</p></body></html>`);
  const original = BrowserWindow.prototype.loadURL;
  let openingUrl = '';
  BrowserWindow.prototype.loadURL = async function(url) {
    openingUrl = url;
    // A local fixture represents the observed unauthenticated /account/pledges page. No network.
    this.webContents.getURL = () => 'https://robertsspaceindustries.com/account/pledges';
    await this.loadFile(fixture);
  };
  const parent = new BrowserWindow({ show: false, webPreferences: { sandbox: true, nodeIntegration: false } });
  const vault = new SessionVault(path.join(root, 'Anmeldung'), safeStorage);
  const login = new RsiLogin(vault, undefined, undefined, (_id, identity) => identity.reference === 'SYNTHETIC_HANDLE');
  const account = randomUUID();
  try {
    await login.open(account, parent, false);
    assert.equal(openingUrl, 'https://robertsspaceindustries.com/en/sign-in');
    const child = BrowserWindow.getAllWindows().find(w => w !== parent)!;
    await new Promise<void>(resolve => child.webContents.once('did-finish-load', () => resolve()));
    async function click(id: string) {
      const point = await child.webContents.executeJavaScript(`(() => {const r=document.getElementById(${JSON.stringify(id)}).getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
      child.focus(); child.webContents.focus();
      child.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
      child.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    await click('consent');
    assert.equal(await child.webContents.executeJavaScript('window.clicks'), 1, 'Cookie-Schaltflaeche muss auf unauthentifizierter Hangaradresse klickbar sein');
    await click('entry');
    child.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'A' }); child.webContents.sendInputEvent({ type: 'char', keyCode: 'a' }); child.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'A' });
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(await child.webContents.executeJavaScript('document.getElementById("entry").value'), 'a');
    results.push('Unauthentifizierte Hangaradresse: Cookie-Klick und native Tastatureingabe funktionieren.');
    await assert.rejects(() => login.probe(account));
    assert.notEqual(login.status(account).state, 'page-ready');
    results.push('Unauthentifizierte Seite wird nicht als lesebereiter Hangar behandelt.');
    await child.webContents.executeJavaScript(`document.body.innerHTML=${JSON.stringify(auth + consent)}; window.clicks=0; true`);
    await assert.rejects(() => login.probe(account), /Cookie/);
    await click('consent'); assert.equal(await child.webContents.executeJavaScript('window.clicks'), 1);
    const candidate = await login.probe(account); assert.equal(candidate.document.pledges.length, 1); assert.equal(candidate.completeness, 'partial');
    results.push('Vorhandener Cookie-Dialog verhindert eine vorzeitige Lesesperre auch bei erkennbarem Konto.');
    await child.webContents.executeJavaScript(`document.body.insertAdjacentHTML('beforeend','<button id="action" style="position:absolute;left:20px;top:250px;width:240px;height:50px" onclick="window.actionClicks++">Synthetic action</button>'); true`);
    await click('action'); assert.equal(await child.webContents.executeJavaScript('window.actionClicks'), 0);
    assert.equal(login.status(account).state, 'page-ready');
    results.push('Erst nach erfolgreicher strukturierter Probe: Eingaben gesperrt und Lesestatus gesetzt.');
    await login.close(account);
    // The automatic flow observes a local page only. All loadURL calls are replaced before use.
    const requests: string[] = [];
    let hangarBody = auth + consent;
    BrowserWindow.prototype.loadURL = async function(url) {
      requests.push(url);
      this.webContents.getURL = () => url;
      const local = path.join(root, 'automatic-' + requests.length + '.html');
      fs.writeFileSync(local, `${localPolicy}<script>window.clicks=0</script>${url.endsWith('/account/pledges') ? hangarBody : '<input type="password"><p>SYNTHETIC LOGIN ONLY</p>'}`);
      await this.loadFile(local);
    };
    async function remoteWindow() {
      for (let i = 0; i < 100; i++) {
        const w = BrowserWindow.getAllWindows().find(w => w !== parent);
        if (w && !w.webContents.isLoadingMainFrame() && w.webContents.getURL().startsWith('https://')) return w;
        await new Promise(r => setTimeout(r, 20));
      }
      throw new Error('Synthetic RSI window missing');
    }
    const automatic = login.connect(account, parent, false);
    const remote = await remoteWindow();
    await assert.rejects(() => login.connect(account, parent, false), /bereits/);
    await new Promise(r => setTimeout(r, 1600));
    assert.equal(requests.length, 1, 'No repeated HTTP navigation while login waits');
    remote.webContents.getURL = () => 'https://robertsspaceindustries.com/';
    for (let i = 0; i < 100 && !requests.some(u => u.endsWith('/account/pledges')); i++) await new Promise(r => setTimeout(r, 20));
    while (remote.webContents.isLoadingMainFrame()) await new Promise(r => setTimeout(r, 20));
    await new Promise(r => setTimeout(r, 900));
    assert.notEqual(login.status(account).state, 'page-ready', 'Consent must prevent premature auto success');
    await remote.webContents.executeJavaScript('document.getElementById("consent").click(); true');
    const automaticCandidate = await automatic;
    assert.equal(automaticCandidate.document.pledges.length, 1);
    assert.equal(automaticCandidate.completeness, 'partial'); assert.equal(remote.isDestroyed(), false);
    assert.deepEqual(requests, ['https://robertsspaceindustries.com/en/sign-in', 'https://robertsspaceindustries.com/account/pledges']);
    await login.close(account); assert.equal(remote.isDestroyed(), true);
    results.push('Automatisch: nach Login-Rueckkehr einmal Hangar laden, Cookie-Auswahl abwarten und Teilvorschau liefern; RSI-Fenster bleibt bis zum ausdruecklichen Schliessen offen.');
    results.push('Wartende Anmeldung sendet keine wiederholten Requests; zweiter paralleler Start abgewiesen.');
    requests.length = 0;
    const cancelled = login.connect(account, parent, false).then(() => null, e => e);
    await remoteWindow(); await login.close(account);
    assert.match((await cancelled)?.message ?? '', /beendet/); assert.equal(requests.length, 1);
    results.push('Abbruch beendet die automatische Beobachtung ohne erneutes Oeffnen.');
    requests.length = 0; hangarBody = '<p>You must be authenticated to reach this area.</p>';
    const denied = login.connect(account, parent, false).then(() => null, e => e);
    const deniedWindow = await remoteWindow(); deniedWindow.webContents.getURL = () => 'https://robertsspaceindustries.com/';
    assert.match((await denied)?.message ?? '', /nicht frei/); assert.equal(requests.length, 2);
    assert.equal(deniedWindow.isDestroyed(), false);
    await login.close(account); assert.equal(deniedWindow.isDestroyed(), true);
    results.push('Restricted Area nach Login fuehrt zum Stopp ohne Anmelde- oder Navigationsschleife.');
    requests.length = 0; hangarBody = auth;
    await vault.save(account, [{ name: 'Rsi-Token', value: 'SYNTHETIC_TEST_ONLY', domain: 'robertsspaceindustries.com', path: '/', secure: true,
      httpOnly: true, hostOnly: true, session: false, expirationDate: Date.now() / 1000 + 3600, sameSite: 'lax' }]);
    const restoredCandidate = await login.connect(account, parent, true);
    assert.equal(restoredCandidate.document.pledges.length, 1);
    assert.deepEqual(requests, ['https://robertsspaceindustries.com/account/pledges']);
    const restoredWindow = await remoteWindow(); assert.equal(restoredWindow.isDestroyed(), false);
    await login.close(account); assert.equal(restoredWindow.isDestroyed(), true);
    assert.equal((await vault.load(account)).length, 1);
    results.push('Windows-verschluesselte kuenstliche Sitzung direkt wiederhergestellt; nur ein Hangaraufruf, abschliessender Snapshot erhalten.');
    // A delayed synthetic vault makes the close/quit overlap deterministic, without real secrets.
    let releaseSave!: () => void, saveEntered!: () => void;
    const saveGate = new Promise<void>(resolve => { releaseSave = resolve; });
    const saving = new Promise<void>(resolve => { saveEntered = resolve; });
    let saveFinished = false, shutdownFinished = false, repeatedCloseFinished = false, saveCount = 0;
    const slowVault = { load: async () => vault.load(account), save: async () => { saveCount++; saveEntered(); await saveGate; saveFinished = true; return true; } } as unknown as SessionVault;
    const racingLogin = new RsiLogin(slowVault, undefined, undefined, (_id, identity) => identity.reference === 'SYNTHETIC_HANDLE');
    const raceAccount = randomUUID();
    await racingLogin.connect(raceAccount, parent, true);
    const firstClose = racingLogin.close(raceAccount);
    await saving;
    const repeatedClose = racingLogin.close(raceAccount).then(() => { repeatedCloseFinished = true; });
    const shutdown = racingLogin.shutdown().then(ok => { shutdownFinished = true; return ok; });
    try {
      await new Promise(r => setTimeout(r, 50));
      assert.equal(shutdownFinished, false, 'Shutdown must wait for an already-running encrypted session save');
      assert.equal(repeatedCloseFinished, false, 'A repeated close must await the existing close operation');
      assert.equal(saveFinished, false);
    } finally { releaseSave(); await Promise.all([firstClose, repeatedClose, shutdown]); await racingLogin.shutdown(); }
    assert.equal(saveFinished, true); assert.equal(saveCount, 1);
    results.push('Schliessen/Programmende gleichzeitig: beide warten auf denselben abgeschlossenen Sitzungssnapshot.');
  } finally { BrowserWindow.prototype.loadURL = original; await login.shutdown(); parent.destroy(); }
  fs.writeFileSync(path.join(root, 'results.json'), JSON.stringify({ status: 'PASS', data: 'synthetic-only', results }, null, 2));
  console.log('PASS: ' + results.join('\nPASS: ')); console.log('REPORT: ' + path.join(root, 'results.json')); app.quit();
}).catch(error => {
  fs.writeFileSync(path.join(root, 'results.json'), JSON.stringify({ status: 'FAIL', results, error: error.message }, null, 2));
  console.error(error.message); app.exit(1);
});
