import { app, BrowserWindow } from 'electron';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, X509Certificate } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import type { Socket } from 'node:net';
import { UpgradeHistoryReader, UPGRADE_HISTORY_URL, MAX_UPGRADE_HISTORY_BYTES, historyParserProbe } from '../src/importers/upgrade-history';
import { upgradeHistoryResultSchema } from '../src/domain/upgrade-history';
import { purchaseSessionProof, type StoredCookie } from '../src/security/rsi-cookies';
import type { RsiPurchase } from '../src/domain/model';
import { basePledge } from './fixtures';

const root = path.resolve(process.argv.find(value => value.startsWith('--test-root='))!.slice(12));
const legacyBaseline = process.argv.includes('--legacy-baseline');
app.setPath('userData', path.join(root, 'runtime')); app.setPath('sessionData', path.join(root, 'memory')); app.setPath('crashDumps', path.join(root, 'crashes'));
app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND, EXCLUDE 127.0.0.1');
app.commandLine.appendSwitch('proxy-server', 'http://127.0.0.1:1');
app.on('window-all-closed', () => {});
const native = { sessions: [] as { isolated: Electron.Session; partition: string; options: { cache: boolean } }[],
  windows: [] as { win: BrowserWindow; options: Electron.BrowserWindowConstructorOptions }[], prepare: async (_isolated: Electron.Session) => {}, failureCode: '', fetchStatus: 0, firstStatus: '', responseFlags: {} };
(globalThis as unknown as { historyNative: typeof native }).historyNative = native;
const results: string[] = [], readers: UpgradeHistoryReader[] = [], sockets = new Set<Socket>();
const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
function gate() { let release = () => {}; const promise = new Promise<void>(resolve => { release = resolve; }); return { entered: false, release, promise }; }
async function until(check: () => boolean) { for (let i = 0; i < 300; i++) { if (check()) return; await wait(10); } throw Error('HISTORY_WAIT'); }
function cookie(value = 'SYNTHETIC_HISTORY_COOKIE_ONLY'): StoredCookie { return { name: 'Rsi-Token', value, domain: 'robertsspaceindustries.com', path: '/', secure: true, httpOnly: true, hostOnly: true, session: true, sameSite: 'lax' }; }
function reader(loader = async (_id: string) => [cookie()]) { const value = new UpgradeHistoryReader(loader); readers.push(value); return value; }
const row = (date: string, text: string) => `<div class="row"><label>${date}<br><span>${text}</span></label></div>`;
const good = row('Nov 26 2023, 6:02 pm', 'Upgrade applied: #2 Upgrade - Beta to Gamma Warbond Edition, new value: $60.00 USD') +
  row('Nov 26 2023, 5:44 am', 'Upgrade applied: #1 Upgrade - Alpha to Beta Standard Edition, new value: $55.00 USD');
const mixed = row('Nov 26 2023, 6:02 pm', 'Upgrade applied: #2 Upgrade - Synthetic Beta to Synthetic Gamma Warbond Edition, new value: $60.00 USD') +
  row('Nov 26 2023, 5:44 am', 'Upgrade applied: #1 Synthetic Alpha to Synthetic Beta Upgrade, new value: $55.00 USD');
const batchHtml = new Map([
  ['301', row('Nov 26 2023, 1:00 pm', 'Upgrade applied: #401 Upgrade - Alpha to Beta, new value: $31.00 USD')],
  ['302', row('Nov 26 2023, 2:00 pm', 'Upgrade applied: #402 Upgrade - Delta to Epsilon, new value: $32.00 USD')],
  ['303', '<p>No upgrades have been applied to this pledge.</p>'],
  ['304', ''],
]);
const receipt = (minor: number): RsiPurchase => ({status:'documented', source:'order', currency:'EUR', minor});
const emptyBatch = {histories:{}, basePurchases:{}};
let phase = 'INIT', scenario = 'success', served = 0, verifiedRequests = 0, requestDeadlineElapsedMs = 0, responseGate: ReturnType<typeof gate> | undefined;
let rotateHistorySession = false;
let cleanupDataAttempts = 0, cleanupCacheAttempts = 0;
let proxy: http.Server | undefined;
async function check(name: string, run: () => Promise<void>) { phase = name; scenario = 'success'; responseGate = undefined; await run(); results.push(name); console.log('PASS: ' + name); }
async function parseOnly(html: string) {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, nodeIntegration: false } });
  await win.loadURL('data:text/html,<meta http-equiv="Content-Security-Policy" content="default-src \'none\'">');
  try { return upgradeHistoryResultSchema.parse(await win.webContents.executeJavaScript(historyParserProbe(html))); }
  finally { win.destroy(); }
}

