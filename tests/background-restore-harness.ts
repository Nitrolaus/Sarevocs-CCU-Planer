import { app, BrowserWindow, safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { BackgroundRestoreError, RsiLogin, RSI_CONNECTION_PROBE } from '../src/importers/rsi';
import { RSI_HANDLE_PROBE, RSI_PAGE_PROBE } from '../src/importers/rsi-page';
import { SessionVault, type StoredCookie } from '../src/security/session-vault';

const root = path.resolve(process.argv.find(x => x.startsWith('--test-root='))!.slice(12));
const data = path.resolve(process.argv.find(x => x.startsWith('--data-dir='))!.slice(11));
fs.mkdirSync(data, { recursive: true });
app.setPath('userData', path.join(data, 'runtime')); app.setPath('sessionData', path.join(data, 'session')); app.setPath('crashDumps', path.join(data, 'crashes'));
app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND'); app.commandLine.appendSwitch('proxy-server', 'http://127.0.0.1:1');
const native = { created: [] as { show: boolean; win: BrowserWindow; painted: boolean }[], actions: [] as { id: number; action: string }[] };
(globalThis as unknown as { ccuRestoreNative: typeof native }).ccuRestoreNative = native;
const hangar = 'https://robertsspaceindustries.com/account/pledges', loginUrl = 'https://robertsspaceindustries.com/en/sign-in';
const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const cookie = (value = 'SYNTHETIC_AUTH_ONLY'): StoredCookie => ({ name: 'Rsi-Token', value, domain: 'robertsspaceindustries.com', path: '/', secure: true, httpOnly: true, hostOnly: true, session: false, expirationDate: Date.now() / 1000 + 3600, sameSite: 'lax' });
const ready = `<ul class="list-items"><li><input class="js-pledge-id" value="synthetic-ccu"><input class="js-pledge-name" value="SYNTHETIC CCU"><input class="js-upgrade-data" value='{&quot;match_items&quot;:[{&quot;name&quot;:&quot;SYNTHETIC FROM&quot;}],&quot;target_items&quot;:[{&quot;name&quot;:&quot;SYNTHETIC TO&quot;}]}'><div class="items-col">SYNTHETIC ONLY</div></li></ul>`;
type Scenario = 'ready' | 'redirect' | 'login' | 'consent' | 'challenge' | 'missing-handle' | 'different-handle' | 'rotation-during-probe' | 'duplicate-delayed-handle' | 'async-delayed-handle'
  | 'delayed-handle' | 'conflicting-delayed-handles' | 'delayed-handle-after-navigation';
let scenario: Scenario = 'ready', phase = 'INIT', rotate = false;
const requests: string[] = [], readFlags: boolean[] = [], saves: StoredCookie[][] = [], values: RsiLogin[] = [], results: string[] = [];
let loadGate: { entered: boolean; release: () => void; promise: Promise<void> } | undefined;
let loginPageGate: ReturnType<typeof gate> | undefined;
let failLoginPage = false;
let signInInterruptsHangar = false;
let cookieReadGate: ReturnType<typeof gate> | undefined, probeFinished = false;
let waitingForHandle = false;
function gate() { let release = () => {}; const promise = new Promise<void>(resolve => { release = resolve; }); return { entered: false, release, promise }; }
async function until(test: () => boolean | Promise<boolean>, code: string) { for (let i = 0; i < 300; i++) { if (await test()) return; await wait(20); } throw new Error(code); }
function fakeVault(cookies: StoredCookie[] = [cookie()]): SessionVault {
  return { load: async (_id: string, migration = true) => { readFlags.push(migration); if (loadGate) { loadGate.entered = true; await loadGate.promise; } return cookies; },
    save: async (_id: string, incoming: StoredCookie[]) => { saves.push(incoming); return true; } } as unknown as SessionVault;
}
function value(vault = fakeVault()) { const result = new RsiLogin(vault, undefined, undefined, (_id, identity) => identity.reference === 'SYNTHETIC_OWNER'); values.push(result); return result; }
function outcome<T>(task: Promise<T>) { return task.then(result => ({ result, error: undefined }), error => ({ result: undefined, error })); }
function failure(error: unknown, code: string) { assert.ok(error instanceof BackgroundRestoreError); assert.equal(error.code, code); }
function noPresentation() { assert.equal(native.created.every(x => x.show === false && (x.win.isDestroyed() || !x.win.isVisible())), true); assert.equal(native.actions.some(x => ['show', 'focus', 'restore'].includes(x.action)), false); }
async function check(name: string, run: () => Promise<void>) {
  phase = name; scenario = 'ready'; rotate = false; waitingForHandle = false; native.created.length = 0; native.actions.length = 0; requests.length = 0; readFlags.length = 0; saves.length = 0;
  await run(); results.push(name); console.log('PASS: ' + name);
}

app.whenReady().then(async () => {
  const parent = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  const originalLoad = BrowserWindow.prototype.loadURL;
  BrowserWindow.prototype.loadURL = async function(url) {
    assert.ok(url === hangar || url === loginUrl); requests.push(url);
    if (url === hangar && signInInterruptsHangar) {
      signInInterruptsHangar = false;
      this.webContents.emit('did-start-navigation', { url: loginUrl, isMainFrame: true }, loginUrl, false, true);
      this.webContents.getURL = () => loginUrl;
      this.webContents.emit('did-navigate', {}, loginUrl);
      this.webContents.emit('did-finish-load');
      throw Object.assign(new Error('Synthetic navigation aborted'), { code: 'ERR_ABORTED' });
    }
    this.webContents.getURL = () => 'about:blank';
    if (url === loginUrl && loginPageGate) {
      loginPageGate.entered = true;
      await loginPageGate.promise;
      if (this.isDestroyed()) return;
    }
    if (url === loginUrl && failLoginPage) {
      this.webContents.emit('did-fail-load', {}, -105, 'SYNTHETIC', url, true);
      return;
    }
    let body = url === loginUrl || scenario === 'login' ? '<input type="password">' : scenario === 'consent' ? '<button>Use necessary cookies only</button>' + ready : scenario === 'challenge' ? '<p>SYNTHETIC CHALLENGE</p>' : ready;
    if (scenario !== 'missing-handle' && !scenario.includes('delayed-handle')) body = '<span class="c-account-sidebar__profile-info-handle">' + (scenario === 'different-handle' ? 'SYNTHETIC_OTHER' : 'SYNTHETIC_OWNER') + '</span>' + body;
    const protocol = this.webContents.session.protocol;
    if (protocol.isProtocolHandled('https')) protocol.unhandle('https');
    protocol.handle('https', request => request.url === url
      ? new Response('<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'">' + body,
        {headers:{'content-type':'text/html; charset=utf-8'}})
      : new Response(null, {status:404}));
    await originalLoad.call(this, url);
    const rotateCookie = () => this.webContents.session.cookies.set({ url: 'https://robertsspaceindustries.com/', name: 'Rsi-Token', value: 'SYNTHETIC_ROTATED_ONLY', secure: true, httpOnly: true });
    if (rotate) await rotateCookie();
    if (scenario.includes('delayed-handle') && url === hangar) {
      const execute = this.webContents.executeJavaScriptInIsolatedWorld.bind(this.webContents);
      let handleRequested = false;
      this.webContents.executeJavaScriptInIsolatedWorld = async (world, scripts) => {
        if (scripts[0]?.code === RSI_HANDLE_PROBE) {
          const handles = scenario === 'conflicting-delayed-handles' ? ['SYNTHETIC_OWNER', 'SYNTHETIC_OTHER'] : scenario === 'duplicate-delayed-handle' ? ['SYNTHETIC_OWNER', 'SYNTHETIC_OWNER'] : ['SYNTHETIC_OWNER'];
          const markup = handles.map(handle => '<span class="c-account-sidebar__profile-info-handle">' + handle + '</span>').join('');
          if(scenario === 'async-delayed-handle'){
            if(!handleRequested){handleRequested=true;waitingForHandle=true;setTimeout(()=>{if(!this.isDestroyed())void this.webContents.executeJavaScript('document.body.insertAdjacentHTML("afterbegin", '+JSON.stringify(markup)+')').catch(()=>{});},350);}
          }else await this.webContents.executeJavaScript('document.body.insertAdjacentHTML("afterbegin", ' + JSON.stringify(markup) + ')');
          if (scenario === 'delayed-handle-after-navigation') this.webContents.emit('did-start-navigation', {
            url: hangar, isMainFrame: true, isSameDocument: false,
          });
        }
        return execute(world, scripts);
      };
    }
    if (scenario === 'rotation-during-probe' || phase === 'PURCHASE_EVIDENCE_REQUIRES_STABLE_AUTH') {
      const execute = this.webContents.executeJavaScript.bind(this.webContents);
      this.webContents.executeJavaScript = async script => {
        const result = await execute(script);
        if (script === RSI_PAGE_PROBE) await rotateCookie();
        return result;
      };
    }
    this.webContents.getURL = () => url;
    this.webContents.emit('did-finish-load');
    if (phase === 'CANCEL_DURING_LAST_COOKIE_AWAIT_NEVER_RETURNS_CANDIDATE') {
      const get = this.webContents.session.cookies.get.bind(this.webContents.session.cookies);
      this.webContents.session.cookies.get = async filter => {
        const held = cookieReadGate;
        if (held && probeFinished && !held.entered) { held.entered = true; await held.promise; }
        return get(filter);
      };
    }
    if (phase === 'HIDDEN_SUCCESS_ROTATES_ENCRYPTED_CAPSULE') {
      const preferences = (this.webContents as unknown as { getLastWebPreferences(): { disableDialogs: boolean } }).getLastWebPreferences();
      assert.equal(preferences.disableDialogs, true);
      assert.equal(await this.webContents.executeJavaScript('alert("SYNTHETIC DISABLED DIALOG"); true'), true);
    }
    if (phase === 'HARD_TIMER_CLOSES_BACKGROUND_WINDOW') {
      const execute = this.webContents.executeJavaScript.bind(this.webContents);
      this.webContents.executeJavaScript = script => execute(script === RSI_CONNECTION_PROBE ? 'new Promise(() => {})' : script);
    }
    if (scenario === 'redirect') {
      let prevented = false;
      this.webContents.emit('will-redirect', { preventDefault() { prevented = true; } }, 'https://robertsspaceindustries.com/sign-in', false, true);
      assert.equal(prevented, true);
    }
  };
  let encryption = safeStorage;
  try {
    await check('NO_AUTH_CAPSULE_NO_WINDOW', async () => {
      for (const cookies of [[], [{ ...cookie(), expirationDate: 1 }], [{ ...cookie(), name: 'Consent' }]]) assert.equal(await value(fakeVault(cookies)).resume(randomUUID(), parent), null);
      assert.deepEqual(readFlags, [false, false, false]); assert.equal(native.created.length, 0); assert.equal(saves.length, 0);
    });
    const vaultDirectory = path.join(data, 'synthetic-vault');
    const migrating = { isAsyncEncryptionAvailable: () => encryption.isAsyncEncryptionAvailable(), encryptStringAsync: (plain: string) => encryption.encryptStringAsync(plain),
      decryptStringAsync: async (encrypted: Buffer) => ({ ...await encryption.decryptStringAsync(encrypted), shouldReEncrypt: true }) };
    const vault = new SessionVault(vaultDirectory, migrating, path.join(data, 'synthetic-key'));
    const savedId = randomUUID(); await vault.save(savedId, [cookie()]);
    const capsule = path.join(vaultDirectory, savedId + '.session.enc');
    await check('HIDDEN_SUCCESS_ROTATES_ENCRYPTED_CAPSULE', async () => {
      rotate = true;
      const login = value(vault), task = login.resume(savedId, parent);
      assert.equal(login.resume(savedId, parent), task);
      const candidate = await task;
      assert.ok(candidate); assert.equal(candidate.adapter, 'rsi-dom-probe/1'); assert.equal(candidate.document.account.identityKind, 'rsi-handle'); assert.equal(candidate.document.pledges[0]!.ccus.length, 1);
      assert.equal(candidate.document.pledges[0]!.ccus[0]!.status, 'unverified'); assert.equal((await vault.load(savedId, false))[0]!.value, 'SYNTHETIC_ROTATED_ONLY');
      assert.equal(fs.readFileSync(capsule).includes(Buffer.from('SYNTHETIC_ROTATED_ONLY')), false);
      noPresentation(); assert.equal(native.created.length, 1); assert.equal(native.created[0]!.win.isDestroyed(), true); assert.deepEqual(requests, [hangar]);
    });
    await check('UNBOUND_HANDLE_OR_UNSTABLE_AUTH_NEVER_SAVES', async () => {
      for (const next of ['missing-handle', 'different-handle', 'rotation-during-probe'] as const) {
        scenario = next;
        const candidate = await value().resume(randomUUID(), parent);
        assert.ok(candidate);
        assert.equal(candidate.document.account.identityKind, next === 'missing-handle' ? 'manual-reference' : 'rsi-handle');
        assert.equal(saves.length, 0);
      }
      noPresentation();
    });
    for (const stable of [true, false]) {
      await check(stable ? 'MISSING_HANDLE_ALLOWS_ORDER_CONFIRMATION_WITHOUT_BINDING' : 'PURCHASE_EVIDENCE_REQUIRES_STABLE_AUTH', async () => {
        scenario = 'missing-handle';
        let called = 0;
        const observations: string[] = [];
        const login = new RsiLogin(fakeVault(), {record:event=>{if(event.observation)observations.push(event.observation);return true;}},
          undefined, () => false, undefined, async (_session, pledges, owner) => {
            called++;
            assert.equal(owner, null);
            return new Map([[pledges[0]!.pledgeId, {status:'documented',source:'order',minor:6732,currency:'EUR'}]]);
          });
        values.push(login);
        const candidate = await login.resume(randomUUID(), parent);
        assert.equal(called, 1);
        assert.equal(candidate?.document.account.identityKind, 'manual-reference');
        assert.equal(candidate?.document.pledges[0]?.rsiPurchase?.status, stable ? 'documented' : undefined);
        assert.equal(!!candidate && !!login.purchaseSessionFor(candidate), stable);
        assert.equal(login.purchaseSessionFor(structuredClone(candidate!)), undefined);
        assert.ok(observations.includes(stable ? 'purchase-matched' : 'purchase-auth-changed'));
        assert.equal(saves.length, 0);
        noPresentation();
      });
    }
    await check('REJECTED_REDIRECT_PRESERVES_MIGRATING_CAPSULE', async () => {
      scenario = 'redirect'; rotate = true;
      const before = fs.readFileSync(capsule), result = await outcome(value(vault).resume(savedId, parent));
      failure(result.error, 'auth-required'); assert.deepEqual(fs.readFileSync(capsule), before); noPresentation(); assert.deepEqual(requests, [hangar]);
    });
    await check('LOGIN_AND_CONSENT_NEVER_OPEN_AUTH', async () => {
      for (const next of ['login', 'consent'] as const) { scenario = next; failure((await outcome(value().resume(randomUUID(), parent))).error, 'auth-required'); }
      noPresentation(); assert.equal(saves.length, 0); assert.equal(requests.every(x => x === hangar), true);
    });
    await check('READY_LARGE_HANGAR_READ_HAS_NO_SESSION_CHECK_DEADLINE',async()=>{
      const login=value(),original=login.probe.bind(login),now=Date.now;let entered=false;
      login.probe=async id=>{entered=true;Date.now=()=>now()+120000;return original(id);};
      try{const candidate=await login.resume(randomUUID(),parent);assert.ok(candidate);assert.equal(entered,true);assert.equal(candidate.document.pledges.length,1);}finally{Date.now=now;}
      noPresentation();
    });
    await check('CHALLENGE_HAS_BACKGROUND_DEADLINE', async () => {
      scenario = 'challenge'; const login = value(), now = Date.now;
      const task = outcome(login.resume(randomUUID(), parent));
      await until(() => requests.length === 1 && native.created[0]?.win.webContents.getURL() === hangar, 'CHALLENGE_NOT_LOADED');
      try { Date.now = () => now() + 61000; failure((await task).error, 'unavailable'); } finally { Date.now = now; }
      noPresentation(); assert.equal(saves.length, 0);
    });
    await check('HARD_TIMER_CLOSES_BACKGROUND_WINDOW', async () => {
      scenario = 'challenge'; const timeout = globalThis.setTimeout;
      try {
        globalThis.setTimeout = ((callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => timeout(callback, delay === 60000 ? 300 : delay, ...args)) as typeof setTimeout;
        failure((await outcome(value().resume(randomUUID(), parent))).error, 'unavailable');
      } finally { globalThis.setTimeout = timeout; }
      noPresentation(); assert.equal(native.created[0]!.win.isDestroyed(), true); assert.equal(saves.length, 0);
    });
    await check('INTERACTIVE_CANCELS_AND_AWAITS_RESTORE', async () => {
      const login = value(), id = randomUUID(); loadGate = gate();
      const restore = outcome(login.resume(id, parent)); await until(() => !!loadGate?.entered, 'RESTORE_GATE_MISSING');
      const interactive = login.open(id, parent, false); await wait(100); assert.equal(native.created.length, 0);
      loadGate.release(); await interactive; failure((await restore).error, 'cancelled'); loadGate = undefined;
      assert.equal(native.created.length, 1); assert.equal(native.created[0]!.show, false); assert.deepEqual(requests, [loginUrl]);
      await until(() => native.created[0]!.win.isVisible(), 'INTERACTIVE_LOGIN_NOT_REVEALED_AFTER_RESTORE');
      await login.close(id);
    });
    await check('SHUTDOWN_PREVENTS_LATE_WINDOWS_AND_RESULTS', async () => {
      const login = value(), id = randomUUID(); loadGate = gate();
      const restore = outcome(login.resume(id, parent)); await until(() => !!loadGate?.entered, 'SHUTDOWN_GATE_MISSING');
      let finished = false; const shutdown = login.shutdown().then(ok => { finished = true; return ok; }); await wait(100); assert.equal(finished, false);
      loadGate.release(); assert.equal(await shutdown, true); loadGate = undefined; failure((await restore).error, 'cancelled');
      failure((await outcome(login.resume(id, parent))).error, 'cancelled'); assert.equal(native.created.length, 0);
    });
    await check('SIGNAL_CANCEL_BEFORE_ATTEMPT_NEVER_OPENS_LATE_WINDOW', async () => {
      const stopped = new AbortController(); stopped.abort();
      const beforeReads = readFlags.length;
      const rejected = await outcome(value().connect(randomUUID(), parent, true, { hideHangar: true, signal: stopped.signal }));
      assert.match(rejected.error?.message ?? '', /Verbindung beendet/); assert.equal(readFlags.length, beforeReads);
      const login = value(), id = randomUUID(), controller = new AbortController(); loadGate = gate();
      const restore = outcome(login.resume(id, parent)); await until(() => !!loadGate?.entered, 'AUTH_CANCEL_RESTORE_GATE_MISSING');
      let finished = false;
      const authorizing = outcome(login.connect(id, parent, true, { hideHangar: true, signal: controller.signal })).then(result => { finished = true; return result; });
      controller.abort(); await wait(100);
      assert.equal(native.created.length, 0); assert.equal(finished, false, 'Authorization must await cancellation cleanup of the held restore');
      loadGate.release(); failure((await restore).error, 'cancelled');
      const result = await authorizing; assert.equal(result.result, undefined); assert.match(result.error?.message ?? '', /Verbindung beendet/);
      loadGate = undefined; assert.equal(native.created.length, 0); assert.deepEqual(requests, []);
    });
    await check('CANCEL_DURING_LAST_COOKIE_AWAIT_NEVER_RETURNS_CANDIDATE', async () => {
      for (const withSignal of [true, false]) {
        const login = value(), id = randomUUID(), controller = new AbortController(); cookieReadGate = gate();
        probeFinished = false;
        const probe = login.probe.bind(login);
        login.probe = async id => { const candidate = await probe(id); probeFinished = true; return candidate; };
        const task = outcome(login.connect(id, parent, true, { hideHangar: true, ...(withSignal ? { signal: controller.signal } : {}) }));
        await until(() => !!cookieReadGate?.entered, 'LAST_COOKIE_GATE_MISSING');
        assert.equal(login.status(id).state, 'page-ready', 'The actual structured probe must finish before the held final cookie read');
        let closing: ReturnType<RsiLogin['close']> | undefined;
        if (withSignal) controller.abort(); else closing = login.close(id);
        cookieReadGate.release();
        const result = await task; await closing;
        assert.equal(result.result, undefined); assert.match(result.error?.message ?? '', /Verbindung beendet/);
        assert.equal(native.created.at(-1)!.win.isDestroyed(), true);
        assert.equal(saves.length, 0, 'A cancelled connection must not save an unaccepted session');
        cookieReadGate = undefined;
      }
      noPresentation();
    });
    await check('AUTHORIZE_SAVED_HANGAR_STAYS_HIDDEN_AND_REUSE', async () => {
      const login = value(), id = randomUUID(); await login.connect(id, parent, true, { hideHangar: true });
      noPresentation(); assert.equal(native.created[0]!.show, false);
      native.actions.length = 0; await login.connect(id, parent, true, { hideHangar: true });
      assert.equal(native.created.length, 1); noPresentation(); assert.equal(await login.close(id), 'saved');
    });
    for(const layout of ['delayed-handle','duplicate-delayed-handle','async-delayed-handle'] as const) await check(layout==='delayed-handle'?'DELAYED_HANDLE_SAVES_NEW_SESSION_AND_RESTORES_WITHOUT_SIGN_IN':layout==='duplicate-delayed-handle'?'DUPLICATE_DELAYED_HANDLE_SAVES_NEW_SESSION_AND_RESTORES_WITHOUT_SIGN_IN':'ASYNC_HANDLE_SAVES_NEW_SESSION_AND_RESTORES_WITHOUT_SIGN_IN', async () => {
      scenario = layout;
      const login = value(vault), id = randomUUID();
      const task = outcome(login.connect(id, parent, true, { hideHangar: true }));
      try {
        await until(() => native.created[0]?.win.webContents.getURL() === loginUrl, 'LOGIN_FIXTURE_MISSING');
        const { win } = native.created[0]!;
        await win.webContents.session.cookies.set({
          url: loginUrl, name: cookie().name, value: cookie().value, secure: true, httpOnly: true, path: '/',
        });
        win.webContents.getURL = () => 'https://robertsspaceindustries.com/';
        const { result, error } = await task;
        assert.equal(error, undefined);
        assert.deepEqual(result?.document.account, { identityKind:'rsi-handle', reference:'SYNTHETIC_OWNER' });
        assert.equal(await login.close(id), 'saved');
        assert.equal((await vault.load(id, false))[0]?.value, cookie().value);
        scenario = 'ready'; requests.length = 0;
        assert.equal((await value(vault).resume(id, parent))?.document.account.reference, 'SYNTHETIC_OWNER');
        assert.deepEqual(requests, [hangar]);
      } finally { await login.close(id); await task; }
    });
    await check('CANCEL_WHILE_WAITING_FOR_LATE_HANDLE_NEVER_SAVES', async () => {
      scenario='async-delayed-handle';const login=value(),id=randomUUID(),controller=new AbortController();
      const task=outcome(login.connect(id,parent,true,{hideHangar:true,signal:controller.signal}));
      await until(()=>waitingForHandle,'DELAYED_HANDLE_WAIT_NOT_REACHED');controller.abort();
      const result=await task;assert.equal(result.result,undefined);assert.match(result.error?.message??'',/Verbindung beendet/);
      assert.equal(saves.length,0);assert.ok(native.created.every(row=>row.win.isDestroyed()));
    });
    await check('AMBIGUOUS_IDENTITY_OR_AUTH_CHANGE_RETURNS_REASON_AND_NEVER_SAVES', async () => {
      for (const [fixture, expected] of [
        ['missing-handle', 'missing-handle'], ['conflicting-delayed-handles', 'missing-handle'],
        ['different-handle', 'profile-mismatch'], ['rotation-during-probe', 'auth-changed'],
      ] as const) {
        scenario = fixture;
        const login = value(), id = randomUUID();
        assert.ok(await login.connect(id, parent, true, { hideHangar: true }));
        assert.equal(await login.close(id), expected);
      }
      scenario = 'delayed-handle-after-navigation';
      const login = value(), id = randomUUID();
      const { error } = await outcome(login.connect(id, parent, true, { hideHangar: true }));
      assert.match(error?.message ?? '', /Seite während der Prüfung gewechselt/);
      await login.close(id);
      assert.equal(saves.length, 0);
      noPresentation();
    });
    await check('AUTHORIZE_LOGIN_VISIBLE_INTENT_HANGAR_HIDDEN', async () => {
      const login = value(fakeVault([])), id = randomUUID();
      loginPageGate = gate();
      const task = outcome(login.connect(id, parent, false, { hideHangar: true }));
      try {
        await until(() => !!loginPageGate?.entered, 'LOCAL_LOGIN_NOT_STARTED');
        const first = native.created[0]!;
        const { win, show } = first;
        assert.equal(show, false, 'The constructor must not display the empty window');
        assert.equal(win.webContents.getURL(), 'about:blank');
        assert.equal(win.getBackgroundColor().toLowerCase(), '#111820');
        assert.equal(win.isVisible(), false);
        assert.equal(native.actions.some(x => x.action === 'show' || x.action === 'focus'), false);
        loginPageGate.release();
        await until(() => first.painted && win.isVisible() && win.webContents.getURL() === loginUrl, 'INTERACTIVE_LOGIN_MISSING');
        win.webContents.emit('did-finish-load');
        assert.deepEqual(native.actions.filter(x => x.action === 'show' || x.action === 'focus').map(x => x.action), ['show']);
        win.webContents.getURL = () => 'https://robertsspaceindustries.com/';
        await wait(1700);
        assert.deepEqual(requests, [loginUrl], 'A public RSI route must not start a Hangar request before authentication');
        assert.equal(win.isVisible(), true);

        const confirmationUrl = loginUrl + '/send-confirmation-code';
        let cancelled = false;
        win.webContents.emit('will-redirect', { preventDefault: () => { cancelled = true; } }, 'https://robertsspaceindustries.com/synthetic-return', false, true);
        assert.equal(cancelled, true);
        win.webContents.getURL = () => confirmationUrl;
        win.webContents.emit('did-navigate-in-page', {}, confirmationUrl, true);
        const { name, value: token } = cookie();
        await win.webContents.session.cookies.set({ url: loginUrl, name, value: token, secure: true, httpOnly: true, path: '/' });
        await wait(900);
        assert.deepEqual(requests, [loginUrl], 'An auth cookie must not interrupt the official confirmation page');
        win.webContents.getURL = () => 'https://robertsspaceindustries.com/';
        assert.equal((await task).error, undefined);
        assert.deepEqual(requests, [loginUrl, hangar]);
        assert.ok(native.actions.some(x => x.action === 'hide'));
      } finally {
        loginPageGate.release(); loginPageGate = undefined;
        await login.close(id); await task;
      }
    });
    await check('RSI_CAN_RETAKE_SIGN_IN_AFTER_ABORTED_HANGAR_LOAD', async () => {
      const login = value(fakeVault([])), id = randomUUID();
      const task = outcome(login.connect(id, parent, false, { hideHangar: true }));
      try {
        await until(() => native.created[0]?.win.webContents.getURL() === loginUrl, 'LOGIN_FIXTURE_MISSING');
        const { win } = native.created[0]!;
        const setAuth = async (value: string) => win.webContents.session.cookies.set({
          url: loginUrl, name: cookie().name, value, secure: true, httpOnly: true, path: '/',
        });
        await setAuth('SYNTHETIC_BEFORE_CONFIRMATION');
        signInInterruptsHangar = true;
        win.webContents.getURL = () => 'https://robertsspaceindustries.com/';
        await until(() => requests.length === 2 && win.isVisible(), 'RSI_SIGN_IN_DID_NOT_RETAKE_WINDOW');
        win.webContents.getURL = () => 'https://robertsspaceindustries.com/';
        await wait(950);
        assert.deepEqual(requests, [loginUrl, hangar], 'A stale cookie must not restart the failed Hangar handoff');
        await setAuth('SYNTHETIC_AFTER_CONFIRMATION');
        await until(() => requests.length === 3, 'VALID_NEW_HANDOFF_MISSING');
        assert.equal((await task).result?.document.pledges.length, 1);
        assert.equal(win.isVisible(), false);
      } finally { await login.close(id); await task; }
    });
    await check('INTERACTIVE_CONSENT_REVEALS_ONLY_WHEN_ACTION_NEEDED', async () => {
      scenario = 'consent';
      const login = value(), id = randomUUID();
      const task = outcome(login.connect(id, parent, true, { hideHangar: true }));
      try {
        await until(() => native.created[0]?.win.isVisible() === true, 'CONSENT_WINDOW_NOT_REVEALED');
        const { win } = native.created[0]!;
        assert.deepEqual(requests, [hangar]);
        scenario = 'ready';
        await win.loadURL(hangar);
        assert.equal((await task).result?.document.pledges.length, 1);
        assert.equal(win.isVisible(), false);
      } finally { await login.close(id); await task; }
    });
    await check('AUTHORIZE_REJECTED_SAVED_SESSION_REVEALS_ONLY_LOGIN', async () => {
      scenario = 'login'; const login = value(), id = randomUUID(); const task = login.connect(id, parent, true, { hideHangar: true });
      await until(() => native.created.length === 1 && native.created[0]!.win.webContents.getURL() === loginUrl && native.actions.some(x => x.action === 'show'), 'EXPLICIT_AUTH_LOGIN_NOT_REVEALED');
      assert.equal(native.created[0]!.show, false); assert.deepEqual(requests, [hangar, loginUrl]);
      assert.deepEqual(native.actions.filter(x => x.action === 'show' || x.action === 'focus').map(x => x.action), ['show']);
      scenario = 'ready'; native.created[0]!.win.webContents.getURL = () => 'https://robertsspaceindustries.com/';
      const result = await task; assert.equal(result.document.pledges.length, 1); assert.deepEqual(requests, [hangar, loginUrl, hangar]);
      assert.equal(native.actions.some(x => x.action === 'hide'), true); await login.close(id);
    });
    await check('FAILED_FIRST_LOGIN_REMAINS_VISIBLE_TO_MANUAL_CALLER', async () => {
      const login = value(fakeVault([])), id = randomUUID();
      failLoginPage = true;
      try {
        await login.open(id, parent, false);
        assert.equal(login.status(id).state, 'error');
        assert.ok(login.status(id).message.includes('ERR_NAME_NOT_RESOLVED'));
        assert.equal(native.created[0]!.show, false);
        assert.equal(native.created[0]!.win.isVisible(), true);
        assert.deepEqual(native.actions.filter(x => x.action === 'show' || x.action === 'focus').map(x => x.action), ['show']);
      } finally { failLoginPage = false; await login.close(id); }
    });
    fs.writeFileSync(path.join(root, 'results.json'), JSON.stringify({ status: 'PASS', data: 'synthetic-only', results }, null, 2));
  } catch (error) {
    fs.writeFileSync(path.join(root, 'results.json'), JSON.stringify({ status: 'FAIL', data: 'synthetic-only', phase, results, error: error instanceof Error ? error.message : 'BACKGROUND_TEST_FAILED' }, null, 2)); process.exitCode = 1;
  } finally {
    loadGate?.release(); cookieReadGate?.release(); loginPageGate?.release(); await Promise.allSettled(values.map(login => login.shutdown()));
    BrowserWindow.prototype.loadURL = originalLoad; parent.destroy(); app.exit(Number(process.exitCode ?? 0));
  }
}).catch(() => app.exit(1));
