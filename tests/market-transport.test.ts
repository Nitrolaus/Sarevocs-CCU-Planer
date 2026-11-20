import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { buildSync } from 'esbuild';
import {SHIP_VALUES_BODY,SHIP_VALUES_URL} from '../src/market/ship-values';

const compiled = buildSync({ entryPoints: ['src/market/transport.ts'], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['electron'] }).outputFiles[0]!.text;
type FakeRequest = EventEmitter & { abort(): void; end(): void; write(value:string):void; setHeader(name: string, value: string): void; aborted: boolean };
function reader(scenario: (req: FakeRequest) => void) {
  const captures: Record<string, unknown>[] = [], sessions: string[] = [],writes:string[]=[];
  const electron = { session: { fromPartition: (name: string) => { sessions.push(name); return { setPermissionRequestHandler: () => {}, setPermissionCheckHandler: () => {} }; } }, net: { request: (options: Record<string, unknown>) => {
    captures.push(options); const req = new EventEmitter() as FakeRequest; req.aborted = false;
    req.abort = () => { req.aborted = true; }; req.setHeader = () => {};req.write=value=>{writes.push(value);};
    req.end = () => queueMicrotask(() => scenario(req)); return req;
  } } };
  const native = createRequire(import.meta.url), exports: Record<string, unknown> = {}, module = { exports };
  new Function('require', 'module', 'exports', compiled)((name: string) => name === 'electron' ? electron : native(name), module, exports);
  const api = (module.exports as { publicMarketReader: () => (source: string, signal: AbortSignal) => Promise<unknown> }).publicMarketReader();
  return { api, captures, sessions,writes };
}
function response(req: FakeRequest, status: number, type: string, body: Buffer | string) {
  const res = Object.assign(new EventEmitter(), { statusCode: status, headers: { 'content-type': type } });
  req.emit('response', res); res.emit('data', body); res.emit('end');
}
test('Public transport can only issue fixed GETs with cookies and credentials omitted', async () => {
  const r = reader(req => response(req, 200, 'application/json; charset=utf-8', '{"ok":true}'));
  assert.deepEqual(await r.api('catalogue', new AbortController().signal), { ok: true });
  assert.equal(r.captures[0]!.url, 'https://robertsspaceindustries.com/ship-matrix/index');
  assert.equal(r.captures[0]!.method, 'GET'); assert.equal(r.captures[0]!.credentials, 'omit'); assert.equal(r.captures[0]!.useSessionCookies, false); assert.equal(r.captures[0]!.redirect, 'error');
  assert.match(r.sessions[0]!, /^public-market-/); assert.doesNotMatch(r.sessions[0]!, /^persist:/);
  await assert.rejects(r.api('toString', new AbortController().signal)); assert.equal(r.captures.length, 1);
});
test('Public transport refuses authentication challenges and aborts the request', async () => {
  let request: FakeRequest | undefined;
  const r = reader(req => { request = req; req.emit('login'); });
  await assert.rejects(r.api('offers', new AbortController().signal), /AUTH_REFUSED/); assert.equal(request!.aborted, true);
});
test('Only the fixed anonymous ship-value read query can use POST; no caller body, cookies or mutation',async()=>{
 const r=reader(req=>response(req,200,'application/json','[]'));await r.api('shipValues',new AbortController().signal);
 assert.equal(r.captures[0]!.url,SHIP_VALUES_URL);assert.equal(r.captures[0]!.method,'POST');assert.equal(r.captures[0]!.credentials,'omit');assert.equal(r.captures[0]!.useSessionCookies,false);assert.equal(r.captures[0]!.redirect,'error');assert.deepEqual(r.writes,[SHIP_VALUES_BODY]);assert.doesNotMatch(SHIP_VALUES_BODY,/mutation|token|password|email|authorization/i);
 await assert.rejects(r.api('shipValues?query=mutation',new AbortController().signal));assert.equal(r.captures.length,1);
});

test('Loaner articles use only fixed public API URLs with no session credentials', async () => {
  const r=reader(req=>response(req,200,'application/json','{}'));
  for(const source of ['loaners','included'])await r.api(source,new AbortController().signal);
  assert.deepEqual(r.captures.map(x=>x.url),[
    'https://support.robertsspaceindustries.com/api/v2/help_center/en-us/articles/360003093114.json',
    'https://support.robertsspaceindustries.com/api/v2/help_center/en-us/articles/4408770370455.json']);
  assert.ok(r.captures.every(x=>x.method==='GET'&&x.credentials==='omit'&&x.useSessionCookies===false&&x.redirect==='error'));
});
test('Only the fixed ECB source accepts bounded XML and still omits credentials', async () => {
  const r=reader(req=>response(req,200,'text/xml; charset=utf-8','<gesmes:Envelope></gesmes:Envelope>'));
  assert.equal(await r.api('fx',new AbortController().signal),'<gesmes:Envelope></gesmes:Envelope>');
  assert.equal(r.captures[0]!.url,'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml');
  assert.equal(r.captures[0]!.credentials,'omit');assert.equal(r.captures[0]!.useSessionCookies,false);
  for(const type of ['application/json','text/html']){const bad=reader(req=>response(req,200,type,'{}'));await assert.rejects(bad.api('fx',new AbortController().signal));}
  const big=reader(req=>response(req,200,'text/xml',Buffer.alloc(65537)));await assert.rejects(big.api('fx',new AbortController().signal),/SIZE/);
});
test('Public transport refuses redirects rather than following a login or unrelated URL', async () => {
  const r = reader(req => req.emit('redirect', 302, 'GET', 'https://example.invalid'));
  await assert.rejects(r.api('offers', new AbortController().signal), /REDIRECT_REFUSED/);
});
test('HTML challenges, bad status and malformed JSON never become successful source data', async () => {
  for (const [status, type, body] of [[200, 'text/html', '<html>challenge</html>'], [403, 'application/json', '{}'], [200, 'application/json', '{bad']] as const) {
    const r = reader(req => response(req, status, type, body)); await assert.rejects(r.api('offers', new AbortController().signal));
  }
});
test('Oversized responses are aborted before becoming a cache entry', async () => {
  let request: FakeRequest | undefined;
  const r = reader(req => { request = req; response(req, 200, 'application/json', Buffer.alloc(8 * 1024 * 1024 + 1)); });
  await assert.rejects(r.api('offers', new AbortController().signal), /SOURCE_SIZE/); assert.equal(request!.aborted, true);
});
test('Closing cancels an unfinished public request; an already cancelled request never starts', async () => {
  const r = reader(() => {}), controller = new AbortController();
  const pending = r.api('offers', controller.signal); controller.abort(); await assert.rejects(pending, /CANCELLED/);
  const cancelled = new AbortController(); cancelled.abort(); await assert.rejects(r.api('catalogue', cancelled.signal)); assert.equal(r.captures.length, 1);
});
