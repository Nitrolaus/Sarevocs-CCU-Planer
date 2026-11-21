import { app, BrowserWindow, session } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { RsiLogin } from '../src/importers/rsi';
import { SessionVault, type StoredCookie } from '../src/security/session-vault';
import { ConnectionDiagnostics, type ConnectionEvent } from '../src/diagnostics/connection';
import type { ImportCandidate } from '../src/domain/model';

const root = path.resolve(process.argv.find(value => value.startsWith('--test-root='))!.slice(12));
const baseline = process.argv.includes('--baseline');
fs.mkdirSync(root, { recursive: true });
app.setPath('userData', path.join(root, 'runtime'));
app.setPath('sessionData', path.join(root, 'memory'));
app.setPath('crashDumps', path.join(root, 'crashes'));
app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND');
app.commandLine.appendSwitch('proxy-server', 'http://127.0.0.1:1');
app.commandLine.appendSwitch('disable-smooth-scrolling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

const origin = 'https://robertsspaceindustries.com';
const hangar = origin + '/account/pledges';
const canary = 'SYNTHETIC_LIFECYCLE_COOKIE_ONLY';
const results: string[] = [];
const accounts: string[] = [];
const events: ConnectionEvent[] = [];
const allLogins: RsiLogin[] = [];
let phase = 'initialization';
let baselineEvidence: Record<string, unknown> | undefined;
const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
class CheckFailure extends Error { constructor(readonly fixedCode: string) { super(fixedCode); } }
function expect(value: unknown, code: string): void { if (!value) throw new CheckFailure(code); }
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
async function bounded<T>(task: Promise<T>, code: string, milliseconds = 6500): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([task, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new CheckFailure(code)), milliseconds);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}
type Outcome = { candidate?: ImportCandidate; error?: unknown };
function outcome(task: Promise<ImportCandidate>): Promise<Outcome> {
  return task.then(candidate => ({ candidate }), error => ({ error }));
}
function message(value: unknown): string { return value instanceof Error ? value.message : ''; }
function account(): string { const id = randomUUID(); accounts.push(id); return id; }
const cookie = (): StoredCookie => ({ name: 'Rsi-Token', value: canary, domain: 'robertsspaceindustries.com', path: '/', secure: true,
  httpOnly: true, hostOnly: true, session: false, expirationDate: Date.now() / 1000 + 3600, sameSite: 'lax' });
const auth = `<div class="c-account-sidebar__profile-info-handle">SYNTHETIC_HANDLE</div><ul class="list-items"><li>
<input class="js-pledge-id" value="synthetic-001"><input class="js-pledge-name" value="SYNTHETIC PLEDGE">
<div class="items-col">Synthetic contents</div><div class="date-col">Synthetic date</div>
<div class="item"><span class="title">Demo Ship</span><span class="kind">Ship</span></div><div class="without-images"></div></li></ul>`;
const fixtures = {
  login: '<input type="password"><p>SYNTHETIC LOGIN ONLY</p>',
  denied: '<p>You must be authenticated to reach this area.</p>',
  ready: auth + `<input id="editable" style="position:fixed;left:20px;top:100px;width:200px;height:45px">
<button id="action" style="position:fixed;left:20px;top:180px;width:200px;height:45px" onclick="window.actionClicks++">Synthetic action</button>`
};

