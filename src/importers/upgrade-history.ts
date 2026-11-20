import { BrowserWindow, session } from 'electron';
import { randomUUID } from 'node:crypto';
import { cookieSchema, officialCookie, type StoredCookie } from '../security/rsi-cookies';
import { upgradeHistoryRequestSchema, upgradeHistoryResultSchema, unavailableHistory, type UpgradeHistoryResult } from '../domain/upgrade-history';

const ORIGIN = 'https://robertsspaceindustries.com';
export const UPGRADE_HISTORY_URL = ORIGIN + '/api/account/upgradeLog';
export const MAX_UPGRADE_HISTORY_BYTES = 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15000;
const MAX_ACTIVE = 2, MAX_QUEUED = 8, MAX_CACHE = 128;
const PARSER_URL = 'data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; base-uri \'none\'; form-action \'none\'"><title>Local history parser</title>');

// Authored parser only. Remote HTML is supplied as a string to inert DOMParser, never loaded.
export function historyParserProbe(html: string): string {
  if (typeof html !== 'string' || Buffer.byteLength(html, 'utf8') > MAX_UPGRADE_HISTORY_BYTES) throw new Error('HISTORY_SIZE');
  return `(() => {
    const doc = new DOMParser().parseFromString(${JSON.stringify(html)}, 'text/html');
    if (doc.querySelector('input[type="password"]') || /You must be authenticated to reach this area/i.test(doc.body?.textContent || '')) return {status:'auth-required',steps:[],partial:false};
    const rows = [...doc.querySelectorAll('.row label')];
    const steps = []; let partial = rows.length > 128;
    const clean = value => (value || '').replace(/\\s+/g, ' ').trim();
    const safe = value => !!value && value.length <= 200 && !/[\\u0000-\\u001f\\u007f\\u202a-\\u202e\\u2066-\\u2069]/u.test(value);
    const date = text => {
      const m = /^([a-z]{3})[a-z]*\\.?\\s+(\\d{1,2}),?\\s+(\\d{4}),?\\s+(\\d{1,2}):(\\d{2})\\s*([ap]m)$/i.exec(text);
      if (!m) return null;
      const month = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(m[1].toLowerCase()) + 1;
      const day = Number(m[2]), year = Number(m[3]), hour = Number(m[4]), minute = Number(m[5]);
      const check = new Date(Date.UTC(year, month - 1, day));
      if (!month || year < 1900 || hour < 1 || hour > 12 || minute > 59 || check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
      return year + '-' + String(month).padStart(2,'0') + '-' + String(day).padStart(2,'0') + ' ' + String(hour % 12 + (m[6].toLowerCase() === 'pm' ? 12 : 0)).padStart(2,'0') + ':' + String(minute).padStart(2,'0');
    };
    for (const row of rows.slice(0, 128)) {
      const text = clean(row.querySelector('span')?.textContent);
      const applied = /^upgrade applied:\\s*(?:#\\d{1,20}\\s+)?(.+?)\\s*,\\s*new value:\\s*.+$/i.exec(text);
      const offer = applied?.[1] || '';
      // Old applied-CCU names end in "Upgrade" instead of starting with "Upgrade -".
      // Never reinterpret a malformed modern offer through the legacy branch, and do not
      // strip an "Upgrade" word from a modern target's actual name.
      const modern = /^upgrade\\s*-/i.test(offer);
      const separators = (offer.match(/(?=\\s+to\\s+)/gi) || []).length;
      const match = applied && separators === 1 && (modern
        ? /^upgrade\\s*-\\s*(.+?)\\s+to\\s+(.+?)(?:\\s+(?:standard|warbond)(?:\\s+(?:edition|upgrade))?)?$/i.exec(offer)
        : /^(.+?)\\s+to\\s+(.+?)\\s+upgrade$/i.exec(offer));
      if (!match) { partial = true; continue; }
      const from = clean(match[1]), to = clean(match[2]);
      if (!safe(from) || !safe(to) || /\\s+to\\s+/i.test(from) || /\\s+to\\s+/i.test(to) || from === to) { partial = true; continue; }
      const appliedAt = date(clean(row.firstChild?.textContent));
      if (appliedAt === null) partial = true;
      steps.push({from,to,appliedAt});
    }
    // An empty fragment alone is not an independently proven complete empty history.
    if (!rows.length) partial = true;
    steps.reverse();
    for (let i = 1; i < steps.length; i++) {
      if (steps[i-1].to !== steps[i].from) partial = true;
      if (steps[i-1].appliedAt && steps[i].appliedAt && steps[i-1].appliedAt > steps[i].appliedAt) partial = true;
    }
    return {status:'loaded',steps,partial};
  })()`;
}

