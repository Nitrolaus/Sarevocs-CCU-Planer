import { BrowserWindow, session } from 'electron';
import { randomUUID } from 'node:crypto';
import { cookieSchema, officialCookie, type StoredCookie } from '../security/rsi-cookies';
import { upgradeHistoryRequestSchema, upgradeHistoryResultSchema, unavailableHistory, type UpgradeHistoryResult, type PurchaseHistoryBatch } from '../domain/upgrade-history';
import type { Pledge, RsiPurchase } from '../domain/model';
import { readAppliedCcuPurchases, readPurchaseEvidence } from './rsi-purchases';

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
    const clean = value => (value || '').replace(/\\s+/g, ' ').trim();
    const body = clean(doc.body?.textContent);
    const emptyStatement = /^(?:no upgrades have been applied to this pledge|this pledge has not been upgraded)\\.?$/i;
    if (emptyStatement.test(body) && !doc.querySelector('head > :not(title),body :not(div,span,p,label,br,strong,em),[hidden],[inert],[style],[aria-hidden="true"],.hidden,.hide,.d-none') &&
        [...doc.querySelectorAll('.row')].every(row => clean(row.textContent) === body)) {
      return {status:'loaded',steps:[],partial:false,confirmedEmpty:true};
    }
    const steps = [];
    let partial = rows.length > 128 || [...doc.querySelectorAll('.row')].some(row => !row.querySelector('label'));
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
      if (row.querySelectorAll('span').length !== 1 || (clean(row.textContent).match(/upgrade\\s+applied\\b/gi) || []).length !== 1) partial = true;
      const applied = /^upgrade applied:\\s*(?:#(\\d{1,20})\\s+)?(.+?)\\s*,\\s*new value:\\s*.+$/i.exec(text);
      const offer = applied?.[2] || '';
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
      const ccuPledgeId = applied?.[1];
      steps.push({from,to,appliedAt,...(ccuPledgeId && /^[1-9]/.test(ccuPledgeId) ? {ccuPledgeId} : {})});
    }
    // An empty fragment alone is not an independently proven complete empty history.
    if (!rows.length) partial = true;
    // Detect applied events outside the expected row/label/span even when other rows parsed.
    for (const row of rows) row.remove();
    const remainder = clean(doc.body?.textContent);
    if (/upgrade\\s+applied\\b|new value\\s*:|no upgrades have been applied|has not been upgraded/i.test(remainder)) partial = true;
    steps.reverse();
    for (let i = 1; i < steps.length; i++) {
      if (steps[i-1].to !== steps[i].from) partial = true;
      if (steps[i-1].appliedAt && steps[i].appliedAt && steps[i-1].appliedAt > steps[i].appliedAt) partial = true;
    }
    return {status:'loaded',steps,partial};
  })()`;
}

type PurchaseLookup = { owner: string | null; assertActive: () => void };
type Transfer = { accountId: string; abort: AbortController; timedOut: boolean; redirected?: boolean;
  purchaseLookup?: PurchaseLookup; net?: Electron.Session; parserSession?: Electron.Session; parser?: BrowserWindow };
type Job = Transfer & { key: string; pledgeId: number; task: Promise<UpgradeHistoryResult> };
type BatchJob = Transfer & { revision: string; task: Promise<PurchaseHistoryBatch> };
type Waiter = { job: Job; resolve: (acquired: boolean) => void; remove: () => void };
type PurchaseCandidates = { histories: string[]; bases: Pledge[] };
const emptyBatch = (): PurchaseHistoryBatch => ({ histories: {}, basePurchases: {} });
const compareId = (a: string, b: string) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
function nextCandidates<T>(candidates: readonly T[], id: (value: T) => string, after: string, limit: number) {
  const sorted = [...candidates].sort((a, b) => compareId(id(a), id(b)));
  const next = sorted.findIndex(value => compareId(id(value), after) > 0);
  if (next <= 0) return sorted.slice(0, limit);
  return [...sorted.slice(next), ...sorted.slice(0, next)].slice(0, limit);
}
function withOrderPurchases(history: UpgradeHistoryResult, found: ReadonlyMap<string, RsiPurchase>) {
  const purchases = history.steps.flatMap(({ ccuPledgeId }) => {
    const price = ccuPledgeId && found.get(ccuPledgeId);
    return ccuPledgeId && price && price.status === 'documented' && price.source === 'order' ? [{ ccuPledgeId, price }] : [];
  });
  return upgradeHistoryResultSchema.parse({ ...history, purchases });
}

/** Own ephemeral transport; it never opens RSI, changes the shared policy, or saves a session. */
export class UpgradeHistoryReader {
  private jobs = new Map<string, Job>();
  private cache = new Map<string, UpgradeHistoryResult>();
  private batches = new Map<string, BatchJob>();
  private batchCursors = new Map<string, { history: string; base: string }>();
  private completedBatch?: { accountId: string; revision: string; data: PurchaseHistoryBatch };
  private queue: Waiter[] = [];
  private active = 0;
  private stopping = false;
  private closing = new Set<string>();
  constructor(private loadCookies: (accountId: string) => Promise<StoredCookie[]>,
    private readonly readPurchases = readAppliedCcuPurchases, private readonly readCombined = readPurchaseEvidence) {}

  read(accountId: string, pledgeId: number, revisionKey: string, purchaseLookup?: PurchaseLookup): Promise<UpgradeHistoryResult> {
    if (!upgradeHistoryRequestSchema.safeParse({ accountId, pledgeId, revisionKey }).success) return Promise.resolve(unavailableHistory('unavailable'));
    if (this.stopping || this.closing.has(accountId)) return Promise.resolve(unavailableHistory('cancelled'));
    const key = `${accountId}:${pledgeId}:${revisionKey}${purchaseLookup ? ':orders' : ''}`;
    const cached = this.cache.get(key);
    if (cached) return Promise.resolve(structuredClone(cached));
    const pending = this.jobs.get(key);
    if (pending) return pending.task.then(result => structuredClone(result));
    if (this.jobs.size >= MAX_ACTIVE + MAX_QUEUED) return Promise.resolve(unavailableHistory('unavailable'));
    const job: Job = { accountId, pledgeId, key, purchaseLookup, abort: new AbortController(), timedOut: false,
      task: Promise.resolve(unavailableHistory('cancelled')) };
    // Registration precedes the first await and the cookie-loader invocation.
    this.jobs.set(key, job);
    job.task = Promise.resolve().then(() => this.run(job)).finally(() => this.jobs.delete(key));
    return job.task.then(result => structuredClone(result));
  }
  private cancelled(job: Transfer) { return this.stopping || this.closing.has(job.accountId) || job.abort.signal.aborted; }
  private check(job: Transfer) {
    if (this.cancelled(job)) throw new Error('HISTORY_STOP');
    job.purchaseLookup?.assertActive();
  }
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
  private async openTransport(job: Transfer) {
    this.check(job);
    const stored = await this.loadCookies(job.accountId);
    this.check(job);
    if (!Array.isArray(stored) || stored.length > 500) throw Error('HISTORY_COOKIES');
    const parsed = cookieSchema.array().safeParse(stored);
    if (!parsed.success || parsed.data.some(cookie => !officialCookie(cookie))) throw Error('HISTORY_COOKIES');
    const net = job.net = this.secureSession('upgrade-history-net-');
    let armed = false;
    net.webRequest.onBeforeRequest((details, callback) => {
      let allowed = false;
      try {
        this.check(job);
        allowed = armed && details.url === UPGRADE_HISTORY_URL && details.method === 'POST';
      } catch { /* A changed context revokes the read before dispatch. */ }
      if (allowed) armed = false;
      callback({ cancel: !allowed });
    });
    net.webRequest.onBeforeRedirect(() => { job.redirected = true; this.stop(job); });
    for (const cookie of parsed.data) {
      this.check(job);
      await net.cookies.set({ url: 'https://' + cookie.domain.replace(/^\./, '') + cookie.path,
        name: cookie.name, value: cookie.value, path: cookie.path, secure: true, httpOnly: cookie.httpOnly,
        sameSite: cookie.sameSite, ...(cookie.hostOnly ? {} : { domain: cookie.domain }),
        ...(cookie.expirationDate === undefined ? {} : { expirationDate: cookie.expirationDate }) });
    }
    this.check(job);
    const scoped = await net.cookies.get({ url: UPGRADE_HISTORY_URL, name: 'Rsi-Token' });
    this.check(job);
    const values = [...new Set(scoped.map(cookie => cookie.value).filter(Boolean))];
    if (values.length !== 1) return null;
    return { net, history: async (pledgeId: number) => {
      this.check(job);
      armed = true;
      const timer = setTimeout(() => { job.timedOut = true; this.stop(job); }, REQUEST_TIMEOUT_MS);
      try {
        const response = await net.fetch(UPGRADE_HISTORY_URL, { method: 'POST', redirect: 'error', credentials: 'include',
          cache: 'no-store', signal: job.abort.signal, bypassCustomProtocolHandlers: true,
          headers: { 'Content-Type': 'application/json', 'Accept-Language': 'en', 'X-Rsi-Token': values[0]! },
          body: JSON.stringify({ pledge_id: pledgeId }) });
        this.check(job);
        if ([401, 403].includes(response.status)) return unavailableHistory('auth-required');
        // Session.fetch can omit Response.url. The one-shot wire guard fixes method and URL independently.
        if (!response.ok || response.redirected || response.url && response.url !== UPGRADE_HISTORY_URL ||
            !/^application\/json(?:;|$)/i.test(response.headers.get('content-type') || '')) return unavailableHistory('unavailable');
        const length = response.headers.get('content-length');
        if (length && (!/^\d+$/.test(length) || Number(length) > MAX_UPGRADE_HISTORY_BYTES)) return unavailableHistory('unavailable');
        const reader = response.body?.getReader();
        if (!reader) return unavailableHistory('unavailable');
        const decoder = new TextDecoder('utf-8', { fatal: true });
        let bytes = 0, text = '';
        try {
          while (true) {
            const chunk = await reader.read(); this.check(job);
            if (chunk.done) break;
            bytes += chunk.value.byteLength;
            if (bytes > MAX_UPGRADE_HISTORY_BYTES) throw Error('HISTORY_SIZE');
            text += decoder.decode(chunk.value, { stream: true });
          }
          text += decoder.decode();
        } finally { await reader.cancel().catch(() => {}); }
        const raw: unknown = JSON.parse(text);
        if (!raw || typeof raw !== 'object' || !('success' in raw) || raw.success !== 1 || !('data' in raw) ||
            !raw.data || typeof raw.data !== 'object' || !('rendered' in raw.data) || typeof raw.data.rendered !== 'string') return unavailableHistory('unavailable');
        if (!job.parser) await this.openParser(job);
        this.check(job);
        const output: unknown = await job.parser!.webContents.executeJavaScript(historyParserProbe(raw.data.rendered));
        this.check(job);
        return upgradeHistoryResultSchema.parse(output);
      } finally { armed = false; clearTimeout(timer); }
    } };
  }
  private async openParser(job: Transfer) {
    const parserSession = job.parserSession = this.secureSession('upgrade-history-parser-');
    let localLoaded = false;
    parserSession.webRequest.onBeforeRequest((details, callback) => {
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
  }
  private stop(job: Transfer) {
    job.abort.abort();
    if (job.parser && !job.parser.isDestroyed()) job.parser.destroy();
  }
  private async cleanup(job: Transfer): Promise<boolean> {
    this.stop(job);
    const cleanup = await Promise.allSettled([job.net, job.parserSession].filter((value): value is Electron.Session => !!value).map(async isolated => {
      const closed = await Promise.allSettled([isolated.closeAllConnections()]);
      const cleared = await Promise.allSettled([isolated.clearStorageData(), isolated.clearCache()]);
      if ([...closed, ...cleared].some(value => value.status === 'rejected')) throw Error('HISTORY_CLEANUP');
    }));
    return cleanup.every(value => value.status === 'fulfilled');
  }
  private async run(job: Job): Promise<UpgradeHistoryResult> {
    if (!await this.acquire(job)) return unavailableHistory('cancelled');
    let result = unavailableHistory('unavailable');
    try {
      const transport = await this.openTransport(job);
      result = transport ? await transport.history(job.pledgeId) : unavailableHistory('auth-required');
      if (transport && result.status === 'loaded' && job.purchaseLookup) {
        if (job.parser && !job.parser.isDestroyed()) job.parser.destroy();
        const found = await this.readPurchases(transport.net, result.steps, job.purchaseLookup.owner, () => this.check(job));
        this.check(job);
        result = withOrderPurchases(result, found);
      }
    } catch { result = unavailableHistory(job.timedOut || job.redirected ? 'unavailable' : this.cancelled(job) ? 'cancelled' : 'unavailable'); }
    finally { if (!await this.cleanup(job)) result = unavailableHistory('unavailable'); this.release(); }
    if (this.stopping || this.closing.has(job.accountId)) return unavailableHistory('cancelled');
    if (result.status === 'loaded' && !job.purchaseLookup) {
      if (this.cache.size >= MAX_CACHE) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(job.key, structuredClone(result));
    }
    return result;
  }

  async readBatch(accountId: string, revision: string, candidates: PurchaseCandidates, lookup: PurchaseLookup): Promise<PurchaseHistoryBatch> {
    if (!upgradeHistoryRequestSchema.shape.accountId.safeParse(accountId).success ||
        !upgradeHistoryRequestSchema.shape.revisionKey.safeParse(revision).success || !lookup.owner || this.stopping || this.closing.has(accountId)) return emptyBatch();
    try { lookup.assertActive(); } catch { return emptyBatch(); }
    if (this.completedBatch?.accountId === accountId && this.completedBatch.revision === revision) return this.completedBatch.data;
    const previous = this.batches.get(accountId);
    if (previous?.revision === revision) return previous.task;
    if (previous) this.stop(previous);
    const job: BatchJob = { accountId, revision, purchaseLookup: lookup, abort: new AbortController(), timedOut: false, task: Promise.resolve(emptyBatch()) };
    this.batches.set(accountId, job);
    job.task = (async () => {
      if (previous) await previous.task;
      return this.runBatch(job, candidates);
    })().finally(() => { if (this.batches.get(accountId) === job) this.batches.delete(accountId); });
    return job.task;
  }
  private async runBatch(job: BatchJob, candidates: PurchaseCandidates): Promise<PurchaseHistoryBatch> {
    const cursor = this.batchCursors.get(job.accountId) ?? { history: '', base: '' };
    const histories = nextCandidates(candidates.histories, id => id, cursor.history, 256);
    const bases = nextCandidates(candidates.bases, pledge => pledge.pledgeId, cursor.base, 4096);
    if (!histories.length && !bases.length) return emptyBatch();
    let output = emptyBatch(), completed = false;
    try {
      const transport = await this.openTransport(job);
      if (!transport) return output;
      const deadline = Date.now() + 90_000;
      let failures = 0;
      for (const id of histories) {
        this.check(job);
        if (Date.now() >= deadline) break;
        cursor.history = id;
        const history = await transport.history(Number(id));
        if (history.status === 'auth-required') return emptyBatch();
        if (history.status !== 'loaded') { if (++failures >= 2) break; continue; }
        failures = 0;
        if (history.confirmedEmpty || history.steps.length) output.histories[id] = history;
      }
      if (job.parser && !job.parser.isDestroyed()) job.parser.destroy();
      this.check(job);
      const entries = Object.entries(output.histories);
      // Include partial rows for duplicate-ID detection. A single purchased CCU cannot belong to two ships.
      const steps = entries.flatMap(([, result]) => result.steps);
      const { bases: receipts, applied } = await this.readCombined(transport.net, bases, steps, job.purchaseLookup!.owner, () => this.check(job));
      this.check(job);
      if (bases.length) cursor.base = bases.at(-1)!.pledgeId;
      const baseIds = new Set(bases.map(pledge => pledge.pledgeId));
      for (const [id, price] of receipts) {
        if (baseIds.has(id) && price.status === 'documented' && price.source === 'order') output.basePurchases[id] = price;
      }
      for (const [id, history] of entries) if (history.steps.length) output.histories[id] = withOrderPurchases(history, applied);
      completed = true;
    } catch { output = emptyBatch(); }
    finally {
      if (!await this.cleanup(job)) { completed = false; output = emptyBatch(); }
      if (this.batchCursors.size >= 32 && !this.batchCursors.has(job.accountId)) this.batchCursors.delete(this.batchCursors.keys().next().value!);
      this.batchCursors.set(job.accountId, cursor);
    }
    if (completed && !this.stopping && this.batches.get(job.accountId) === job && !this.closing.has(job.accountId)) {
      try { job.purchaseLookup!.assertActive(); } catch { return emptyBatch(); }
      this.completedBatch = { accountId: job.accountId, revision: job.revision, data: output };
      return output;
    }
    return emptyBatch();
  }
  async close(accountId: string): Promise<void> {
    if (!upgradeHistoryRequestSchema.shape.accountId.safeParse(accountId).success) return;
    this.closing.add(accountId);
    try {
      const pending = [...this.jobs.values(), ...this.batches.values()].filter(job => job.accountId === accountId);
      for (const job of pending) this.stop(job);
      for (const key of this.cache.keys()) if (key.startsWith(accountId + ':')) this.cache.delete(key);
      if (this.completedBatch?.accountId === accountId) this.completedBatch = undefined;
      await Promise.allSettled(pending.map(job => job.task));
    } finally { this.closing.delete(accountId); }
  }
  async shutdown(): Promise<void> {
    this.stopping = true;
    const pending = [...this.jobs.values(), ...this.batches.values()];
    for (const job of pending) this.stop(job);
    this.cache.clear();
    this.completedBatch = undefined;
    await Promise.allSettled(pending.map(job => job.task));
  }
}