app.whenReady().then(async () => {
  const diagnostics = new ConnectionDiagnostics(path.join(root, 'diagnostics'), '0.3.8');
  const sink = { record(event: ConnectionEvent) { events.push(event); return diagnostics.record(event); } };
  const originalLoadUrl = BrowserWindow.prototype.loadURL;
  const originalFromPartition = session.fromPartition;
  const requestHandlers = new Map<Electron.Session, (details: unknown, callback: (value: { cancel?: boolean }) => void) => void>();
  const requests: string[] = [];
  let hangarBody = fixtures.ready;
  let delayCookieRestore: { entered: ReturnType<typeof deferred>; release: ReturnType<typeof deferred> } | undefined;
  let navigationCount = 0;

  // Install before the first RsiLogin operation. No remote URL ever reaches Chromium.
  BrowserWindow.prototype.loadURL = async function(url) {
    expect(url === origin + '/en/sign-in' || url === hangar, 'UNEXPECTED_NAVIGATION_REQUEST');
    requests.push(url);
    this.webContents.getURL = () => url;
    const fixture = path.join(root, 'fixture-' + (++navigationCount) + '.html');
    fs.writeFileSync(fixture, `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'">
<body tabindex="0" style="margin:0;min-height:6000px"><script>window.actionClicks=0</script>${url === hangar ? hangarBody : fixtures.login}</body>`);
    await this.loadFile(fixture);
  };
  session.fromPartition = ((...args: Parameters<typeof session.fromPartition>) => {
    const isolated = originalFromPartition.apply(session, args);
    const originalBeforeRequest = isolated.webRequest.onBeforeRequest;
    isolated.webRequest.onBeforeRequest = ((...parameters: unknown[]) => {
      const listener = parameters.at(-1);
      if (typeof listener === 'function') requestHandlers.set(isolated, listener as (details: unknown, callback: (value: { cancel?: boolean }) => void) => void);
      return Reflect.apply(originalBeforeRequest, isolated.webRequest, parameters);
    }) as typeof isolated.webRequest.onBeforeRequest;
    const gate = delayCookieRestore;
    if (gate) {
      const originalSet = isolated.cookies.set.bind(isolated.cookies);
      isolated.cookies.set = async details => { gate.entered.resolve(); await gate.release.promise; return originalSet(details); };
    }
    return isolated;
  }) as typeof session.fromPartition;

  const parent = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, sandbox: true } });
  const emptyVault = () => ({ load: async () => [], save: async () => false }) as unknown as SessionVault;
  function login(vault = emptyVault()): RsiLogin { const value = new RsiLogin(vault, sink, undefined, (_id, identity) => identity.reference === 'SYNTHETIC_HANDLE'); allLogins.push(value); return value; }
  async function remote(except?: BrowserWindow): Promise<BrowserWindow> {
    for (let i = 0; i < 150; i++) {
      const win = BrowserWindow.getAllWindows().find(value => value !== parent && value !== except);
      if (win && !win.webContents.isLoadingMainFrame() && win.webContents.getURL().startsWith(origin)) { win.hide(); return win; }
      await wait(20);
    }
    throw new CheckFailure('LOCAL_FIXTURE_WINDOW_MISSING');
  }
  async function check(id: string, run: () => Promise<void>) {
    phase = id; requests.length = 0; hangarBody = fixtures.ready;
    await run(); results.push(id);
  }
  try {
    await check('WAIT_OVER_FIVE_MINUTES_AND_SUCCESS_STAYS_OPEN', async () => {
      const value = login(), id = account();
      let settled: Outcome | undefined;
      const task = outcome(value.connect(id, parent, false)).then(result => { settled = result; return result; });
      const win = await remote();
      expect(requests.length === 1 && requests[0] === origin + '/en/sign-in', 'WAIT_PHASE_NOT_REACHED');
      const now = Date.now;
      try {
        // Advance only the main-process wall clock, after connect entered its passive login wait.
        Date.now = () => now() + 6 * 60 * 1000;
        await wait(1100);
        if (settled?.error && message(settled.error).includes('CONNECTION_TIMEOUT') && events.some(event => event.event === 'connection-timeout')) {
          baselineEvidence = { waitingPhaseReached: true, simulatedClockAdvanceMs: 360000, navigationRequests: requests.length,
            diagnosticTimeout: true, functionalError: 'CONNECTION_TIMEOUT' };
          throw new CheckFailure('WAIT_OVER_FIVE_MINUTES_CONNECTION_TIMEOUT');
        }
        expect(!settled, 'PASSIVE_WAIT_SETTLED_WITHOUT_EXPLICIT_ACTION');
        expect(!win.isDestroyed() && requests.length === 1, 'PASSIVE_WAIT_CHANGED_WINDOW_OR_REQUESTS');
      } finally { Date.now = now; }
      win.webContents.getURL = () => origin + '/';
      const result = await bounded(task, 'SUCCESS_AFTER_LONG_WAIT_MISSING');
      expect(!result.error && result.candidate?.document.pledges.length === 1, 'SUCCESS_AFTER_LONG_WAIT_INVALID');
      expect(!win.isDestroyed() && loginWindowCount() === 1, 'SUCCESS_CLOSED_OWNED_WINDOW');
      expect(requests.length === 2 && value.status(id).state === 'page-ready', 'SUCCESS_STATUS_OR_NAVIGATION_INVALID');

      // Native Chromium input verifies the actual event guards, including wheel scrolling.
      phase = 'NATIVE_SCROLL_AND_READ_ONLY_INPUT';
      win.webContents.setBackgroundThrottling(false);
      win.show(); win.focus(); win.webContents.focus();
      await win.webContents.executeJavaScript('window.scrollTo(0,0); document.body.focus(); true');
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'PageDown' });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'PageDown' });
      for (let i = 0; i < 30 && !await win.webContents.executeJavaScript('window.scrollY > 0'); i++) await wait(40);
      if (!await win.webContents.executeJavaScript('window.scrollY > 0')) {
        fs.writeFileSync(path.join(root,'native-scroll.json'),JSON.stringify({focused:win.isFocused(),webFocused:win.webContents.isFocused(),
          geometry:await win.webContents.executeJavaScript('({documentFocused:document.hasFocus(),height:document.body.scrollHeight,viewport:innerHeight})')}));
      }
      expect(await win.webContents.executeJavaScript('window.scrollY > 0'), 'NATIVE_PAGE_DOWN_BLOCKED');
      const wheel = await win.webContents.executeJavaScript('window.scrollTo(0,600); document.body.focus(); ({x:Math.floor(innerWidth/2),y:Math.floor(innerHeight/2),before:scrollY})');
      win.webContents.sendInputEvent({ type: 'mouseMove', x: wheel.x, y: wheel.y });
      win.webContents.sendInputEvent({ type: 'mouseWheel', x: wheel.x, y: wheel.y, deltaY: -450, deltaX: 0, canScroll: true });
      for (let i = 0; i < 30 && await win.webContents.executeJavaScript('scrollY') === wheel.before; i++) await wait(40);
      expect(await win.webContents.executeJavaScript('scrollY') !== wheel.before, 'NATIVE_MOUSE_WHEEL_BLOCKED');
      const point = await win.webContents.executeJavaScript('(() => {const r=document.getElementById("action").getBoundingClientRect(); return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()');
      win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
      win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
      await win.webContents.executeJavaScript('document.getElementById("editable").focus(); true');
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'A' });
      win.webContents.sendInputEvent({ type: 'char', keyCode: 'a' });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'A' });
      await wait(100);
      expect(await win.webContents.executeJavaScript('window.actionClicks === 0 && document.getElementById("editable").value === ""'), 'FROZEN_CLICK_OR_TEXT_ALLOWED');
      for (const key of ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End']) {
        for (const modifier of ['', 'control', 'alt', 'meta', 'shift']) {
          let prevented = false;
          const input = { type: 'keyDown', key, control: false, alt: false, meta: false, shift: false, ...(modifier ? { [modifier]: true } : {}) };
          win.webContents.emit('before-input-event', { preventDefault() { prevented = true; } }, input);
          expect(prevented === Boolean(modifier), 'SCROLL_MODIFIER_GUARD_INVALID');
        }
      }
      const handler = requestHandlers.get(win.webContents.session);
      expect(handler, 'READ_ONLY_REQUEST_HANDLER_MISSING');
      let cancelled = false;
      handler!({ method: 'POST', url: origin + '/synthetic-readonly', resourceType: 'xhr' }, response => { cancelled = response.cancel === true; });
      expect(cancelled && events.some(event => event.event === 'request-blocked' && event.reason === 'read-only'), 'FROZEN_WRITE_REQUEST_ALLOWED');
      results.push('NATIVE_SCROLL_AND_READ_ONLY_INPUT');
      await value.close(id);
      expect(win.isDestroyed(), 'EXPLICIT_CLOSE_DID_NOT_DESTROY_WINDOW');
    });

    await check('ERROR_STAYS_OPEN_AND_RETRY_RESETS_PENDING_RETURN', async () => {
      const value = login(), id = account();
      const failed = outcome(value.connect(id, parent, false));
      const win = await remote();
      let prevented = false;
      win.webContents.emit('will-redirect', { preventDefault() { prevented = true; } }, origin + '/synthetic-return', false, true);
      expect(prevented, 'SYNTHETIC_RETURN_NOT_GUARDED');
      win.webContents.emit('did-fail-load', {}, -105, 'SYNTHETIC_FAILURE', origin + '/en/sign-in', true);
      const failure = await bounded(failed, 'ERROR_OBSERVER_DID_NOT_SETTLE');
      expect(message(failure.error).includes('ERR_NAME_NOT_RESOLVED'), 'ERROR_OBSERVER_WRONG_FAILURE');
      expect(!win.isDestroyed() && value.status(id).state === 'error', 'ERROR_CLOSED_WINDOW_OR_LOST_STATUS');
      win.hide();
      win.webContents.getURL = () => origin + '/';
      const retry = await bounded(outcome(value.connect(id, parent, false)), 'RETRY_PENDING_RETURN_NOT_RESET');
      expect(!retry.error && retry.candidate?.document.pledges.length === 1, 'RETRY_AFTER_ERROR_FAILED');
      expect(!win.isDestroyed() && loginWindowCount() === 1 && requests.length === 2, 'RETRY_REPLACED_WINDOW_OR_NAVIGATED_REPEATEDLY');
      expect(win.isVisible(), 'EXPLICIT_RETRY_DID_NOT_REVEAL_EXISTING_WINDOW');
      await value.close(id);
    });

    await check('RETRY_RESETS_PREVIOUS_HANGAR_TRANSITION', async () => {
      const value = login(), id = account(); hangarBody = fixtures.denied;
      const failed = outcome(value.connect(id, parent, false));
      const win = await remote(); win.webContents.getURL = () => origin + '/';
      const failure = await bounded(failed, 'DENIED_HANGAR_DID_NOT_SETTLE');
      expect(message(failure.error).includes('nicht frei') && requests.length === 2, 'DENIED_HANGAR_WRONG_FAILURE');
      expect(!win.isDestroyed(), 'DENIED_HANGAR_CLOSED_WINDOW');
      hangarBody = fixtures.ready; win.webContents.getURL = () => origin + '/';
      const retry = await bounded(outcome(value.connect(id, parent, false)), 'RETRY_HANGAR_TRANSITION_NOT_RESET');
      expect(!retry.error && retry.candidate?.document.pledges.length === 1, 'RETRY_HANGAR_TRANSITION_FAILED');
      expect(!win.isDestroyed() && requests.length === 3, 'RETRY_HANGAR_REPLACED_WINDOW_OR_LOOPED');
      await value.close(id);
    });

    for (const cancelWith of ['close', 'shutdown'] as const) {
      await check('CANCEL_DURING_VAULT_RESTORE_' + cancelWith.toUpperCase(), async () => {
        const entered = deferred(), release = deferred();
        const vault = { load: async () => { entered.resolve(); await release.promise; return [cookie()]; }, save: async () => false } as unknown as SessionVault;
        const value = login(vault), id = account();
        const task = outcome(value.connect(id, parent, true));
        await bounded(entered.promise, 'VAULT_RESTORE_GATE_NOT_ENTERED');
        let closingFinished = false;
        const operation: Promise<unknown> = cancelWith === 'close' ? value.close(id) : value.shutdown();
        const closing = operation.then(() => { closingFinished = true; });
        try {
          await wait(60);
          expect(!closingFinished, 'RESTORE_CANCEL_RETURNED_BEFORE_VAULT_FINISHED');
          expect(loginWindowCount() === 0 && requests.length === 0, 'RESTORE_CREATED_WINDOW_BEFORE_COMPLETION');
        }
        finally { release.resolve(); }
        await bounded(closing.then(() => undefined), 'RESTORE_CANCEL_CLEANUP_PENDING');
        const result = await bounded(task, 'RESTORE_CANCEL_DID_NOT_SETTLE');
        expect(message(result.error).includes('beendet'), 'RESTORE_CANCEL_WRONG_FAILURE');
        expect(loginWindowCount() === 0 && requests.length === 0, 'RESTORE_CANCEL_CREATED_LATE_WINDOW');
      });
    }

    await check('CANCEL_DURING_COOKIE_RESTORE', async () => {
      const entered = deferred(), release = deferred(); delayCookieRestore = { entered, release };
      const vault = { load: async () => [cookie()], save: async () => false } as unknown as SessionVault;
      const value = login(vault), id = account();
      const task = outcome(value.connect(id, parent, true));
      try {
        await bounded(entered.promise, 'COOKIE_RESTORE_GATE_NOT_ENTERED');
        let closingFinished = false;
        const closing = value.close(id).then(() => { closingFinished = true; });
        await wait(60);
        expect(!closingFinished, 'COOKIE_RESTORE_CANCEL_RETURNED_BEFORE_RESTORE_FINISHED');
        expect(loginWindowCount() === 0 && requests.length === 0, 'COOKIE_RESTORE_CREATED_EARLY_WINDOW');
        release.resolve(); await bounded(closing, 'COOKIE_RESTORE_CANCEL_CLEANUP_PENDING');
        const result = await bounded(task, 'COOKIE_RESTORE_CANCEL_DID_NOT_SETTLE');
        expect(message(result.error).includes('beendet'), 'COOKIE_RESTORE_CANCEL_WRONG_FAILURE');
        expect(loginWindowCount() === 0 && requests.length === 0, 'COOKIE_RESTORE_CANCEL_CREATED_LATE_WINDOW');
      } finally { release.resolve(); delayCookieRestore = undefined; }
    });

    await check('USER_CLOSE_AND_SHUTDOWN_AWAIT_ONE_SAVE', async () => {
      const entered = deferred(), release = deferred(); let saveCount = 0, shutdownDone = false, closeDone = false;
      const vault = { load: async () => [cookie()], save: async () => { saveCount++; entered.resolve(); await release.promise; return true; } } as unknown as SessionVault;
      const value = login(vault), id = account();
      await value.connect(id, parent, true); const win = await remote();
      win.close(); await bounded(entered.promise, 'USER_CLOSE_SAVE_NOT_ENTERED');
      const closing = value.close(id).then(() => { closeDone = true; });
      const shutdown = value.shutdown().then(ok => { shutdownDone = true; return ok; });
      try {
        await wait(60);
        expect(!shutdownDone && !closeDone && !win.isDestroyed() && saveCount === 1, 'CLOSE_OR_SHUTDOWN_DID_NOT_WAIT_FOR_SAVE');
      } finally { release.resolve(); }
      const [, ok] = await bounded(Promise.all([closing, shutdown]), 'CLOSE_OR_SHUTDOWN_SAVE_NEVER_FINISHED');
      expect(ok && win.isDestroyed() && saveCount === 1, 'CLOSE_OR_SHUTDOWN_DUPLICATED_SAVE_OR_LEFT_WINDOW');
    });

    await check('SAVE_FAILURE_REMAINS_VISIBLE_WITHOUT_FALLBACK', async () => {
      let saveCount = 0;
      const vault = { load: async () => [cookie()], save: async () => { saveCount++; throw new Error('SYNTHETIC_SAVE_FAILURE'); } } as unknown as SessionVault;
      const value = login(vault), id = account();
      await value.connect(id, parent, true); const win = await remote();
      expect(await value.shutdown() === false, 'SHUTDOWN_CONCEALED_SAVE_FAILURE');
      expect(win.isDestroyed() && saveCount === 1 && value.status(id).state === 'error', 'SAVE_FAILURE_LOST_OR_RETRIED_WITH_FALLBACK');
      expect(value.status(id).message.includes('Keine Klartext-Ersatzspeicherung'), 'SAVE_FAILURE_PROTECTION_MESSAGE_MISSING');
    });

    await check('REMEMBER_CHANGE_REOPENS_WITHOUT_CANCELLING_NEW_ATTEMPT', async () => {
      let loads = 0, saves = 0, savedSyntheticCookie = false;
      const vault = { load: async () => { loads++; return [cookie()]; }, save: async (_id: string, values: StoredCookie[]) => {
        saves++; savedSyntheticCookie = values.some(value => value.name === 'Rsi-Token' && value.value === canary); return true;
      } } as unknown as SessionVault;
      const value = login(vault), id = account();
      await value.open(id, parent, false); const old = await remote();
      const task = outcome(value.connect(id, parent, true));
      const replacement = await remote(old);
      const result = await bounded(task, 'REMEMBER_CHANGE_CANCELLED_NEW_CONNECTION');
      expect(!result.error && result.candidate?.document.pledges.length === 1, 'REMEMBER_CHANGE_CONNECTION_INVALID');
      expect(old.isDestroyed() && !replacement.isDestroyed() && loads === 1 && requests.length === 2, 'REMEMBER_CHANGE_WINDOW_OR_RESTORE_INVALID');
      await value.close(id);
      expect(replacement.isDestroyed() && saves === 1 && savedSyntheticCookie, 'REMEMBER_CHANGE_DID_NOT_SAVE_REPLACEMENT');
    });

    await check('DIAGNOSTICS_CONTAIN_FIXED_CODES_ONLY', async () => {
      const bytes = fs.readFileSync(diagnostics.file, 'utf8');
      expect(!bytes.includes(canary) && !bytes.includes('https:') && !accounts.some(id => bytes.includes(id)), 'DIAGNOSTICS_CONTAIN_PRIVATE_VALUES');
      expect(events.some(event => event.event === 'request-blocked' && event.reason === 'read-only'), 'READ_ONLY_DIAGNOSTIC_MISSING');
      expect(!events.some(event => event.event === 'connection-timeout'), 'UNEXPECTED_TIMEOUT_DIAGNOSTIC');
    });
  } finally {
    delayCookieRestore?.release.resolve();
    for (const value of allLogins) await value.shutdown();
    BrowserWindow.prototype.loadURL = originalLoadUrl;
    session.fromPartition = originalFromPartition;
    parent.destroy();
  }
  function loginWindowCount() { return BrowserWindow.getAllWindows().filter(value => value !== parent).length; }
  fs.writeFileSync(path.join(root, 'results.json'), JSON.stringify({ status: 'PASS', data: 'synthetic-only; local fixtures; DNS blocked; dead proxy; isolated RAM sessions', results }, null, 2));
  for (const result of results) console.log('PASS: ' + result);
  console.log('REPORT: ' + path.join(root, 'results.json'));
  app.quit();
}).catch(error => {
  const failureCode = error instanceof CheckFailure ? error.fixedCode : 'UNEXPECTED_HARNESS_FAILURE';
  const expectedBaselineFailure = baseline && phase === 'WAIT_OVER_FIVE_MINUTES_AND_SUCCESS_STAYS_OPEN' &&
    failureCode === 'WAIT_OVER_FIVE_MINUTES_CONNECTION_TIMEOUT' && baselineEvidence?.functionalError === 'CONNECTION_TIMEOUT';
  fs.writeFileSync(path.join(root, 'results.json'), JSON.stringify({ status: 'FAIL', phase, failureCode, expectedBaselineFailure,
    ...(baselineEvidence ? { evidence: baselineEvidence } : {}), results }, null, 2));
  console.error('FAIL: ' + failureCode);
  console.log('REPORT: ' + path.join(root, 'results.json'));
  app.exit(1);
});