type Job = { accountId: string; key: string; pledgeId: number; abort: AbortController; timedOut: boolean; redirected?: boolean;
  task: Promise<UpgradeHistoryResult>; net?: Electron.Session; parserSession?: Electron.Session; parser?: BrowserWindow };
type Waiter = { job: Job; resolve: (acquired: boolean) => void; remove: () => void };

/** Own ephemeral transport; it never opens RSI, changes the shared policy, or saves a session. */
export class UpgradeHistoryReader {
  private jobs = new Map<string, Job>();
  private cache = new Map<string, UpgradeHistoryResult>();
  private queue: Waiter[] = [];
  private active = 0;
  private stopping = false;
  private closing = new Set<string>();
  constructor(private loadCookies: (accountId: string) => Promise<StoredCookie[]>) {}

  read(accountId: string, pledgeId: number, revisionKey: string): Promise<UpgradeHistoryResult> {
    if (!upgradeHistoryRequestSchema.safeParse({ accountId, pledgeId, revisionKey }).success) return Promise.resolve(unavailableHistory('unavailable'));
    if (this.stopping || this.closing.has(accountId)) return Promise.resolve(unavailableHistory('cancelled'));
    const key = `${accountId}:${pledgeId}:${revisionKey}`;
    const cached = this.cache.get(key);
    if (cached) return Promise.resolve(structuredClone(cached));
    const pending = this.jobs.get(key);
    if (pending) return pending.task.then(result => structuredClone(result));
    if (this.jobs.size >= MAX_ACTIVE + MAX_QUEUED) return Promise.resolve(unavailableHistory('unavailable'));
    const job: Job = { accountId, pledgeId, key, abort: new AbortController(), timedOut: false, task: Promise.resolve(unavailableHistory('cancelled')) };
    // Registration precedes the first await and the cookie-loader invocation.
    this.jobs.set(key, job);
    job.task = Promise.resolve().then(() => this.run(job)).finally(() => this.jobs.delete(key));
    return job.task.then(result => structuredClone(result));
  }
  private cancelled(job: Job) { return this.stopping || this.closing.has(job.accountId) || job.abort.signal.aborted; }
  private check(job: Job) { if (this.cancelled(job)) throw new Error('HISTORY_STOP'); }
  private acquire(job: Job): Promise<boolean> {
    if (this.cancelled(job)) return Promise.resolve(false);
    if (this.active < MAX_ACTIVE) { this.active++; return Promise.resolve(true); }
    return new Promise(resolve => {
      const abort = () => { const i = this.queue.indexOf(waiter); if (i >= 0) this.queue.splice(i, 1); waiter.remove(); resolve(false); };
      const waiter: Waiter = { job, resolve, remove: () => job.abort.signal.removeEventListener('abort', abort) };
      this.queue.push(waiter); job.abort.signal.addEventListener('abort', abort, { once: true });
    });
  }
  private release() {
    this.active--;
    while (this.active < MAX_ACTIVE && this.queue.length) {
      const next = this.queue.shift()!; next.remove();
      if (this.cancelled(next.job)) next.resolve(false);
      else { this.active++; next.resolve(true); }
    }
  }
  private secureSession(prefix: string) {
    const isolated = session.fromPartition(prefix + randomUUID(), { cache: false });
    isolated.setPermissionCheckHandler(() => false);
    isolated.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    isolated.setDevicePermissionHandler(() => false);
    isolated.on('will-download', event => event.preventDefault());
    return isolated;
  }
  private async run(job: Job): Promise<UpgradeHistoryResult> {
    const acquired = await this.acquire(job);
    if (!acquired) return unavailableHistory('cancelled');
    let result = unavailableHistory('unavailable'), timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const perform = async (): Promise<UpgradeHistoryResult> => {
      this.check(job);
      let cookies = await this.loadCookies(job.accountId);
      this.check(job);
      if (!Array.isArray(cookies) || cookies.length > 500) return unavailableHistory('unavailable');
      const parsed = cookieSchema.array().safeParse(cookies);
      if (!parsed.success || parsed.data.some(cookie => !officialCookie(cookie))) return unavailableHistory('unavailable');
      cookies = parsed.data;
      const net = job.net = this.secureSession('upgrade-history-net-');
      let dispatched = false;
      net.webRequest.onBeforeRequest((details, callback) => {
        const allowed = !this.cancelled(job) && !dispatched && details.url === UPGRADE_HISTORY_URL && details.method === 'POST';
        if (allowed) dispatched = true;
        callback({ cancel: !allowed });
      });
      net.webRequest.onBeforeRedirect(() => { job.redirected = true; job.abort.abort(); });
      for (const cookie of cookies) {
        this.check(job);
        await net.cookies.set({ url: 'https://' + cookie.domain.replace(/^\./, '') + cookie.path,
          name: cookie.name, value: cookie.value, path: cookie.path, secure: true, httpOnly: cookie.httpOnly,
          sameSite: cookie.sameSite, ...(cookie.hostOnly ? {} : { domain: cookie.domain }),
          ...(cookie.expirationDate === undefined ? {} : { expirationDate: cookie.expirationDate }) });
      }
      cookies = [];
      this.check(job);
      const scoped = await net.cookies.get({ url: UPGRADE_HISTORY_URL, name: 'Rsi-Token' });
      this.check(job);
      const values = [...new Set(scoped.map(cookie => cookie.value).filter(Boolean))];
      if (values.length !== 1) return unavailableHistory('auth-required');
      timer = setTimeout(() => { job.timedOut = true; job.abort.abort(); if (job.parser && !job.parser.isDestroyed()) job.parser.destroy(); }, REQUEST_TIMEOUT_MS);
      const response = await net.fetch(UPGRADE_HISTORY_URL, { method: 'POST', redirect: 'error', credentials: 'include',
        cache: 'no-store', signal: job.abort.signal, bypassCustomProtocolHandlers: true,
        headers: { 'Content-Type': 'application/json', 'Accept-Language': 'en', 'X-Rsi-Token': values[0]! },
        body: JSON.stringify({ pledge_id: job.pledgeId }) });
      this.check(job);
      if ([401, 403].includes(response.status)) return unavailableHistory('auth-required');
      // Electron Session.fetch may return an empty Response.url. The transport guard above
      // admits exactly one fixed request; redirects are independently rejected and aborted.
      if (!response.ok || response.redirected || (response.url && response.url !== UPGRADE_HISTORY_URL) || !/^application\/json(?:;|$)/i.test(response.headers.get('content-type') || '')) return unavailableHistory('unavailable');
      const length = response.headers.get('content-length');
      if (length && (!/^\d+$/.test(length) || Number(length) > MAX_UPGRADE_HISTORY_BYTES)) return unavailableHistory('unavailable');
      const reader = response.body?.getReader();
      if (!reader) return unavailableHistory('unavailable');
      const decoder = new TextDecoder('utf-8', { fatal: true }); let bytes = 0, text = '';
      try {
        while (true) {
          const chunk = await reader.read(); this.check(job);
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > MAX_UPGRADE_HISTORY_BYTES) throw new Error('HISTORY_SIZE');
          text += decoder.decode(chunk.value, { stream: true });
        }
        text += decoder.decode();
      } finally { await reader.cancel().catch(() => {}); }
      const raw: unknown = JSON.parse(text); text = '';
      if (!raw || typeof raw !== 'object' || !('success' in raw) || raw.success !== 1 || !('data' in raw) || !raw.data || typeof raw.data !== 'object' || !('rendered' in raw.data) || typeof raw.data.rendered !== 'string') return unavailableHistory('unavailable');
      this.check(job);
      const parserSession = job.parserSession = this.secureSession('upgrade-history-parser-');
      let localLoaded = false;
      parserSession.webRequest.onBeforeRequest((details, callback) => {
        // Only this authored in-memory document can load; no network resource is admitted.
        const allowed = !localLoaded && !this.cancelled(job) && details.url === PARSER_URL && details.method === 'GET' && details.resourceType === 'mainFrame';
        if (allowed) localLoaded = true;
        callback({ cancel: !allowed });
      });
      const parser = job.parser = new BrowserWindow({ show: false, skipTaskbar: true, webPreferences: {
        session: parserSession, sandbox: true, nodeIntegration: false, contextIsolation: true,
        webSecurity: true, disableDialogs: true, v8CacheOptions: 'none', backgroundThrottling: false,
      } });
      parser.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      parser.webContents.on('will-navigate', event => event.preventDefault());
      parser.webContents.on('will-redirect', event => event.preventDefault());
      await parser.loadURL(PARSER_URL);
      this.check(job);
      const output: unknown = await parser.webContents.executeJavaScript(historyParserProbe(raw.data.rendered));
      this.check(job);
      return upgradeHistoryResultSchema.parse(output);
      };
      result = await perform();
    } catch { result = unavailableHistory(job.timedOut || job.redirected ? 'unavailable' : this.cancelled(job) ? 'cancelled' : 'unavailable'); }
    finally {
      clearTimeout(timer); job.abort.abort();
      if (job.parser && !job.parser.isDestroyed()) job.parser.destroy();
      const cleanup = await Promise.allSettled([job.net, job.parserSession].filter((value): value is Electron.Session => !!value).map(async isolated => {
        const closed = await Promise.allSettled([isolated.closeAllConnections()]);
        // Always attempt both data erasures, even when a connection cleanup failed.
        const cleared = await Promise.allSettled([isolated.clearStorageData(), isolated.clearCache()]);
        if ([...closed, ...cleared].some(value => value.status === 'rejected')) throw new Error('HISTORY_CLEANUP');
      }));
      if (cleanup.some(value => value.status === 'rejected')) result = unavailableHistory('unavailable');
      this.release();
    }
    if (this.stopping || this.closing.has(job.accountId)) return unavailableHistory('cancelled');
    if (result.status === 'loaded') {
      if (this.cache.size >= MAX_CACHE) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(job.key, structuredClone(result));
    }
    return result;
  }
  async close(accountId: string): Promise<void> {
    if (!upgradeHistoryRequestSchema.shape.accountId.safeParse(accountId).success) return;
    this.closing.add(accountId);
    try {
      const pending = [...this.jobs.values()].filter(job => job.accountId === accountId);
      for (const job of pending) { job.abort.abort(); if (job.parser && !job.parser.isDestroyed()) job.parser.destroy(); }
      for (const key of this.cache.keys()) if (key.startsWith(accountId + ':')) this.cache.delete(key);
      await Promise.allSettled(pending.map(job => job.task));
    } finally { this.closing.delete(accountId); }
  }
  async shutdown(): Promise<void> {
    this.stopping = true;
    const pending = [...this.jobs.values()];
    for (const job of pending) { job.abort.abort(); if (job.parser && !job.parser.isDestroyed()) job.parser.destroy(); }
    this.cache.clear();
    await Promise.allSettled(pending.map(job => job.task));
  }
}
