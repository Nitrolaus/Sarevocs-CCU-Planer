import { BrowserWindow, session } from 'electron';
import { randomUUID } from 'node:crypto';
import { allowedRsiNavigation, evaluateRsiSessionRequest, insecureRsiTransport, isPledgesPage, isRsiLoginPage, rsiCaptchaFrame, rsiReturnCandidate, RSI_HANGAR_URL, RSI_LOGIN_URL, RSI_ORIGIN } from '../main/policy';
import { UserError, type ImportCandidate } from '../domain/model';
import {readHangarPages,type HangarRefreshProgress} from './hangar-read';
import { SessionVault, type StoredCookie } from '../security/session-vault';
import { captureRsiCookie, hasAuthenticationCookie, isAuthenticationCookieName } from '../security/rsi-cookies';
import { isDeepStrictEqual } from 'node:util';
import { connectionResource, connectionTarget, diagnosticLabel, networkErrorName, protectNavigationWarnings, HANGAR_OBSERVATIONS, type ConnectionEvent, type DiagnosticSink } from '../diagnostics/connection';
import { RSI_PAGE_PROBE, RSI_CONNECTION_PROBE, rsiFetchPageProbe } from './rsi-page';
import { CREDIT_URL, CREDIT_CSRF_PROBE, readStoreCredit } from './rsi-credit';
import { buybackFetchProbe, buybackPageUrl, isBuybackListRead, readBuybacks } from './rsi-buyback';
import { readPurchases } from './rsi-purchases';
import { MAX_FILE_BYTES } from './files';
export { RSI_PAGE_PROBE, RSI_CONNECTION_PROBE } from './rsi-page';

export type LoginStatus = { state: 'closed' | 'login-required' | 'page-ready' | 'restricted' | 'error'; message: string; progress?: HangarRefreshProgress };
export type BackgroundRestoreCode = 'auth-required' | 'unavailable' | 'cancelled';
export class BackgroundRestoreError extends UserError {
  constructor(readonly code: BackgroundRestoreCode) {
    super(code === 'auth-required' ? 'Gespeicherte RSI-Anmeldung wird nicht akzeptiert. Bitte ausdrücklich neu verbinden.' :
      code === 'cancelled' ? 'Hintergrundprüfung beendet.' : 'Gespeicherte RSI-Anmeldung konnte im Hintergrund nicht geprüft werden.');
  }
}
type RsiIdentity = ImportCandidate['document']['account'];
type RsiSession = { session: Electron.Session; remember: boolean; closing: boolean;
  verified?: { identity: RsiIdentity; cookies: StoredCookie[] }; closeTask: Promise<void> | null; failure: string | null;
  automatic: boolean; returnPending: object | null; hangarTransitioned: boolean;
  background: boolean; hideHangar: boolean; loginDocument: boolean;
  restoreFailure: BackgroundRestoreCode | null; buybackListUrl?: string };
