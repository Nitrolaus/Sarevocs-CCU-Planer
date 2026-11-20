import { net, session } from 'electron';
import { randomUUID } from 'node:crypto';
import { MARKET_SOURCES, type MarketSource } from './model';
import type { PublicReader } from './service';
import { SHIP_VALUES_BODY, SHIP_VALUES_URL } from './ship-values';
import { shopPriceReader } from './shop-prices';

/** Dedicated nonpersistent session: never shares the hangar, vault, cookies, credentials or renderer. */
function publicClient() {
  const isolated = session.fromPartition('public-market-' + randomUUID());
  isolated.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  isolated.setPermissionCheckHandler(() => false);
  return (url: string, signal: AbortSignal, xml: boolean, body?: string): Promise<unknown> => new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error('PUBLIC_SOURCE_CANCELLED')); return; }
    const request = net.request({ url, method: body === undefined ? 'GET' : 'POST', session: isolated,
      useSessionCookies: false, credentials: 'omit', redirect: 'error' });
    let settled = false;
    const chunks: Buffer[] = []; let bytes = 0;
    const finish = (error?: Error, value?: unknown) => {
      if (settled) return; settled = true; clearTimeout(timer); signal.removeEventListener('abort', abort);
      if (error) { request.abort(); reject(error); } else resolve(value);
    };
    const abort = () => finish(new Error('PUBLIC_SOURCE_CANCELLED'));
    const timer = setTimeout(() => finish(new Error('PUBLIC_SOURCE_TIMEOUT')), 20000);
    signal.addEventListener('abort', abort, { once: true });
    request.setHeader('Accept', xml ? 'application/xml,text/xml' : 'application/json');
    if (body !== undefined) request.setHeader('Content-Type','application/json');
    request.on('login', () => finish(new Error('PUBLIC_SOURCE_AUTH_REFUSED')));
    request.on('redirect', () => finish(new Error('PUBLIC_SOURCE_REDIRECT_REFUSED')));
    request.on('error', () => finish(new Error('PUBLIC_SOURCE_NETWORK')));
    request.on('response', response => {
      const contentType = String(response.headers['content-type'] ?? '');
      const accepted = xml ? /^(?:application|text)\/xml(?:;|$)/i.test(contentType) : /^application\/json(?:;|$)/i.test(contentType);
      if (response.statusCode !== 200 || !accepted) { finish(new Error('PUBLIC_SOURCE_RESPONSE')); return; }
      response.on('error', () => finish(new Error('PUBLIC_SOURCE_NETWORK')));
      response.on('data', chunk => {
        const buffer = Buffer.from(chunk); bytes += buffer.length;
        if (bytes > (xml ? 65_536 : 8 * 1024 * 1024)) finish(new Error('PUBLIC_SOURCE_SIZE')); else if (!settled) chunks.push(buffer);
      });
      response.on('end', () => {
        if (settled) return;
        try { const result = Buffer.concat(chunks).toString('utf8'); finish(undefined, xml ? result : JSON.parse(result)); }
        catch { finish(new Error('PUBLIC_SOURCE_FORMAT')); }
      });
    });
    if (body !== undefined) request.write(body);
    request.end();
  });
}

export function publicMarketReader(): PublicReader {
  const read = publicClient();
  return (source: MarketSource, signal) => Object.hasOwn(MARKET_SOURCES, source)
    ? read(MARKET_SOURCES[source], signal, source === 'fx', source === 'shipValues' ? SHIP_VALUES_BODY : undefined)
    : Promise.reject(new Error('PUBLIC_SOURCE_CANCELLED'));
}

export function publicShopPriceReader() {
  const read = publicClient();
  return shopPriceReader((body, signal) => read(SHIP_VALUES_URL, signal, false, body));
}
