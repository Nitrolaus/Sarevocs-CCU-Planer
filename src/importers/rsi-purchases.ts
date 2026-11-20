import { BrowserWindow, session, type Session } from 'electron';
import { createHash, randomUUID } from 'node:crypto';
import type { Pledge, RsiPurchase } from '../domain/model';
import { RSI_ORIGIN } from '../main/policy';
import { captureRsiCookie, isAuthenticationCookieName } from '../security/rsi-cookies';
import { purchaseMatches, purchaseParserProbe, purchasePrices, type PurchaseLogRow, type PurchaseOrder } from './rsi-purchase-data';

export const PURCHASE_LOG_URL = RSI_ORIGIN + '/api/account/pledgeLog';
export const purchaseOrdersUrl = (page: number) => RSI_ORIGIN + `/en/account/billing?storefront=2&page=${page}&pagesize=100`;
const MAX_LOG_PAGES = 24;
const MAX_ORDER_PAGES = 3;
export type PurchaseReadProblem = 'purchase-log-unavailable' | 'purchase-orders-unavailable';
const PARSER_URL = 'data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; base-uri \'none\'; form-action \'none\'"><title>Local purchase parser</title>');

async function responseText(response: Response, maxBytes: number) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('PURCHASE_BODY');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0, result = '';
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) return result + decoder.decode();
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) throw new Error('PURCHASE_SIZE');
      result += decoder.decode(chunk.value, { stream: true });
    }
  } finally { await reader.cancel().catch(() => {}); }
}