type ConnectionAttempt = { cancelled: boolean; done: Promise<void>; finish: () => void; timedOut?: boolean };
type RestoreAttempt = ConnectionAttempt & { timedOut: boolean };
export class RsiLogin {
  private windows = new Map<string, BrowserWindow>();
  private statuses = new Map<string, LoginStatus>();
  private frozen = new Set<string>();
  private connecting = new Set<string>();
  private attempts = new Map<string, ConnectionAttempt>();
  private sessions = new Map<string, RsiSession>();
  private restores = new Map<string, { attempt: RestoreAttempt; task: Promise<ImportCandidate | null> }>();
  private stopping = false;
  constructor(private vault: SessionVault, private diagnostics?: DiagnosticSink, private icon?: string,
    private canRemember: (id: string, identity: RsiIdentity) => boolean = () => false,
    private creditTransport = async () => session.fromPartition('credit-read-' + randomUUID(), {cache: false}),
    private purchaseReader = readPurchases) { protectNavigationWarnings(); }
  private record(event: ConnectionEvent): string {
    let saved = false;
    try { saved = this.diagnostics?.record(event) ?? false; } catch { /* Diagnostics must not break login or cleanup. */ }
    return `RSI-Verbindung nicht möglich (${diagnosticLabel(event)}). ` + (saved ? 'Fehlercode lokal gespeichert.' : 'Fehlercode konnte nicht lokal gespeichert werden.');
  }
  private queueHangarReturn(state: RsiSession) {
    if (state.returnPending) return;
    state.returnPending = {};
    this.record({ event: 'login-return-pending', target: 'rsi-other', resource: 'mainFrame' });
  }
  async settings(accountId: string) {
    const status = await this.vault.status(accountId);
    return { ...status, sessionOpen: this.windows.has(accountId), error: this.sessions.get(accountId)?.failure ?? status.error };
  }
  private async cookies(isolated: Electron.Session): Promise<StoredCookie[]> {
    return (await isolated.cookies.get({})).map(captureRsiCookie).filter((c): c is StoredCookie => c !== null);
  }
  status(accountId: string): LoginStatus { return this.statuses.get(accountId) ?? { state: 'closed', message: 'Noch keine RSI-Anmeldung geprüft.' }; }
  private async cancelRestore(accountId: string) {
    const restore = this.restores.get(accountId);
    if (!restore) return;
    restore.attempt.cancelled = true;
    const [closing] = await Promise.allSettled([this.closeSession(accountId, true), restore.attempt.done]);
    if (closing!.status === 'rejected') throw closing!.reason;
  }
  resume(accountId: string, parent: BrowserWindow): Promise<ImportCandidate | null> {
    const current = this.restores.get(accountId);
    if (current) return current.task;
    if (this.stopping || parent.isDestroyed()) return Promise.reject(new BackgroundRestoreError('cancelled'));
    // A background check never takes ownership of an existing user window.
    if (this.windows.has(accountId) || this.attempts.has(accountId)) return Promise.reject(new BackgroundRestoreError('unavailable'));
    let finish = () => {};
    const done = new Promise<void>(resolve => { finish = resolve; });
    const attempt: RestoreAttempt = { cancelled: false, timedOut: false, done, finish };
    this.attempts.set(accountId, attempt);
    // Defer work until both registries exist, including cancellation before vault.load finishes.
    const task = Promise.resolve().then(() => this.restoreSaved(accountId, parent, attempt));
    this.restores.set(accountId, { attempt, task });
    return task;
  }
  private async restoreSaved(accountId: string, parent: BrowserWindow, attempt: RestoreAttempt): Promise<ImportCandidate | null> {
    let deadline = Infinity;
    const active = () => {
      if (attempt.cancelled || this.stopping || parent.isDestroyed()) throw new BackgroundRestoreError('cancelled');
      if (attempt.timedOut || Date.now() >= deadline) throw new BackgroundRestoreError('unavailable');
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    let candidate: ImportCandidate | null = null;
    let failure: BackgroundRestoreError | null = null;
    try {
      active();
      const restored = await this.vault.load(accountId, false);
      active();
      if (hasAuthenticationCookie(restored)) {
        deadline = Date.now() + 60000;
        timer = setTimeout(() => {
          attempt.timedOut = true;
          void this.closeSession(accountId, true).catch(() => {});
        }, 60000);
        await this.openWindow(accountId, parent, true, false, attempt, restored);
        active();
        const win = this.windows.get(accountId), state = this.sessions.get(accountId);
        if (!win || !state) throw new BackgroundRestoreError('unavailable');
        while (true) {
          active();
          if (state.restoreFailure) throw new BackgroundRestoreError(state.restoreFailure);
          if (state.closing || win.isDestroyed()) throw new BackgroundRestoreError('cancelled');
          const status = this.status(accountId);
          if (['restricted', 'error'].includes(status.state)) throw new BackgroundRestoreError('unavailable');
          const url = win.webContents.getURL();
          if (!win.webContents.isLoadingMainFrame() && url && url !== 'about:blank') {
            if (!isPledgesPage(url)) throw new BackgroundRestoreError(isRsiLoginPage(url) ? 'auth-required' : 'unavailable');
            const observation: unknown = await win.webContents.executeJavaScript(RSI_CONNECTION_PROBE);
            active();
            if (observation === 'login' || observation === 'consent') throw new BackgroundRestoreError('auth-required');
            if (observation === 'upgrade-fields') throw new BackgroundRestoreError('unavailable');
            if (observation === 'ready') {
              // Only the initial hidden session check has a deadline. A valid large hangar may take longer.
              clearTimeout(timer); timer=undefined; deadline=Infinity;
              candidate = await this.probe(accountId);
              active();
              if (state.restoreFailure) throw new BackgroundRestoreError(state.restoreFailure);
              // Only a successfully read session may rotate the encrypted capsule.
              state.remember = true;
              break;
            }
          }
          await new Promise(resolve => setTimeout(resolve, 250));
        }
      }
    } catch (error) {
      failure = error instanceof BackgroundRestoreError ? error : new BackgroundRestoreError('unavailable');
    } finally {
      deadline = Infinity;
      clearTimeout(timer);
      try { await this.closeSession(accountId, !candidate || !!failure || attempt.cancelled || attempt.timedOut || this.stopping); }
      catch { failure = new BackgroundRestoreError('unavailable'); }
      if (this.attempts.get(accountId) === attempt) this.attempts.delete(accountId);
      if (this.restores.get(accountId)?.attempt === attempt) this.restores.delete(accountId);
      attempt.finish();
    }
    active();
    if (failure) {
      this.statuses.set(accountId, { state: failure.code === 'auth-required' ? 'login-required' : 'error', message: failure.message });
      throw failure;
    }
    if (!candidate) return null;
    this.statuses.set(accountId, { state: 'page-ready', message: 'Gespeicherte RSI-Anmeldung geprüft. Live-Vorschau noch nicht übernommen.' });
    return candidate;
  }
  async open(accountId: string, parent: BrowserWindow, remember: boolean, automatic = false, attempt?: ConnectionAttempt) {
    await this.cancelRestore(accountId);
    return this.openWindow(accountId, parent, remember, automatic, attempt);
  }
  private async openWindow(accountId: string, parent: BrowserWindow, remember: boolean, automatic = false, attempt?: ConnectionAttempt, restoredBackground?: StoredCookie[], hideHangar = false) {
    const background = restoredBackground !== undefined;
    const ensureActive = () => { if (attempt?.cancelled || attempt?.timedOut || this.stopping || parent.isDestroyed()) throw new UserError('Verbindung beendet.'); };
    ensureActive();
    const old = this.windows.get(accountId);
    if (old && !old.isDestroyed()) {
      if (background) throw new BackgroundRestoreError('unavailable');
      const existing = this.sessions.get(accountId);
      if (!existing?.closing && existing?.remember === remember) {
        existing.hideHangar = hideHangar;
        if (automatic) {
          existing.automatic = true; existing.returnPending = null; existing.hangarTransitioned = false;
          if (isRsiLoginPage(old.webContents.getURL())) this.frozen.delete(accountId);
          this.statuses.set(accountId, { state: 'login-required', message: 'Offenes RSI-Fenster wird geprüft.' });
        }
        if (hideHangar && isPledgesPage(old.webContents.getURL())) old.hide();
        else { if (old.isMinimized()) old.restore(); old.show(); old.focus(); }
        return this.status(accountId);
      }
      // Replacing a session for the user's changed persistence choice must not cancel the new attempt.
      await this.closeSession(accountId);
    }
    ensureActive();
    const restored = restoredBackground ?? (remember ? await this.vault.load(accountId) : []);
    ensureActive();
    const isolated = session.fromPartition('rsi-' + randomUUID(), { cache: false });
    try {
      for (const cookie of restored) {
        ensureActive();
        await isolated.cookies.set({ url: 'https://' + cookie.domain.replace(/^\./, '') + cookie.path,
          name: cookie.name, value: cookie.value, path: cookie.path, secure: true, httpOnly: cookie.httpOnly,
          sameSite: cookie.sameSite, ...(cookie.hostOnly ? {} : { domain: cookie.domain }),
          ...(cookie.expirationDate === undefined ? {} : { expirationDate: cookie.expirationDate }) });
      }
      ensureActive();
    } catch (error) { await isolated.clearStorageData(); await isolated.clearCache(); throw error; }
    const state: RsiSession = { session: isolated, remember: background ? false : remember, closing: false, closeTask: null, failure: null,
      automatic, returnPending: null, hangarTransitioned: false, background, hideHangar,
      loginDocument: false, restoreFailure: null };
    this.sessions.set(accountId, state);
    isolated.setPermissionCheckHandler(() => false);
    isolated.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    isolated.setDevicePermissionHandler(() => false);
    isolated.on('will-download', event => event.preventDefault());
    isolated.webRequest.onBeforeRequest((details, callback) => {
      const frame = details.frame;
      const loginPage = state.loginDocument && !!frame?.top && isRsiLoginPage(frame.top.url);
      const officialAuth = details.initiatorOrigin === RSI_ORIGIN && frame?.parent === null;
      const captchaOrigin = details.initiatorOrigin === 'https://www.recaptcha.net' && !!frame && rsiCaptchaFrame(frame.url);
      // Chromium reports the new subframe as the requester, but RSI as the initiator of its first navigation.
      const openingCaptchaFrame = details.initiatorOrigin === RSI_ORIGIN && details.resourceType === 'subFrame' && rsiCaptchaFrame(details.url);
      const phase = state.closing ? 'closed' : loginPage && (officialAuth || openingCaptchaFrame) ? 'login' : loginPage && captchaOrigin ? 'captcha' : 'read';
      const insecure = insecureRsiTransport(details.url), operation = evaluateRsiSessionRequest(details, phase);
      const listingRead = !state.closing && isBuybackListRead(details, state.buybackListUrl);
      const cancel = insecure || operation.blocked && !listingRead;
      callback({ cancel });
      if (cancel && !state.closing) this.record({ event: 'request-blocked', target: connectionTarget(details.url), resource: connectionResource(details.resourceType),
        reason: insecure ? 'insecure-transport' : operation.blocked && operation.detail === 'non-read-method' && !loginPage ? 'read-only' : 'protected-operation',
        ...(!insecure && operation.blocked ? { blockDetail: operation.detail } : {}) });
    });
    isolated.webRequest.onCompleted(details => {
      if (!state.closing && details.statusCode >= 400) this.record({ event: 'http-error', target: connectionTarget(details.url),
        resource: connectionResource(details.resourceType), httpStatus: details.statusCode });
    });
    isolated.webRequest.onErrorOccurred(details => {
      const networkError = networkErrorName(details.error);
      if (!state.closing && networkError !== 'ERR_ABORTED') this.record({ event: 'request-failed', target: connectionTarget(details.url),
        resource: connectionResource(details.resourceType), networkError });
    });
    const initialHangar = background || automatic && hasAuthenticationCookie(restored);
    const win = new BrowserWindow({ parent, width: 1100, height: 850, autoHideMenuBar: true, show: false, backgroundColor: '#111820',
      title: 'RSI-Anmeldung – getrennte Sitzung', icon: this.icon,
      webPreferences: { session: isolated, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true,
        allowRunningInsecureContent: false, webviewTag: false, spellcheck: false, disableDialogs: background } });
    this.windows.set(accountId, win);
    let firstPaint = false;
    const showRsiPage = (url: string) => {
      if (background || state.closing || win.isDestroyed() || this.windows.get(accountId) !== win ||
          win.isVisible() || win.isMinimized() || !allowedRsiNavigation(url) ||
          (state.hideHangar && !isRsiLoginPage(url))) return;
      win.show(); // Electron's show() focuses the newly visible window.
    };
    win.once('ready-to-show', () => {
      firstPaint = true;
      showRsiPage(win.webContents.getURL());
    });
    win.on('page-title-updated', event => { event.preventDefault(); win.setTitle('RSI – https://robertsspaceindustries.com · ' + (remember ? 'Windows-geschützte Speicherung' : 'flüchtige Sitzung')); });
    this.statuses.set(accountId, { state: 'login-required', message: 'Bitte ausschließlich im offiziellen RSI-Fenster anmelden. Noch kein Bestand importiert.' });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('did-navigate', (_event, url) => {
      state.loginDocument = !background && isRsiLoginPage(url);
      state.returnPending = null;
      if (state.loginDocument) state.hangarTransitioned = false;
    });
    win.webContents.on('did-start-navigation', (details) => {
      if (details.isMainFrame && allowedRsiNavigation(details.url)) state.returnPending = null;
    });
    win.webContents.on('did-navigate-in-page', (_event, _url, main) => {
      if (main) state.returnPending = null;
    });
    const guard = (event: Electron.Event, url: string, _inPlace?: boolean, main = true) => {
      if (!main && state.loginDocument && rsiCaptchaFrame(url)) return;
      if (background && main && !isPledgesPage(url)) {
        event.preventDefault();
        state.restoreFailure = isRsiLoginPage(url) ? 'auth-required' : 'unavailable';
        return;
      }
      if (main && state.hideHangar && isPledgesPage(url)) win.hide();
      if (!allowedRsiNavigation(url)) {
        event.preventDefault();
        if (main && state.automatic && this.connecting.has(accountId) && !state.closing && !state.hangarTransitioned && rsiReturnCandidate(url)) {
          this.queueHangarReturn(state); return;
        }
        const message = this.record({ event: 'navigation-blocked', target: connectionTarget(url), resource: main ? 'mainFrame' : 'subFrame', reason: 'navigation-policy' });
        if (main) this.statuses.set(accountId, { state: 'restricted', message });
      }
    };
    win.webContents.on('will-navigate', guard);
    win.webContents.on('will-redirect', guard);
    win.webContents.on('will-attach-webview', event => event.preventDefault());
    // Lock only after a successful structured probe. A hangar URL may still show consent or login.
    win.webContents.on('before-input-event', (event, input) => {
      const scroll = !input.control && !input.alt && !input.meta && !input.shift &&
        ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(input.key);
      if (this.frozen.has(accountId) && !scroll) event.preventDefault();
    });
    win.webContents.on('before-mouse-event', (event, mouse) => {
      if (this.frozen.has(accountId) && mouse.type !== 'mouseWheel') event.preventDefault();
    });
    win.webContents.on('did-finish-load', () => {
      this.frozen.delete(accountId);
      const url = win.webContents.getURL();
      if (isPledgesPage(url)) {
        if (state.hideHangar) win.hide();
        this.statuses.set(accountId, { state: 'login-required', message: 'Hangaradresse geladen. Cookie-Hinweis und Anmeldung abschließen, danach die Hangarseite prüfen.' });
      }
      // ready-to-show describes the initial document, not a later transition
      // from a hidden Hangar to the sign-in page in the same window.
      if (firstPaint || (initialHangar && isRsiLoginPage(url))) showRsiPage(url);
    });
    win.webContents.on('did-fail-load', (_e, code, _description, url, main) => {
      if (state.closing || code === -3) return;
      const message = this.record({ event: 'load-failed', target: connectionTarget(url), resource: main ? 'mainFrame' : 'subFrame', code, networkError: networkErrorName(code) });
      if (main) {
        this.statuses.set(accountId, { state: 'error', message });
        showRsiPage(url);
      }
    });
    win.on('close', event => {
      if (state.closing) return;
      event.preventDefault(); void this.close(accountId).catch(() => {});
    });
    win.on('closed', () => {
      this.windows.delete(accountId); this.frozen.delete(accountId);
    });
    // Enter on the URL shared by password and MFA to avoid a route reload between them.
    void win.loadURL(initialHangar ? RSI_HANGAR_URL : RSI_LOGIN_URL).catch(() => {});
    return this.status(accountId);
  }
  async connect(accountId: string, parent: BrowserWindow, remember: boolean, options: { hideHangar?: boolean; signal?: AbortSignal } = {}): Promise<ImportCandidate> {
    let attempt: ConnectionAttempt | undefined;
    let aborted = options.signal?.aborted ?? false;
    let abortCleanup: Promise<void> | undefined;
    const abort = () => {
      aborted = true;
      if (attempt) attempt.cancelled = true;
      const restore = this.restores.get(accountId);
      if (restore) restore.attempt.cancelled = true;
      if (attempt || restore) {
        abortCleanup = this.closeSession(accountId, true);
        void abortCleanup.catch(() => {}); // The finally block awaits and reports cleanup failures.
      }
    };
    const active = () => {
      if (aborted || options.signal?.aborted || attempt?.cancelled || this.stopping || parent.isDestroyed()) throw new UserError('Verbindung beendet.');
    };
    // Own the signal before cancellation of an earlier restore can yield.
    options.signal?.addEventListener('abort', abort, { once: true });
    let win: BrowserWindow | undefined;
    try {
      active();
      await this.cancelRestore(accountId);
      active();
      if (this.connecting.has(accountId)) throw new UserError('Verbindung läuft bereits.');
      this.connecting.add(accountId);
      let finish = () => {};
      const done = new Promise<void>(resolve => { finish = resolve; });
      attempt = { cancelled: false, done, finish }; this.attempts.set(accountId, attempt);
      await this.openWindow(accountId, parent, remember, true, attempt, undefined, options.hideHangar);
      active();
      win = this.windows.get(accountId);
      if (!win) throw new UserError('RSI-Fenster konnte nicht geöffnet werden.');
      const state = this.sessions.get(accountId);
      if (!state) throw new UserError('Verbindung beendet.');
      const activeWindow = win;
      const current = () => {
        active();
        if (state.closing || activeWindow.isDestroyed() || this.windows.get(accountId) !== activeWindow) throw new UserError('Verbindung beendet.');
      };
      let lastHangarAuth: StoredCookie[] = [];
      const openHangar = async (url: string, pending: RsiSession['returnPending']) => {
        const cookies = await this.cookies(state.session);
        current();
        const contents = activeWindow.webContents;
        if (state.returnPending !== pending || contents.getURL() !== url || contents.isLoadingMainFrame() ||
            ['restricted', 'error'].includes(this.status(accountId).state) || !hasAuthenticationCookie(cookies)) return;
        const auth = cookies.filter(c => isAuthenticationCookieName(c.name));
        // If RSI sent the user back to sign-in, a stale cookie must not cause the same redirect again.
        if (!auth.some(cookie => !lastHangarAuth.some(previous => previous.name === cookie.name &&
            previous.domain === cookie.domain && previous.path === cookie.path && previous.value === cookie.value))) return;
        lastHangarAuth = auth;
        state.returnPending = null; state.hangarTransitioned = true;
        this.record({ event: 'hangar-transition', target: 'hangar', resource: 'mainFrame' });
        if (state.hideHangar) activeWindow.hide();
        let signInStarted = false;
        const observeSignIn = (details: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>) => {
          if (details.isMainFrame && isRsiLoginPage(details.url)) signInStarted = true;
        };
        contents.on('did-start-navigation', observeSignIn);
        try { await activeWindow.loadURL(RSI_HANGAR_URL); }
        catch (error) {
          current();
          // An official sign-in navigation can supersede our load. Other errors still surface.
          if (!signInStarted || (error as NodeJS.ErrnoException)?.code !== 'ERR_ABORTED') throw error;
        } finally { contents.removeListener('did-start-navigation', observeSignIn); }
      };
      let loginPageOpened = false;
      let previousObservation: unknown;
      // User-controlled lifetime: waiting for CAPTCHA, MFA or hangar recognition has no arbitrary deadline.
      while (true) {
        current();
        const status = this.status(accountId);
        if (['restricted', 'error'].includes(status.state)) throw new UserError(status.message);
        const url = win.webContents.getURL();
        const pending = state.returnPending;
        if (!win.webContents.isLoadingMainFrame() && url && url !== 'about:blank') {
          if (pending) {
            await openHangar(url, pending);
          } else if (!allowedRsiNavigation(url)) {
            if (!state.hangarTransitioned && rsiReturnCandidate(url)) this.queueHangarReturn(state);
            else throw new UserError(this.record({ event: 'navigation-blocked', target: connectionTarget(url), resource: 'mainFrame', reason: 'navigation-policy' }));
          } else if (isPledgesPage(url)) {
            const observation: unknown = await win.webContents.executeJavaScript(RSI_CONNECTION_PROBE);
            current();
            const fixed = HANGAR_OBSERVATIONS.find(x => x === observation);
            if (fixed && fixed !== previousObservation) {
              this.record({ event: 'hangar-observation', target: 'hangar', resource: 'mainFrame', observation: fixed });
              previousObservation = fixed;
            }
            if (observation === 'upgrade-fields') throw new UserError('CCU-Daten im Hangar sind nicht eindeutig lesbar. Kein Bestand übernommen.');
            if (observation === 'consent' && state.hideHangar && !win.isVisible() && !win.isMinimized()) win.show();
            if (observation === 'ready') {
              if (state.hideHangar && win.isVisible()) win.hide();
              const candidate = await this.probe(accountId);
              current();
              if (remember) {
                const cookies = await this.cookies(win.webContents.session);
                current();
                if (!hasAuthenticationCookie(cookies)) candidate.warnings.unshift('Keine neue Anmeldung gespeichert: RSI hat keine erkannten Anmeldecookies bereitgestellt.');
              }
              current();
              return candidate;
            }
            if (observation === 'login') {
              if (loginPageOpened || state.hangarTransitioned) {
                this.record({ event: 'hangar-not-ready', target: 'hangar', resource: 'mainFrame' });
                throw new UserError('RSI gibt den Hangar noch nicht frei. Bitte später erneut versuchen.');
              }
              loginPageOpened = true;
              await win.loadURL(RSI_LOGIN_URL);
            }
          } else if (!isRsiLoginPage(url) && !state.hangarTransitioned) {
            // An allowed public/account route can be reached before RSI finishes authentication.
            await openHangar(url, null);
          }
        }
        // Passive DOM observation, never an authentication submission or repeated HTTP request.
        await new Promise(resolve => setTimeout(resolve, 750));
      }
    } catch (error) {
      if (aborted || options.signal?.aborted || attempt?.cancelled) throw new UserError('Verbindung beendet.');
      if (!(error instanceof UserError)) {
        const status = this.status(accountId);
        if (['restricted', 'error'].includes(status.state)) throw new UserError(status.message);
        throw new UserError(this.record({ event: 'observation-failed', target: 'local', resource: 'mainFrame' }));
      }
      throw error;
    } finally {
      // A completed/failed observer does not own the user's RSI window.
      options.signal?.removeEventListener('abort', abort);
      try { if (abortCleanup) await abortCleanup; }
      finally {
        if (attempt) {
          this.connecting.delete(accountId);
          if (this.attempts.get(accountId) === attempt) this.attempts.delete(accountId);
          attempt.finish();
        }
      }
    }
  }
  async probe(accountId: string): Promise<ImportCandidate> {
    const win = this.windows.get(accountId);
    if (!win || win.isDestroyed()) throw new UserError('Kein RSI-Fenster geöffnet. Erst manuell anmelden; bei Schutzabfragen Dateiimport verwenden.');
    if (!isPledgesPage(win.webContents.getURL())) {
      if (!allowedRsiNavigation(win.webContents.getURL())) throw new UserError('Keine zugelassene RSI-Anmeldeseite geöffnet.');
      this.frozen.delete(accountId);
      if (this.sessions.get(accountId)?.hideHangar) win.hide();
      await win.loadURL(RSI_HANGAR_URL);
    }
    if (!isPledgesPage(win.webContents.getURL())) throw new UserError('RSI hat noch keine Hangarseite geöffnet. Anmeldung zuerst abschließen.');
    const active = this.sessions.get(accountId);
    if (!active || active.closing) throw new UserError('Verbindung beendet.');
    active.verified = undefined;
    const snapshot = await this.cookies(active.session).catch(() => []);
    const auth = (items: StoredCookie[]) => items.filter(c => isAuthenticationCookieName(c.name))
      .map(c => [c.name, c.domain, c.path, c.value]).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    const raw = await win.webContents.executeJavaScript(RSI_PAGE_PROBE);
    if (!raw || raw.ok !== true) {
      this.frozen.delete(accountId);
      this.statuses.set(accountId, { state: 'login-required', message: 'Anmeldung oder Cookie-Auswahl noch nicht abgeschlossen; kein Bestand importiert.' });
      if (raw?.reason === 'cookie-consent') throw new UserError('Bitte zuerst den Cookie-Hinweis im RSI-Fenster beantworten, zum Beispiel „Use necessary cookies only“. Danach Hangarseite erneut prüfen.');
      throw new UserError('Die Hangarliste ist noch nicht eindeutig lesbar. Kein Bestand übernommen.');
    }
    const startUrl = win.webContents.getURL();
    const checkWindow = () => {
      if (win.isDestroyed() || this.sessions.get(accountId)?.closing || this.stopping || this.attempts.get(accountId)?.cancelled || win.webContents.getURL() !== startUrl || !isPledgesPage(startUrl)) {
        throw new UserError('Seite während der Prüfung gewechselt oder Fenster geschlossen. Keine Übernahme.');
      }
    };
    this.record({ event: 'hangar-observation', target: 'hangar', resource: 'xhr', observation: 'reading-pages' });
    const {candidate,pagesRead}=await readHangarPages({accountId,initial:raw,restartAtFirst:!!new URL(startUrl).search,
      assertActive:checkWindow,loadPage:page=>win.webContents.executeJavaScriptInIsolatedWorld(1, [{ code: rsiFetchPageProbe(page,startUrl) }]),
      onProgress:progress=>this.statuses.set(accountId,{state:'page-ready',progress:{...progress,phase:'reading'},message:progress.waiting
        ? 'RSI benötigt eine Pause. Hangarlesen wird begrenzt erneut versucht.'
        : 'Lese Hangar: '+progress.pledgesRead+' Einträge auf '+progress.pagesRead+' Seiten.'})})
      .catch(error=>{this.record({event:'hangar-observation',target:'hangar',resource:'xhr',observation:'page-read-failed'});this.statuses.set(accountId,{state:'error',message:error instanceof UserError?error.message:'Hangar konnte nicht vollständig gelesen werden.'});throw error;});
    const pageProgress = this.status(accountId).progress;
    const finishing = pageProgress ? { ...pageProgress, phase: 'finishing' as const } : undefined;
    this.statuses.set(accountId, {state:'page-ready',message:'Hangar gelesen. Prüfe ergänzende Daten.',progress:finishing});
    // A missing optional balance does not invalidate inventory or imply zero credits.
    try {
      const csrf: unknown = await win.webContents.executeJavaScriptInIsolatedWorld(1, [{code: CREDIT_CSRF_PROBE}]);
      if (typeof csrf === 'string' && csrf) {
        const cookies = await active.session.cookies.get({url: CREDIT_URL});
        checkWindow();
        const credit = await readStoreCredit(cookies, csrf, this.creditTransport);
        if (credit) candidate.document.storeCredit = credit;
      }
    } catch { /* Keep successful hangar data; no token, URL or response is logged. */ }
    const observeSupplement = (observation: ConnectionEvent['observation']) =>
      this.record({ event: 'hangar-observation', target: 'hangar', resource: 'xhr', observation });
    try {
      const read = await readBuybacks(async page => {
        active.buybackListUrl = buybackPageUrl(page);
        try { return await win.webContents.executeJavaScriptInIsolatedWorld(1, [{ code: buybackFetchProbe(page) }]); }
        finally { active.buybackListUrl = undefined; }
      }, checkWindow, observeSupplement);
      if (read) {
        const withBuybacks = { ...candidate.document, buybacks: read.entries, buybackObservation: read.observation };
        if (Buffer.byteLength(JSON.stringify(withBuybacks)) + 512 < MAX_FILE_BYTES) {
          candidate.document = withBuybacks;
          observeSupplement('buyback-read');
        } else observeSupplement('buyback-size-limit');
      }
    } catch { observeSupplement('buyback-page-unreadable'); }
    checkWindow();
    const identity = candidate.document.account;
    const matchedProfile = identity.identityKind === 'rsi-handle' && this.canRemember(accountId, identity);
    const manualReference = identity.identityKind === 'manual-reference';
    if (hasAuthenticationCookie(snapshot) && (matchedProfile || manualReference)) {
      this.statuses.set(accountId, {state:'page-ready',message:'Bestand gelesen. Prüfe belegte Kaufpreise.',progress:finishing});
      if (manualReference) observeSupplement('purchase-orders-only');
      try {
        const prices = await this.purchaseReader(active.session, candidate.document.pledges,
          manualReference ? null : identity.reference, checkWindow, undefined, observeSupplement);
        const latest = await this.cookies(active.session);
        checkWindow();
        if (!isDeepStrictEqual(auth(snapshot), auth(latest))) observeSupplement('purchase-auth-changed');
        else if (prices.size) {
          const document = { ...candidate.document, pledges: candidate.document.pledges.map(p => {
            const rsiPurchase = prices.get(p.pledgeId);
            return rsiPurchase ? { ...p, rsiPurchase } : p;
          }) };
          if (Buffer.byteLength(JSON.stringify(document)) + 512 < MAX_FILE_BYTES) {
            candidate.document = document;
            observeSupplement([...prices.values()].some(price => price.status === 'documented') ? 'purchase-matched' : 'purchase-no-match');
          }
        } else observeSupplement('purchase-no-match');
      } catch { /* Purchase data is optional and is never included in connection diagnostics. */ }
    }
    checkWindow();
    if ((active.remember || active.background) && hasAuthenticationCookie(snapshot) && matchedProfile) {
      const latest = await this.cookies(active.session);
      checkWindow();
      if (isDeepStrictEqual(auth(snapshot), auth(latest))) active.verified = {identity, cookies: latest};
    }
    this.frozen.add(accountId);
    this.statuses.set(accountId, { state: 'page-ready', message: 'Hangar gelesen. Vorschau vor der lokalen Übernahme prüfen.' });
    this.record({ event: 'hangar-observation', target: 'hangar', resource: 'mainFrame', observation: 'preview-ready' });
    candidate.adapter = 'rsi-dom-probe/1';
    candidate.warnings = [`${pagesRead} Hangarseite(n) gelesen. Ergänzender Import; fehlende alte Gegenstände bleiben erhalten.`,
      ...(candidate.document.account.identityKind === 'manual-reference' ? ['RSI-Handle fehlt auf der Seite. Zuordnung zu diesem lokalen Profil bei jeder Übernahme ausdrücklich bestätigen; die Kontoidentität ist nicht automatisch nachgewiesen.'] : []),
      'Mehrseitenabschluss ist kein unabhängiger Vollständigkeitsnachweis. CCU-Anwendbarkeit bleibt ungeprüft. Kaufpreise hängen vom verfügbaren Beleg ab.', ...candidate.warnings.slice(2)];
    return candidate;
  }
  async close(accountId: string, discard = false) {
    const attempt = this.attempts.get(accountId); if (attempt) attempt.cancelled = true;
    const closing = this.closeSession(accountId, discard || !!attempt);
    if (!attempt) return closing;
    // Also finish a still-running restore before an application exit can terminate it.
    const [result] = await Promise.allSettled([closing, attempt.done]);
    if (result!.status === 'rejected') throw result!.reason;
  }
  private async closeSession(accountId: string, discard = false) {
    const state = this.sessions.get(accountId); if (!state) return;
    if (discard) state.remember = false;
    // Window close, app quit and reopen must all await the same complete save/cleanup.
    if (state.closeTask) return state.closeTask;
    state.closing = true;
    state.closeTask = this.finishClose(accountId, state);
    return state.closeTask;
  }
  private async finishClose(accountId: string, state: RsiSession) {
    this.windows.get(accountId)?.webContents.stop();
    let saved = false;
    if (state.remember && state.verified) {
      try {
        if (this.canRemember(accountId, state.verified.identity)) saved = await this.vault.save(accountId, state.verified.cookies);
        state.failure = null;
      }
      catch { state.failure = 'Sitzung konnte beim Schließen nicht sicher gespeichert werden. Keine Klartext-Ersatzspeicherung.'; }
    }
    const failure = state.failure;
    this.windows.get(accountId)?.destroy();
    await state.session.clearStorageData(); await state.session.clearCache();
    this.sessions.delete(accountId);
    this.statuses.set(accountId, { state: failure ? 'error' : 'closed', message: failure ?? (state.remember ? saved ? 'Anmeldecookies Windows-verschlüsselt gespeichert; Gültigkeit bestimmt RSI.' : 'Keine neue Anmeldung gespeichert.' : 'Fenster geschlossen; flüchtige Sitzung verworfen.') });
    if (failure) throw new UserError(failure);
  }
  async remove(accountId: string) {
    await this.close(accountId, true); await this.vault.remove(accountId);
    this.statuses.set(accountId, { state: 'closed', message: 'Gespeicherte Sitzung gelöscht. Neue RSI-Anmeldung erforderlich.' });
  }
  async shutdown() {
    this.stopping = true;
    const attempts = [...this.attempts.values()];
    for (const attempt of attempts) attempt.cancelled = true;
    const results = await Promise.allSettled([...this.sessions.keys()].map(id => this.close(id)).concat(attempts.map(attempt => attempt.done)));
    return results.every(r => r.status === 'fulfilled');
  }
}
