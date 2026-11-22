import { BrowserWindow, session } from 'electron';
import { randomUUID } from 'node:crypto';
import { RSI_ORIGIN } from '../main/policy';
import { officialCookie, isAuthenticationCookieName, type StoredCookie } from '../security/rsi-cookies';
import type { ConciergeRank, PledgeTotal } from '../domain/concierge';
import { conciergePageProbe } from './rsi-concierge-data';

const PARSER_URL = 'data:text/html,' + encodeURIComponent(
  '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; base-uri \'none\'; form-action \'none\'">',
);
const MAX_BYTES = 2 * 1024 * 1024;
export const CONCIERGE_URL = RSI_ORIGIN + '/en/account/concierge';
export const PLEDGE_TOTAL_URL = RSI_ORIGIN + '/en/account/billing';

async function readHtml(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('CONCIERGE_NO_BODY');
  let bytes = 0;
  let html = '';
  const decoder = new TextDecoder('utf-8', { fatal: true });
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) return html + decoder.decode();
      bytes += chunk.value.byteLength;
      if (bytes > MAX_BYTES) throw new Error('CONCIERGE_RESPONSE_SIZE');
      html += decoder.decode(chunk.value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

class ConciergeRequest {
  private readonly io = session.fromPartition('concierge-read-' + randomUUID(), { cache: false });
  private parser?: BrowserWindow;
  private parserSession?: Electron.Session;

  async read<T extends 'rank' | 'total'>(mode: T, cookies: readonly StoredCookie[], signal: AbortSignal) {
    const url = mode === 'rank' ? CONCIERGE_URL : PLEDGE_TOTAL_URL;
    let issued = false;
    this.io.webRequest.onBeforeRequest((details, complete) => {
      const allowed = !issued && !signal.aborted && details.method === 'GET' && details.url === url;
      if (allowed) issued = true;
      complete({ cancel: !allowed });
    });
    const auth = cookies.filter(cookie => officialCookie(cookie) && isAuthenticationCookieName(cookie.name) &&
      cookie.domain.replace(/^\./, '') === 'robertsspaceindustries.com');
    if (!auth.length) return { status: 'unavailable' } as const;
    for (const cookie of auth) {
      signal.throwIfAborted();
      await this.io.cookies.set({ url: RSI_ORIGIN + '/', name: cookie.name, value: cookie.value,
        path: cookie.path, domain: cookie.hostOnly ? undefined : cookie.domain, secure: true,
        httpOnly: cookie.httpOnly, expirationDate: cookie.expirationDate, sameSite: cookie.sameSite });
    }
    const response = await this.io.fetch(url, { method: 'GET', credentials: 'include', redirect: 'error',
      bypassCustomProtocolHandlers: true, signal });
    if (!response.ok || !/^text\/html\b/i.test(response.headers.get('content-type') ?? '')) {
      await response.body?.cancel().catch(() => {});
      return { status: 'unavailable' } as const;
    }
    const html = await readHtml(response);
    signal.throwIfAborted();
    this.parserSession = session.fromPartition('concierge-parser-' + randomUUID(), { cache: false });
    this.parserSession.webRequest.onBeforeRequest((details, complete) => complete({ cancel: details.url !== PARSER_URL }));
    this.parserSession.setPermissionRequestHandler((_contents, _permission, reply) => reply(false));
    this.parserSession.setPermissionCheckHandler(() => false);
    this.parser = new BrowserWindow({ show: false, webPreferences: { session: this.parserSession, sandbox: true,
      nodeIntegration: false, contextIsolation: true, devTools: false, disableDialogs: true } });
    this.parser.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    const close = () => { if (this.parser && !this.parser.isDestroyed()) this.parser.destroy(); };
    signal.addEventListener('abort', close, { once: true });
    try {
      await this.parser.loadURL(PARSER_URL);
      const result = await this.parser.webContents.executeJavaScript(conciergePageProbe(html, mode));
      signal.throwIfAborted();
      return result as T extends 'rank' ? ConciergeRank : PledgeTotal;
    } finally { signal.removeEventListener('abort', close); }
  }

  async close() {
    if (this.parser && !this.parser.isDestroyed()) this.parser.destroy();
    await Promise.allSettled([
      this.io.clearStorageData(), this.io.closeAllConnections(), this.parserSession?.closeAllConnections(),
    ]);
  }
}

export async function readConcierge<T extends 'rank' | 'total'>(mode: T, cookies: readonly StoredCookie[], signal: AbortSignal) {
  if (signal.aborted) return { status: 'unavailable' } as const;
  const request = new ConciergeRequest();
  try {
    return await request.read(mode, cookies, AbortSignal.any([signal, AbortSignal.timeout(12_000)]));
  } catch {
    return { status: 'unavailable' } as const;
  } finally {
    await request.close();
  }
}