app.whenReady().then(async () => {
  try {
    if (legacyBaseline) {
      phase = 'LEGACY_BASELINE';
      const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, nodeIntegration: false } });
      await win.loadURL('data:text/html,<meta http-equiv="Content-Security-Policy" content="default-src \'none\'">');
      try {
        const observed = upgradeHistoryResultSchema.parse(await win.webContents.executeJavaScript(historyParserProbe(mixed)));
        assert.equal(observed.status, 'loaded'); assert.equal(observed.partial, true); assert.equal(observed.steps.length, 1);
        assert.equal(observed.steps[0]!.from, 'Synthetic Beta'); assert.equal(observed.steps[0]!.to, 'Synthetic Gamma');
        fs.writeFileSync(path.join(root, 'results.json'), JSON.stringify({ status: 'BASELINE_REPRODUCED', expectedFailure: true,
          syntheticOnly: true, externalRsiRequests: 0, expectedStepCount: 2, actualStepCount: observed.steps.length, partial: observed.partial,
          missingOlderStep: true, modernStepPreserved: true }, null, 2));
      } finally { win.destroy(); }
      return;
    }
    const script = `$ErrorActionPreference='Stop'
$rsa=[Security.Cryptography.RSA]::Create(2048)
$req=[Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=Local history fixture',$rsa,[Security.Cryptography.HashAlgorithmName]::SHA256,[Security.Cryptography.RSASignaturePadding]::Pkcs1)
$cert=$req.CreateSelfSigned([DateTimeOffset]::Now.AddMinutes(-5),[DateTimeOffset]::Now.AddHours(1))
try { @{Pfx=[Convert]::ToBase64String($cert.Export([Security.Cryptography.X509Certificates.X509ContentType]::Pfx));Cert=[Convert]::ToBase64String($cert.Export([Security.Cryptography.X509Certificates.X509ContentType]::Cert))}|ConvertTo-Json -Compress } finally {$cert.Dispose();$rsa.Dispose()}`;
    const fixture = JSON.parse(execFileSync('pwsh.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, encoding: 'utf8', timeout: 10000 }));
    const fingerprint = new X509Certificate(Buffer.from(fixture.Cert, 'base64')).fingerprint256;
    const tls = https.createServer({ pfx: Buffer.from(fixture.Pfx, 'base64') }, async (request, response) => {
      served++; const current = scenario, held = responseGate;
      let body = ''; for await (const chunk of request) body += chunk;
      if (request.method === 'POST' && request.url === '/api/account/upgradeLog' && /^\{"pledge_id":\d+\}$/.test(body) &&
        request.headers['x-rsi-token'] === 'SYNTHETIC_HISTORY_COOKIE_ONLY' && request.headers.cookie?.includes('Rsi-Token=SYNTHETIC_HISTORY_COOKIE_ONLY')) verifiedRequests++;
      response.setHeader('Content-Type', current === 'html' ? 'text/html' : 'application/json');
      if (held) { held.entered = true; await held.promise; }
      if (current === 'stall') return;
      if (current === 'redirect') { response.writeHead(302, { Location: ORIGIN + '/sign-in' }); response.end(); return; }
      if (current === 'auth') { response.writeHead(403); response.end('{}'); return; }
      if (current === 'too-large') { response.end(' '.repeat(MAX_UPGRADE_HISTORY_BYTES + 1)); return; }
      if (current === 'bad-json') { response.end('{'); return; }
      if (current === 'html') { response.end('<input type="password">'); return; }
      if (current === 'bad-envelope') { response.end(JSON.stringify({ success: 0, msg: 'SYNTHETIC_MUST_NOT_ESCAPE' })); return; }
      if (current === 'batch') {
        if (rotateHistorySession) response.setHeader('Set-Cookie', 'Rsi-Token=SYNTHETIC_OTHER_SESSION; Secure; HttpOnly; Path=/');
        const html = batchHtml.get(String(JSON.parse(body).pledge_id));
        response.end(JSON.stringify(html === undefined ? {success:0} : {success:1, data:{rendered:html}})); return;
      }
      const rendered = current === 'partial' ? good + row('Bad date', 'Unknown synthetic action') : current === 'empty' ? '' : current === 'active-html' ? good + '<script>throw Error("SYNTHETIC_SCRIPT")</script><img src="https://example.invalid/private">' : good;
      response.end(JSON.stringify({ success: 1, data: { rendered } }));
    });
    proxy = http.createServer((_request, response) => { response.writeHead(502); response.end(); });
    proxy.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
    proxy.on('connect', (_request, socket, head) => { socket.write('HTTP/1.1 200 Connection Established\r\n\r\n'); if (head.length) socket.unshift(head); tls.emit('connection', socket); });
    await new Promise<void>(resolve => proxy!.listen(0, '127.0.0.1', resolve));
    const port = (proxy.address() as import('node:net').AddressInfo).port;
    native.prepare = async isolated => {
      await isolated.setProxy({ mode: 'fixed_servers', proxyRules: 'http://127.0.0.1:' + port });
      assert.equal(await isolated.resolveProxy(UPGRADE_HISTORY_URL), 'PROXY 127.0.0.1:' + port);
      isolated.setCertificateVerifyProc((request, callback) => { try { callback(new X509Certificate(request.certificate.data).fingerprint256 === fingerprint ? 0 : -2); } catch { callback(-2); } });
      if (scenario === 'cleanup-failure') {
        const close = isolated.closeAllConnections.bind(isolated), clearData = isolated.clearStorageData.bind(isolated), clearCache = isolated.clearCache.bind(isolated);
        isolated.closeAllConnections = async () => { await close(); throw new Error('SYNTHETIC_CLEANUP_FAILURE'); };
        isolated.clearStorageData = async (...args) => { cleanupDataAttempts++; return clearData(...args); };
        isolated.clearCache = async () => { cleanupCacheAttempts++; return clearCache(); };
      }
    };
    await check('EXACT_POST_HEADER_BODY_AND_ORDERED_LOCAL_PARSER', async () => {
      const before = served, value = await reader().read(randomUUID(), 123, randomUUID());
      native.firstStatus = value.status;
      assert.deepEqual(value, { status: 'loaded', partial: false, steps: [
        { from: 'Alpha', to: 'Beta', appliedAt: '2023-11-26 05:44', ccuPledgeId: '1' },
        { from: 'Beta', to: 'Gamma', appliedAt: '2023-11-26 18:02', ccuPledgeId: '2' }] });
      assert.equal(served - before, 1); assert.equal(verifiedRequests, served); assert.equal(upgradeHistoryResultSchema.safeParse(value).success, true);
    });
    await check('CACHE_ISOLATES_PROFILE_PLEDGE_AND_REVISION', async () => {
      const item = reader(), a = randomUUID(), b = randomUUID(), revision = randomUUID(), before = served;
      const [first, second] = await Promise.all([item.read(a, 1, revision), item.read(a, 1, revision)]);
      first.steps[0]!.from = 'SYNTHETIC_MUTATION'; assert.equal(second.steps[0]!.from, 'Alpha');
      assert.equal((await item.read(a, 1, revision)).steps[0]!.from, 'Alpha'); assert.equal(served - before, 1);
      await item.read(a, 2, revision); await item.read(b, 1, revision); await item.read(a, 1, randomUUID()); assert.equal(served - before, 4);
      await item.close(a); await item.read(a, 1, revision); assert.equal(served - before, 5);
    });
    await check('BATCH_SHARES_TRANSPORT_PARSER_AND_ORDER_SCAN_AND_MEMOIZES_REVISION', async () => {
      scenario = 'batch';
      const id = randomUUID(), revision = randomUUID(), before = served, sessionCount = native.sessions.length, windowCount = native.windows.length;
      const candidates = {histories:['301','302','303','304'], bases:[basePledge('301'),basePledge('303')]};
      const lookup = {owner:'SYNTHETIC_OWNER', assertActive() {}};
      let cookieLoads = 0, orderScans = 0;
      const item = new UpgradeHistoryReader(async () => { cookieLoads++; return [cookie()]; }, undefined,
        async (net, bases, steps, owner, active) => {
          active(); orderScans++;
          assert.equal(net, native.sessions.slice(sessionCount).filter(s => s.partition.startsWith('upgrade-history-net-')).at(-1)!.isolated);
          assert.deepEqual(bases.map(p => p.pledgeId), ['301','303']);
          assert.deepEqual(steps?.map(s => s.ccuPledgeId), ['401','402']);
          assert.equal(owner, lookup.owner);
          return {
            bases: new Map([['301',receipt(3010)],['303',receipt(3030)],['499',receipt(4990)]]),
            applied: new Map([['401',receipt(4010)],['402',receipt(4020)],['301',receipt(9990)]]),
          };
        });
      readers.push(item);
      const [first, duplicate] = await Promise.all([item.readBatch(id, revision, candidates, lookup), item.readBatch(id, revision, candidates, lookup)]);
      assert.deepEqual(first.basePurchases, {'301':receipt(3010),'303':receipt(3030)});
      assert.deepEqual(Object.keys(first.histories), ['301','302','303']);
      assert.deepEqual(first.histories['301']!.purchases, [{ccuPledgeId:'401',price:receipt(4010)}]);
      assert.deepEqual(first.histories['302']!.purchases, [{ccuPledgeId:'402',price:receipt(4020)}]);
      assert.deepEqual(first.histories['303'], {status:'loaded',steps:[],partial:false,confirmedEmpty:true});
      assert.deepEqual(duplicate, first);
      assert.deepEqual(await item.readBatch(id, revision, candidates, lookup), first);
      assert.deepEqual(await item.readBatch(id, revision, candidates, {
        owner:lookup.owner, assertActive() { throw Error('SYNTHETIC_REVOKED'); },
      }), emptyBatch);
      const partitions = native.sessions.slice(sessionCount);
      assert.equal(partitions.filter(s => s.partition.startsWith('upgrade-history-net-')).length, 1);
      assert.equal(partitions.filter(s => s.partition.startsWith('upgrade-history-parser-')).length, 1);
      assert.equal(native.windows.length - windowCount, 1);
      assert.equal(served - before, 4); assert.equal(cookieLoads, 1); assert.equal(orderScans, 1);
      await item.close(id);
      assert.deepEqual(await item.readBatch(id, revision, candidates, lookup), first);
      assert.equal(orderScans, 2);
    });
    await check('MANUAL_REFERENCE_REQUIRES_SAME_SESSION_BEFORE_READ_AFTER_EVIDENCE_AND_ON_CACHE_HIT', async () => {
      scenario = 'batch';
      const id = randomUUID(), revision = randomUUID();
      // The first two pledges have an explicit negative response. The third still has a payable upgrade.
      const candidates = {histories:['299','300','301'], bases:[basePledge('301')]};
      const proof = purchaseSessionProof([cookie()])!;
      let stored = cookie(), rotate = false, scans = 0;
      const lookup = {owner:null, sessionProof:proof, assertActive() {}};
      const item = new UpgradeHistoryReader(async () => [stored], undefined, async (_net, _bases, steps, owner) => {
        scans++; assert.equal(owner, null); assert.deepEqual(steps?.map(step => step.ccuPledgeId), ['401']);
        if (rotate) stored = cookie('SYNTHETIC_OTHER_SESSION');
        return {bases:new Map([['301',receipt(3100)]]), applied:new Map([['401',receipt(4100)]])};
      });
      readers.push(item);
      const before = served;
      assert.deepEqual(await item.readBatch(id, revision, candidates, {...lookup, sessionProof:undefined}), emptyBatch);
      assert.deepEqual(await item.readBatch(id, revision, candidates, {...lookup, sessionProof:purchaseSessionProof([cookie('SYNTHETIC_OTHER_SESSION')])}), emptyBatch);
      assert.equal(served, before); assert.equal(scans, 0);
      const result = await item.readBatch(id, revision, candidates, lookup);
      assert.deepEqual(result.histories['301']?.purchases, [{ccuPledgeId:'401',price:receipt(4100)}]);
      assert.deepEqual(result.basePurchases, {'301':receipt(3100)});
      assert.equal(served - before, 3);
      stored = cookie('SYNTHETIC_OTHER_SESSION');
      assert.deepEqual(await item.readBatch(id, revision, candidates, lookup), emptyBatch);
      stored = cookie(); rotate = true;
      assert.deepEqual(await item.readBatch(id, randomUUID(), candidates, lookup), emptyBatch);
      assert.equal(scans, 2);
      rotate = false; stored = cookie(); rotateHistorySession = true;
      try {
        assert.deepEqual(await item.readBatch(id, randomUUID(), {...candidates, histories:['301']}, lookup), emptyBatch);
        assert.equal(scans, 2);
      } finally { rotateHistorySession = false; }
      scenario = 'auth'; stored = cookie(); rotate = false;
      const beforeAuth = served;
      assert.deepEqual(await item.readBatch(id, randomUUID(), candidates, lookup), emptyBatch);
      assert.equal(served - beforeAuth, 1); assert.equal(scans, 2);
    });
    await check('BATCH_WITHOUT_AUTHENTICATION_OR_CURRENT_CONTEXT_NEVER_RETURNS_RECEIPTS', async () => {
      const before = served;
      let scans = 0;
      const unauthenticated = new UpgradeHistoryReader(async () => [], undefined, async () => {
        scans++; return {bases:new Map(), applied:new Map()};
      });
      readers.push(unauthenticated);
      const candidates = {histories:['301'], bases:[basePledge('301')]};
      assert.deepEqual(await unauthenticated.readBatch(randomUUID(), randomUUID(), candidates,
        {owner:'SYNTHETIC_OWNER',assertActive() {}}), emptyBatch);
      assert.equal(served, before); assert.equal(scans, 0);
      for (const action of ['close','shutdown','revision']) {
        const held = gate(), id = randomUUID(), revision = randomUUID();
        let active = true, drained = false;
        const item = new UpgradeHistoryReader(async () => [cookie()], undefined, async () => {
          held.entered = true; await held.promise;
          // A late provider that ignores cancellation still must not publish results.
          return {bases:new Map([['301',receipt(3010)]]), applied:new Map([['401',receipt(4010)]])};
        });
        readers.push(item);
        scenario = 'batch';
        const lookup = {owner:'SYNTHETIC_OWNER', assertActive() { if (!active) throw Error('SYNTHETIC_REVISION_CHANGED'); }};
        const pending = item.readBatch(id, revision, candidates, lookup);
        await until(() => held.entered);
        const stopping = action === 'close' ? item.close(id) : action === 'shutdown' ? item.shutdown() : undefined;
        if (action === 'revision') active = false;
        const drain = stopping?.then(() => { drained = true; });
        try {
          await wait(30);
          if (stopping) assert.equal(drained, false);
        } finally { held.release(); }
        assert.deepEqual(await pending, emptyBatch);
        await drain;
        if (action === 'shutdown') assert.deepEqual(await item.readBatch(id, revision, candidates, lookup), emptyBatch);
      }
    });
    await check('NO_COOKIE_OR_INVALID_SCOPE_NEVER_DISPATCHES', async () => {
      const before = served;
      assert.equal((await reader(async () => []).read(randomUUID(), 1, randomUUID())).status, 'auth-required');
      assert.equal((await reader(async () => [{ ...cookie(), domain: 'example.invalid' }]).read(randomUUID(), 1, randomUUID())).status, 'unavailable');
      const item = reader();
      for (const args of [['bad', 1, randomUUID()], [randomUUID(), 0, randomUUID()], [randomUUID(), Number.MAX_SAFE_INTEGER + 1, randomUUID()], [randomUUID(), 1, 'bad']] as [string, number, string][]) assert.equal((await item.read(args[0], args[1], args[2])).status, 'unavailable');
      assert.equal(served, before);
    });
    await check('AUTH_REDIRECT_AND_ERRORS_NEVER_FOLLOW_OR_RETURN_RAW', async () => {
      for (const current of ['auth', 'redirect', 'html', 'bad-json', 'too-large', 'bad-envelope']) {
        scenario = current; const before = served;
        const result = await reader().read(randomUUID(), 1, randomUUID());
        assert.equal(result.status, current === 'auth' ? 'auth-required' : 'unavailable'); assert.deepEqual(result.steps, []); assert.equal(result.partial, false);
        assert.equal(served - before, 1); assert.equal(JSON.stringify(result).includes('SYNTHETIC_'), false);
      }
    });
    await check('EMPTY_AND_PARTIAL_HISTORY_STAY_EXPLICIT', async () => {
      scenario = 'empty'; assert.deepEqual(await reader().read(randomUUID(), 1, randomUUID()), { status: 'loaded', steps: [], partial: true });
      scenario = 'partial'; const result = await reader().read(randomUUID(), 1, randomUUID()); assert.equal(result.status, 'loaded'); assert.equal(result.partial, true); assert.equal(result.steps.length, 2);
    });
    await check('EXPLICIT_NO_UPGRADES_IS_DISTINCT_FROM_MISSING_OR_CONFLICTING_ROWS', async () => {
      const statement = '<p>No upgrades have been applied to this pledge.</p>';
      const proof = {status:'loaded', steps:[], partial:false, confirmedEmpty:true};
      assert.deepEqual(await parseOnly(statement), proof);
      assert.deepEqual(await parseOnly('<div class="row"><label>This pledge has not been upgraded.</label></div>'), proof);
      const event = 'Upgrade applied: #3 Upgrade - Gamma to Delta, new value: $4.00 USD';
      for (const fragment of ['', '<div class="row"></div>', 'No results', '<p>No upgrades are available for this pledge.</p>',
        statement + '<div class="row"></div>', '<div hidden>' + statement + '</div>', '<div style="display:none">' + statement + '</div>',
        '<noscript>' + statement + '</noscript>', good + statement,
        good + '<div class="row">Unknown action</div>', good + '<section>' + event + '</section>',
        row('Nov 26 2023, 6:00 pm', event + '</span><span>' + event), row('Nov 26 2023, 6:00 pm', event + '</span>' + event)]) {
        const parsed = await parseOnly(fragment);
        assert.equal(parsed.confirmedEmpty, undefined);
        assert.equal(parsed.partial, true);
      }
    });
    await check('INERT_HTML_CANNOT_LOAD_REMOTE_RESOURCES_OR_SHOW_WINDOW', async () => {
      scenario = 'active-html'; const before = served;
      assert.equal((await reader().read(randomUUID(), 1, randomUUID())).status, 'loaded'); await wait(100); assert.equal(served - before, 1);
      for (const entry of native.windows) { assert.equal(entry.options.show, false); assert.equal(entry.options.webPreferences?.sandbox, true); assert.equal(entry.options.webPreferences?.nodeIntegration, false); assert.equal(entry.options.webPreferences?.v8CacheOptions, 'none'); assert.equal(entry.win.isDestroyed(), true); }
      for (const entry of native.sessions) assert.equal(entry.options.cache, false);
    });
    await check('NETWORK_GUARD_DENIES_ALL_OTHER_METHODS_TARGETS_AND_REPEATS', async () => {
      responseGate = gate(); const item = reader(), task = item.read(randomUUID(), 1, randomUUID()); await until(() => !!responseGate?.entered);
      const isolated = native.sessions.filter(value => value.partition.startsWith('upgrade-history-net-')).at(-1)!.isolated;
      const before = served;
      for (const url of [UPGRADE_HISTORY_URL, ORIGIN + '/api/account/applyUpgrade', ORIGIN + '/api/cart', ORIGIN + '/sign-in', 'https://example.invalid/']) {
        for (const method of ['GET', 'POST', 'DELETE']) await assert.rejects(() => isolated.fetch(url, { method, ...(method === 'POST' ? { body: '{}' } : {}) }));
      }
      assert.equal(served, before); responseGate!.release(); assert.equal((await task).status, 'loaded');
    });
    await check('CLOSE_BEFORE_AND_DURING_COOKIE_LOAD_WAITS_NO_LATE_REQUEST', async () => {
      const before = served; let loads = 0;
      const immediate = reader(async () => { loads++; return [cookie()]; }), a = randomUUID(); const cancelled = immediate.read(a, 1, randomUUID()); await immediate.close(a);
      assert.equal((await cancelled).status, 'cancelled'); assert.equal(loads, 0);
      const held = gate(), item = reader(async () => { held.entered = true; await held.promise; return [cookie()]; }), b = randomUUID();
      const task = item.read(b, 1, randomUUID()); await until(() => held.entered); let closed = false; const closing = item.close(b).then(() => { closed = true; });
      await wait(50); assert.equal(closed, false); held.release(); await closing; assert.equal((await task).status, 'cancelled'); assert.equal(served, before);
    });
    await check('CLOSE_DURING_NETWORK_DRAINS_AND_CLEARS_COOKIE_STORAGE', async () => {
      responseGate = gate(); const item = reader(), id = randomUUID(), task = item.read(id, 1, randomUUID());
      await until(() => !!responseGate?.entered); const isolated = native.sessions.filter(value => value.partition.startsWith('upgrade-history-net-')).at(-1)!.isolated;
      await item.close(id); assert.equal((await task).status, 'cancelled'); assert.deepEqual(await isolated.cookies.get({}), []); responseGate.release();
    });
    await check('TWO_ACTIVE_EIGHT_QUEUED_AND_SHUTDOWN_DRAINS', async () => {
      responseGate = gate(); const item = reader(), before = served, tasks = Array.from({ length: 12 }, () => item.read(randomUUID(), 1, randomUUID()));
      await until(() => served - before === 2); await wait(80); assert.equal(served - before, 2);
      const shutdown = item.shutdown(); responseGate.release(); await shutdown; const values = await Promise.all(tasks);
      assert.equal(values.filter(value => value.status === 'unavailable').length, 2); assert.equal(values.filter(value => value.status === 'cancelled').length, 10);
      assert.equal((await item.read(randomUUID(), 1, randomUUID())).status, 'cancelled');
    });
    await check('REQUEST_DEADLINE_ABORTS_AND_DRAINS', async () => {
      scenario = 'stall'; const began = Date.now();
      assert.equal((await reader().read(randomUUID(), 1, randomUUID())).status, 'unavailable');
      requestDeadlineElapsedMs = Date.now() - began; assert.ok(requestDeadlineElapsedMs >= 14500 && requestDeadlineElapsedMs < 25000);
    });
    await check('CLEANUP_FAILURE_STILL_ERASES_DATA_AND_NEVER_CACHES_RESULT', async () => {
      scenario = 'cleanup-failure'; const item = reader(), id = randomUUID(), revision = randomUUID(), before = served;
      assert.equal((await item.read(id, 1, revision)).status, 'unavailable'); assert.equal(cleanupDataAttempts, 1); assert.equal(cleanupCacheAttempts, 1);
      scenario = 'success'; assert.equal((await item.read(id, 1, revision)).status, 'loaded'); assert.equal(served - before, 2);
    });
    await check('PARSER_REJECTS_GUESSES_BOUNDS_STEPS_AND_VALIDATES_DATES', async () => {
      const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, nodeIntegration: false } });
      await win.loadURL('data:text/html,<meta http-equiv="Content-Security-Policy" content="default-src \'none\'">');
      try {
        for (const html of [row('Feb 31 2024, 5:00 am', 'Upgrade applied: Upgrade - Alpha to Beta, new value: $1 USD'), row('Nov 1 2024, 1:00 pm', 'Unknown action'), row('Nov 1 2024, 1:00 pm', 'Upgrade applied: Upgrade - A to B to C, new value: $1 USD')]) {
          const output = upgradeHistoryResultSchema.parse(await win.webContents.executeJavaScript(historyParserProbe(html))); assert.equal(output.partial, true);
          if (html.includes('Feb')) assert.equal(output.steps[0]!.appliedAt, null); else assert.equal(output.steps.length, 0);
        }
        const bounded = upgradeHistoryResultSchema.parse(await win.webContents.executeJavaScript(historyParserProbe(good.repeat(100)))); assert.equal(bounded.partial, true); assert.equal(bounded.steps.length, 128);
        const edition = upgradeHistoryResultSchema.parse(await win.webContents.executeJavaScript(historyParserProbe(row('Nov 1 2024, 1:00 pm', 'Upgrade applied: Upgrade - Alpha to Synthetic Limited Edition, new value: $1 USD'))));
        assert.equal(edition.steps[0]!.to, 'Synthetic Limited Edition');
        const wrongOrder = row('Nov 1 2024, 1:00 am', 'Upgrade applied: Upgrade - Beta to Gamma, new value: $1 USD') + row('Nov 2 2024, 1:00 am', 'Upgrade applied: Upgrade - Alpha to Beta, new value: $1 USD');
        const order = upgradeHistoryResultSchema.parse(await win.webContents.executeJavaScript(historyParserProbe(wrongOrder))); assert.equal(order.partial, true);
        assert.throws(() => historyParserProbe(' '.repeat(MAX_UPGRADE_HISTORY_BYTES + 1)));
      } finally { win.destroy(); }
    });
    await check('LEGACY_AND_MODERN_STEPS_FORM_COMPLETE_ORDERED_CHAIN', async () => {
      assert.deepEqual(await parseOnly(mixed), { status: 'loaded', partial: false, steps: [
        { from: 'Synthetic Alpha', to: 'Synthetic Beta', appliedAt: '2023-11-26 05:44', ccuPledgeId: '1' },
        { from: 'Synthetic Beta', to: 'Synthetic Gamma', appliedAt: '2023-11-26 18:02', ccuPledgeId: '2' },
      ] });
    });
    await check('LONG_MIXED_CHAIN_PRESERVES_EVERY_STEP_AND_DATE', async () => {
      const data = row('Nov 26 2023, 7:00 am', 'Upgrade applied: #4 Synthetic Delta to Synthetic Epsilon Upgrade, new value: $4 USD') +
        row('Nov 26 2023, 6:00 am', 'Upgrade applied: #3 Upgrade - Synthetic Gamma to Synthetic Delta Standard Upgrade, new value: $3 USD') +
        row('Nov 26 2023, 5:00 am', 'Upgrade applied: #2 Synthetic Beta to Synthetic Gamma Upgrade, new value: $2 USD') +
        row('Nov 26 2023, 4:00 am', 'Upgrade applied: #1 Upgrade - Synthetic Alpha to Synthetic Beta, new value: $1 USD');
      const value = await parseOnly(data);
      assert.equal(value.status, 'loaded'); assert.equal(value.partial, false);
      assert.deepEqual(value.steps.map(step => [step.from, step.to, step.appliedAt]), [
        ['Synthetic Alpha', 'Synthetic Beta', '2023-11-26 04:00'], ['Synthetic Beta', 'Synthetic Gamma', '2023-11-26 05:00'],
        ['Synthetic Gamma', 'Synthetic Delta', '2023-11-26 06:00'], ['Synthetic Delta', 'Synthetic Epsilon', '2023-11-26 07:00'],
      ]);
    });
    await check('LEGACY_DUPLICATES_KEEP_MULTIPLICITY_AND_EXPLICIT_CHAIN_GAP', async () => {
      const legacy = row('Nov 26 2023, 5:00 am', 'Upgrade applied: #1 Synthetic Alpha to Synthetic Beta Upgrade, new value: $1 USD');
      const value = await parseOnly(row('Nov 26 2023, 6:00 am', 'Upgrade applied: #2 Upgrade - Synthetic Beta to Synthetic Gamma, new value: $2 USD') + legacy + legacy);
      assert.equal(value.partial, true); assert.equal(value.steps.length, 3);
      assert.deepEqual(value.steps.map(step => [step.from, step.to]), [['Synthetic Alpha', 'Synthetic Beta'], ['Synthetic Alpha', 'Synthetic Beta'], ['Synthetic Beta', 'Synthetic Gamma']]);
    });
    await check('LEGACY_MALFORMED_OFFERS_AND_UNKNOWN_EVENTS_NEVER_GUESS', async () => {
      const offers = ['Synthetic Alpha to Synthetic Beta', 'Synthetic Alpha to Synthetic Beta to Synthetic Gamma Upgrade',
        'Synthetic Alpha to to Synthetic Beta Upgrade', 'to Synthetic Beta Upgrade', 'Synthetic Alpha to Upgrade',
        'Upgrade - to Synthetic Beta Upgrade', 'Upgrade - Synthetic Alpha to', 'Upgrade - Synthetic Alpha to Synthetic Beta to Synthetic Gamma Upgrade',
        'Synthetic Alpha to Synthetic Alpha Upgrade', 'A'.repeat(201) + ' to Synthetic Beta Upgrade'];
      for (const offer of offers) {
        const value = await parseOnly(row('Nov 26 2023, 5:00 am', `Upgrade applied: #1 ${offer}, new value: $1 USD`));
        assert.equal(value.partial, true); assert.equal(value.steps.length, 0);
      }
      for (const text of ['Upgrade purchased: #1 Synthetic Alpha to Synthetic Beta Upgrade, new value: $1 USD',
        'Synthetic Alpha to Synthetic Beta Upgrade', 'Upgrade applied: #1 Synthetic Alpha to Synthetic Beta Upgrade']) {
        const value = await parseOnly(row('Nov 26 2023, 5:00 am', text)); assert.equal(value.partial, true); assert.equal(value.steps.length, 0);
      }
    });
    await check('LEGACY_SUFFIX_IS_SCOPED_AND_NAMES_DATES_BOUNDS_STAY_CONSERVATIVE', async () => {
      const cases: [string, string][] = [
        ['Synthetic Alpha to Synthetic Limited Edition Upgrade', 'Synthetic Limited Edition'],
        ['Synthetic Alpha to Synthetic Upgrade Upgrade', 'Synthetic Upgrade'],
        ['Upgrade - Synthetic Alpha to Synthetic Upgrade', 'Synthetic Upgrade'],
        ['Upgrade - Synthetic Alpha to Synthetic Limited Edition', 'Synthetic Limited Edition'],
        ['Upgrade - Synthetic Alpha to Synthetic Beta Standard Edition', 'Synthetic Beta'],
        ['Upgrade - Synthetic Alpha to Synthetic Beta Warbond Upgrade', 'Synthetic Beta'],
      ];
      for (const [offer, expected] of cases) {
        const value = await parseOnly(row('Nov 26 2023, 5:00 am', `Upgrade applied: #1 ${offer}, new value: $1 USD`));
        assert.equal(value.partial, false); assert.equal(value.steps[0]!.to, expected);
      }
      const invalidDate = await parseOnly(row('Feb 31 2024, 5:00 am', 'Upgrade applied: #1 Synthetic Alpha to Synthetic Beta Upgrade, new value: $1 USD'));
      assert.equal(invalidDate.steps.length, 1); assert.equal(invalidDate.steps[0]!.appliedAt, null); assert.equal(invalidDate.partial, true);
      const limit = await parseOnly(row('Nov 26 2023, 5:00 am', 'Upgrade applied: #1 Synthetic Alpha to Synthetic Beta Upgrade, new value: $1 USD').repeat(129));
      assert.equal(limit.steps.length, 128); assert.equal(limit.partial, true);
    });
    await check('ALL_EPHEMERAL_STORAGE_CLEARED_AND_NO_REMAINING_WINDOWS', async () => {
      for (const item of readers) await item.shutdown();
      for (const entry of native.sessions) assert.deepEqual(await entry.isolated.cookies.get({}), []);
      assert.equal(BrowserWindow.getAllWindows().length, 0); assert.equal(verifiedRequests, served);
    });
    fs.writeFileSync(path.join(root, 'results.json'), JSON.stringify({ status: 'PASS', results, groups: results.length, syntheticOnly: true, externalRsiRequests: 0, verifiedLocalPosts: verifiedRequests, requestDeadlineElapsedMs }, null, 2));
  } catch { fs.writeFileSync(path.join(root, 'results.json'), JSON.stringify({ status: 'FAIL', phase, results, failureCode: native.failureCode, fetchStatus: native.fetchStatus, firstStatus: native.firstStatus, responseFlags: native.responseFlags, served, verifiedRequests, parserWindows: native.windows.length }, null, 2)); process.exitCode = 1; }
  finally { for (const item of readers) await item.shutdown(); for (const win of BrowserWindow.getAllWindows()) win.destroy(); for (const socket of sockets) socket.destroy(); if (proxy) await new Promise<void>(resolve => proxy!.close(() => resolve())); app.exit(Number(process.exitCode) || 0); }
});
const ORIGIN = 'https://robertsspaceindustries.com';