/** Optional acquisition evidence. Only this no-window partition can issue the fixed POST and GET reads. */
export async function readPurchases(active: Session, pledges: readonly Pledge[], owner: string | null, assertActive: () => void,
  createTransport = () => session.fromPartition('purchase-read-' + randomUUID(), { cache: false }),
  report: (problem: PurchaseReadProblem) => void = () => {}) {
  const ids = pledges.map(p => p.pledgeId).filter(id => /^[1-9]\d{0,19}$/.test(id));
  const empty = new Map<string, RsiPurchase>();
  if (!ids.length) return empty;

  const controller = new AbortController();
  let transport: Session | undefined, parserSession: Session | undefined, parser: BrowserWindow | undefined;
  let approved: { url: string; method: 'GET' | 'POST'; sent: boolean } | undefined;
  const stop = () => {
    controller.abort();
    if (parser && !parser.isDestroyed()) parser.destroy();
  };
  const timer = setTimeout(stop, 14_000);
  let windowChanged = false;
  const watch = setInterval(() => {
    try { assertActive(); }
    catch { windowChanged = true; stop(); }
  }, 250);
  const check = () => {
    assertActive();
    if (controller.signal.aborted) throw new Error('PURCHASE_STOP');
  };

  const log: PurchaseLogRow[] = [], orders: PurchaseOrder[] = [];
  let phase: PurchaseReadProblem = 'purchase-log-unavailable';
  try {
    const scoped = await Promise.all([active.cookies.get({ url: PURCHASE_LOG_URL }), active.cookies.get({ url: purchaseOrdersUrl(1) })]);
    check();
    const cookies = new Map<string, NonNullable<ReturnType<typeof captureRsiCookie>>>();
    for (const cookie of scoped.flat()) {
      if (!isAuthenticationCookieName(cookie.name)) continue;
      const captured = captureRsiCookie(cookie);
      if (captured) cookies.set(JSON.stringify([captured.name, captured.domain, captured.path]), captured);
    }
    const tokens = [...new Set(scoped[0].filter(c => c.name === 'Rsi-Token').map(c => c.value))];
    const token = tokens.length === 1 ? tokens[0] : undefined;
    if (!token || token.length > 65_536 || !/^[\x21-\x7e]+$/.test(token)) { report(phase); return empty; }

    transport = createTransport();
    transport.webRequest.onBeforeRequest((details, callback) => {
      const allowed = !!approved && !approved.sent && !controller.signal.aborted && details.method === approved.method && details.url === approved.url;
      if (allowed) approved!.sent = true;
      callback({ cancel: !allowed });
    });
    transport.webRequest.onBeforeRedirect(stop);
    for (const cookie of cookies.values()) {
      check();
      await transport.cookies.set({ url: 'https://' + cookie.domain.replace(/^\./, '') + cookie.path,
        name: cookie.name, value: cookie.value, path: cookie.path, secure: true, httpOnly: true,
        sameSite: cookie.sameSite, ...(cookie.hostOnly ? {} : { domain: cookie.domain }),
        ...(cookie.expirationDate === undefined ? {} : { expirationDate: cookie.expirationDate }) });
    }
    const read = async (kind: 'log' | 'order', page: number) => {
      check();
      const isLog = kind === 'log';
      const url = isLog ? PURCHASE_LOG_URL : purchaseOrdersUrl(page);
      const method = isLog ? 'POST' : 'GET';
      approved = { url, method, sent: false };
      try {
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(4000)]);
        const response = await transport!.fetch(url, { method, signal, credentials: 'include', cache: 'no-store',
          redirect: 'error', bypassCustomProtocolHandlers: true, headers: isLog ? {
            'Content-Type': 'application/json', 'Accept-Language': 'en', 'X-Rsi-Token': token,
          } : { 'Accept-Language': 'en' }, ...(isLog ? { body: JSON.stringify({ page }) } : {}) });
        check();
        const contentType = response.headers.get('content-type') ?? '';
        const type = isLog ? /^application\/json(?:;|$)/i : /^text\/html(?:;|$)/i;
        if (!response.ok || response.redirected || response.url && response.url !== url || !type.test(contentType)) {
          await response.body?.cancel().catch(() => {});
          throw new Error('PURCHASE_RESPONSE');
        }
        return await responseText(response, isLog ? 512 * 1024 : 4 * 1024 * 1024);
      } finally { approved = undefined; }
    };

    parserSession = session.fromPartition('purchase-parser-' + randomUUID(), { cache: false });
    parserSession.webRequest.onBeforeRequest((request, callback) => callback({ cancel: request.url !== PARSER_URL }));
    parserSession.setPermissionRequestHandler((_contents, _permission, reply) => reply(false));
    parserSession.setPermissionCheckHandler(() => false);
    parserSession.on('will-download', event => event.preventDefault());
    parser = new BrowserWindow({ show: false, webPreferences: { session: parserSession, sandbox: true, contextIsolation: true,
      nodeIntegration: false, devTools: false, spellcheck: false } });
    parser.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    parser.webContents.on('will-navigate', event => event.preventDefault());
    await parser.loadURL(PARSER_URL);
    const parse = async (kind: 'log' | 'order', html: string, wanted: readonly string[]) => {
      check();
      const parsed = await parser!.webContents.executeJavaScriptInIsolatedWorld(1, [{ code: purchaseParserProbe(kind, html, wanted) }]);
      check();
      return parsed;
    };
    const seenPages = new Set<string>();
    // Reserve time for order confirmation even when the private log has many pages.
    const logDeadline = Date.now() + 7500;
    for (let page = 1; page <= MAX_LOG_PAGES && Date.now() < logDeadline; page++) {
      let response;
      try { response = JSON.parse(await read('log', page)); }
      catch { report(phase); break; }
      const rawCount = response?.data?.pagecount;
      const count = typeof rawCount === 'string' && /^\d{1,6}$/.test(rawCount) ? Number(rawCount) : rawCount;
      const html = response?.data?.rendered;
      const succeeded = response?.success === 1 || response?.success === true;
      if (!succeeded || !Number.isInteger(count) || count < page || typeof html !== 'string') {
        if (page === 1 && succeeded && rawCount === undefined && html === undefined) break;
        report(phase); break;
      }
      const fingerprint = createHash('sha256').update(html).digest('hex');
      if (seenPages.has(fingerprint)) break;
      seenPages.add(fingerprint);
      log.push(...await parse('log', html, ids));
      if (page === count) break;
    }
    const evidence = purchaseMatches(pledges, log, owner);
    const wantedOrders = [...new Set([...evidence.matches.values()].map(purchase => purchase.order))];
    phase = 'purchase-orders-unavailable';
    seenPages.clear();
    for (let page = 1; wantedOrders.length && page <= MAX_ORDER_PAGES; page++) {
      const html = await read('order', page);
      const fingerprint = createHash('sha256').update(html).digest('hex');
      if (seenPages.has(fingerprint)) break;
      seenPages.add(fingerprint);
      orders.push(...await parse('order', html, wantedOrders));
      const found = new Set(orders.map(order => order.id));
      if (wantedOrders.every(id => found.has(id))) break;
    }
  } catch { report(phase); }
  finally {
    clearTimeout(timer);
    clearInterval(watch);
    stop();
    const partitions = [transport, parserSession].filter(partition => partition !== undefined);
    const cleaned = await Promise.allSettled(partitions.flatMap(partition => [partition.closeAllConnections(), partition.clearStorageData(), partition.clearCache()]));
    if (cleaned.some(result => result.status === 'rejected')) windowChanged = true;
  }
  assertActive();
  return windowChanged ? empty : purchasePrices(purchaseMatches(pledges, log, owner), orders);
}
