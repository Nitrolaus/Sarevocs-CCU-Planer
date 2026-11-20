import type { Session } from 'electron';
import { parseStoreCredit } from '../domain/store-credit';
import { captureRsiCookie, type CookieInput } from '../security/rsi-cookies';

export const CREDIT_URL = 'https://robertsspaceindustries.com/graphql';
export const CREDIT_QUERY = 'query PlannerStoreCredit { customer { ledger(ledgerCode: "credit") { amount { value currency { code } } } } }';
export const CREDIT_BODY = JSON.stringify([{ operationName: 'PlannerStoreCredit', variables: {}, query: CREDIT_QUERY }]);
export const CREDIT_CSRF_PROBE = "document.querySelector('meta[name=\"csrf-token\"]')?.getAttribute('content') ?? null";

/** Only the main process uses these headers. This in-memory partition never hosts web content. */
export async function readStoreCredit(scoped: CookieInput[], csrf: string, createPartition: () => Promise<Session>) {
  const headerSafe = (value: string) => value.length > 0 && value.length <= 65536 && /^[\x21-\x7e]+$/.test(value);
  if (!headerSafe(csrf)) return null;
  const cookies = scoped.map(captureRsiCookie).filter(c => c !== null);
  const tokens = [...new Set(cookies.filter(c => c.name === 'Rsi-Token').map(c => c.value))];
  if (tokens.length !== 1 || !headerSafe(tokens[0]!)) return null;
  const transport = await createPartition();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    let dispatched = false;
    transport.webRequest.onBeforeRequest((request, callback) => {
      const allow = !dispatched && !controller.signal.aborted && request.method === 'POST' && request.url === CREDIT_URL;
      if (allow) dispatched = true;
      callback({ cancel: !allow });
    });
    transport.webRequest.onBeforeRedirect(() => controller.abort());
    for (const c of cookies) {
      await transport.cookies.set({url: CREDIT_URL, name: c.name, value: c.value, path: c.path, secure: true, httpOnly: true,
        sameSite: c.sameSite, ...(c.hostOnly ? {} : {domain: c.domain})});
    }
    const response = await transport.fetch(CREDIT_URL, { method: 'POST', body: CREDIT_BODY, credentials: 'include',
      cache: 'no-store', signal: controller.signal, redirect: 'error', bypassCustomProtocolHandlers: true,
      headers: {'content-type': 'application/json', origin: 'https://robertsspaceindustries.com', 'x-rsi-token': tokens[0]!, 'x-csrf-token': csrf} });
    if (!response.ok || response.redirected || response.url && response.url !== CREDIT_URL
      || !/^application\/json(?:;|$)/i.test(response.headers.get('content-type') ?? '') || !response.body) return null;
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let length = 0;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        length += chunk.value.length;
        if (length > 16384) return null;
        chunks.push(Buffer.from(chunk.value));
      }
      return parseStoreCredit(JSON.parse(Buffer.concat(chunks).toString('utf8')), new Date().toISOString());
    } finally { await reader.cancel().catch(() => {}); }
  } catch { return null; }
  finally {
    clearTimeout(timeout);
    controller.abort();
    await transport.clearStorageData();
  }
}
