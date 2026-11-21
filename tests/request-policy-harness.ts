import { app, BrowserWindow, session } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID, X509Certificate } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import type { Socket } from 'node:net';
import { RsiLogin } from '../src/importers/rsi';
import { SessionVault } from '../src/security/session-vault';
import { ConnectionDiagnostics } from '../src/diagnostics/connection';
import { APP_VERSION } from '../src/domain/model';
import {CREDIT_URL,CREDIT_BODY} from '../src/importers/rsi-credit';
import {LastSeenStore} from '../src/storage/last-seen';
import { rsiFetchPageProbe } from '../src/importers/rsi-page';
import { imageOperation, persistedImageBody, fallbackImageBody, confirmationOperation,
  confirmationQuery, persistedConfirmationBody, fallbackConfirmationBody } from './fixtures/rsi-captcha-image';

const root = path.resolve(process.argv.find(x => x.startsWith('--test-root='))!.slice(12));
app.setPath('userData', path.join(root, 'runtime')); app.setPath('sessionData', path.join(root, 'memory')); app.setPath('crashDumps', path.join(root, 'crashes'));
// No external DNS. All loadURL calls are local and fetch starts only after proxy verification.
app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND, EXCLUDE 127.0.0.1');
const results: string[] = [], canary = 'SYNTHETIC_POLICY_DATA_MUST_NOT_BE_LOGGED';
const diagnostics = new ConnectionDiagnostics(path.join(root, 'diagnostics'), APP_VERSION);
const fixture = path.join(root, 'fixture.html'); fs.writeFileSync(fixture, '<div id="marker">Local synthetic fixture</div>');
const origin = 'https://robertsspaceindustries.com';
const auth = '<div class="c-account-sidebar__profile-info-handle">SYNTHETIC_HANDLE</div><ul class="list-items"><li><input class="js-pledge-id" value="synthetic-001"><input class="js-pledge-name" value="SYNTHETIC PLEDGE"><div class="items-col">Synthetic</div><div class="date-col">Synthetic</div><div class="item"><span class="title">Demo Ship</span><span class="kind">Ship</span></div><div class="without-images"></div></li></ul>';
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
app.whenReady().then(async () => {
  const original = BrowserWindow.prototype.loadURL;
  BrowserWindow.prototype.loadURL = async function() { await this.loadFile(fixture); };
  const parent = new BrowserWindow({ show: false, webPreferences: { sandbox: true, nodeIntegration: false } });
  const vault = { load: async () => [], save: async () => false } as unknown as SessionVault;
  let configureLedgerTransport: (partition: Electron.Session) => Promise<void>;
  const login = new RsiLogin(vault, diagnostics, undefined, undefined, async () => {
    const partition = session.fromPartition('local-ledger-'+randomUUID(), {cache: false});
    await configureLedgerTransport(partition);
    return partition;
  }), account = randomUUID();
  let proxy: http.Server | undefined;
  const sockets = new Set<Socket>();
  try {
    await login.open(account, parent, false);
    const child = BrowserWindow.getAllWindows().find(w => w !== parent)!; child.hide();
    for (let i = 0; i < 100 && (!child.webContents.getURL() || child.webContents.isLoadingMainFrame()); i++) await wait(20);
    const isolated = child.webContents.session;
    const served: Array<{ path: string; method: string }> = [];
    let redirectGraphqlToCheckout = false;
    const wrongCode = '000000';
    const rejectedConfirmationBody = JSON.stringify([{ ...confirmationOperation,
      variables: { ...confirmationOperation.variables, captcha_code: wrongCode } }]);
    // Fresh ephemeral fixture certificate, never installed in any Windows trust store.
    const certificateScript = `$ErrorActionPreference='Stop'
$rsa=[Security.Cryptography.RSA]::Create(2048)
$req=[Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=Local synthetic test', $rsa, [Security.Cryptography.HashAlgorithmName]::SHA256, [Security.Cryptography.RSASignaturePadding]::Pkcs1)
$cert=$req.CreateSelfSigned([DateTimeOffset]::Now.AddMinutes(-5),[DateTimeOffset]::Now.AddHours(1))
try { @{Pfx=[Convert]::ToBase64String($cert.Export([Security.Cryptography.X509Certificates.X509ContentType]::Pfx));Cert=[Convert]::ToBase64String($cert.Export([Security.Cryptography.X509Certificates.X509ContentType]::Cert))}|ConvertTo-Json -Compress } finally { $cert.Dispose();$rsa.Dispose() }`;
    const fixtureCertificate = JSON.parse(execFileSync('pwsh.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(certificateScript, 'utf16le').toString('base64')], { windowsHide: true, encoding: 'utf8', timeout: 10000 }));
    const fingerprint = new X509Certificate(Buffer.from(fixtureCertificate.Cert, 'base64')).fingerprint256;
    const tlsFixture = https.createServer({ pfx: Buffer.from(fixtureCertificate.Pfx, 'base64') }, async (request, response) => {
      const pathname = new URL(request.url!, 'https://local.invalid').pathname;
      served.push({ path: pathname, method: request.method! });
      response.setHeader('Access-Control-Allow-Origin', '*');
      if (request.url === '/cookie-consent/script.js?async=1') {
        response.setHeader('Content-Type', 'text/javascript');
        response.end('globalThis.syntheticConsentLoaded = true;');
        return;
      }
      if (pathname === '/en/sign-in' && request.method === 'GET') {
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.end('<!doctype html><script defer src="https://www.recaptcha.net/recaptcha/enterprise.js"></script>' +
          '<iframe src="https://www.recaptcha.net/recaptcha/enterprise/anchor"></iframe>' +
          '<iframe src="https://www.recaptcha.net/recaptcha/enterprise/bframe"></iframe>');
        return;
      }
      if (pathname === '/recaptcha/enterprise.js') {
        response.setHeader('Content-Type', 'text/javascript');
        response.end('globalThis.syntheticCaptchaLoaded = true;');
        return;
      }
      if (['/recaptcha/enterprise/anchor', '/recaptcha/enterprise/bframe'].includes(pathname)) {
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.end('<script src="https://www.gstatic.com/recaptcha/releases/synthetic/widget.js"></script>');
        return;
      }
      if (pathname === '/recaptcha/releases/synthetic/widget.js') {
        response.setHeader('Content-Type', 'text/javascript');
        response.end('globalThis.syntheticCaptchaFrameLoaded = true;');
        return;
      }
      if (['/en/connect', '/en/sign-in', '/en/sign-in/send-confirmation-code', '/account/pledges', '/en/account/pledges'].includes(pathname)) {
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.end(pathname.endsWith('/pledges') ? auth :
          '<script src="/cookie-consent/script.js?async=1"></script><div id="marker">Local synthetic fixture</div>');
        return;
      }
      if(pathname==='/graphql'){
        if (request.method === 'POST' && !request.headers['x-rsi-token']) {
          const chunks: Buffer[] = [];
          for await (const chunk of request) chunks.push(chunk);
          const body = Buffer.concat(chunks).toString('utf8');
          const isImage = body === persistedImageBody || body === fallbackImageBody;
          const acceptsCode = body === persistedConfirmationBody || body === fallbackConfirmationBody;
          if (!isImage && !acceptsCode && body !== rejectedConfirmationBody) {
            response.writeHead(400); response.end(); return;
          }
          if (redirectGraphqlToCheckout) {
            response.writeHead(307, { Location: '/api/checkout' }); response.end(); return;
          }
          response.setHeader('Content-Type', 'application/json');
          if (!isImage) {
            response.end(JSON.stringify(acceptsCode
              ? [{ data: { account_signin: { status: 'Active' } } }]
              : [{ errors: [{ message: 'Invalid synthetic code' }] }]));
            return;
          }
          // A local 96 x 32 PNG with blue and yellow halves.
          const data = 'iVBORw0KGgoAAAANSUhEUgAAAGAAAAAgCAIAAABiouoDAAAAWElEQVR4nO3QMREAIAwEsLrAAnpQiAMMMrBjoD/kLgpSY+0o98wo1T4iSJAgQUHaRwQJEiQoiCBBggQJEiRIkKAQ7SOCBAkSFESQIEGCBAkSJEhQiPaRzwObjykADB3/wAAAAABJRU5ErkJggg==';
          response.end(JSON.stringify([{ data: { account_captcha: { data, type: 'image/png', encoding: 'base64' } } }]));
          return;
        }
        if (request.method === 'POST') {
          assert.equal(request.headers['x-rsi-token'] === canary, true);
          assert.equal(request.headers['x-csrf-token'] === canary, true);
        }
        response.setHeader('Access-Control-Allow-Headers','content-type, x-rsi-token, x-csrf-token');response.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');
        if(request.method==='OPTIONS'){response.writeHead(204);response.end();return;}
        response.setHeader('Content-Type','application/json');response.end(JSON.stringify([{data:{customer:{ledger:{amount:{value:12500,currency:{code:'USD'}}}}}}]));return;
      }
      if (pathname.endsWith('cart-redirect.js')) { response.writeHead(302, { Location: 'https://cdn.robertsspaceindustries.com/api/cart' }); response.end(); return; }
      if (pathname.endsWith('cart-widget.js')) { response.setHeader('Content-Type', 'text/javascript'); response.end('globalThis.syntheticAssetLoaded = true;'); return; }
      if (pathname.endsWith('payment-status.css')) { response.setHeader('Content-Type', 'text/css'); response.end('#marker { color: rgb(1, 2, 3); }'); return; }
      response.end('Synthetic local response');
    });
    proxy = http.createServer((_request, response) => { response.writeHead(502); response.end(); });
    proxy.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
    proxy.on('connect', (_request, socket, head) => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) socket.unshift(head);
      tlsFixture.emit('connection', socket);
    });
    await new Promise<void>(resolve => proxy!.listen(0, '127.0.0.1', resolve));
    const proxyPort = (proxy.address() as import('node:net').AddressInfo).port;
    configureLedgerTransport = async partition => {
      await partition.setProxy({ mode: 'fixed_servers', proxyRules: 'http://127.0.0.1:' + proxyPort });
      assert.equal(await partition.resolveProxy('https://cdn.robertsspaceindustries.com/'), 'PROXY 127.0.0.1:' + proxyPort);
      partition.setCertificateVerifyProc((request, callback) => {
        try { callback(new X509Certificate(request.certificate.data).fingerprint256 === fingerprint ? 0 : -2); } catch { callback(-2); }
      });
    };
    await configureLedgerTransport(isolated);
    const asset = 'https://cdn.robertsspaceindustries.com/scripts/cart-widget.js';
    for (const method of ['GET', 'HEAD']) {
      const response = await isolated.fetch(asset + '?v=1', { method }); assert.equal(response.status, 200); await response.arrayBuffer();
    }
    assert.equal(served.length, 2);
    results.push('Real Chromium GET/HEAD for static RSI-named files reaches only the local TLS fixture, despite action word in filename.');

    await original.call(child, origin + '/en/connect');
    assert.equal(await child.webContents.executeJavaScript('globalThis.syntheticConsentLoaded'), true);
    results.push('The first RSI login document loads and executes its exact consent script through the production request guard.');
    assert.equal(await child.webContents.executeJavaScript("fetch('/en/sign-in', {method:'POST',body:'synthetic'}).then(r=>r.ok)"), true);
    assert.ok(served.some(request => request.path === '/en/sign-in' && request.method === 'POST'));
    assert.equal(await child.webContents.executeJavaScript("fetch('/en/sign-in/send-confirmation-code', {method:'POST',body:'synthetic'}).then(r=>r.ok)"), true);
    const countBefore = served.length;
    assert.equal(await child.webContents.executeJavaScript("fetch('/unlisted', {method:'POST'}).then(()=>true,()=>false)"), false);
    assert.equal(served.length, countBefore);
    results.push('Only documented authentication submissions pass in a committed RSI login document with the real Chromium initiator.');

    await child.webContents.executeJavaScript(`Promise.all([
      new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=${JSON.stringify(asset)};s.onload=()=>resolve(true);s.onerror=()=>reject(Error('Synthetic script blocked'));document.head.append(s)}),
      new Promise((resolve,reject)=>{const l=document.createElement('link');l.rel='stylesheet';l.href='https://cdn.robertsspaceindustries.com/styles/payment-status.css';l.onload=()=>resolve(true);l.onerror=()=>reject(Error('Synthetic stylesheet blocked'));document.head.append(l)})
    ])`);
    assert.equal(await child.webContents.executeJavaScript('globalThis.syntheticAssetLoaded'), true);
    assert.equal(await child.webContents.executeJavaScript('getComputedStyle(document.getElementById("marker")).color'), 'rgb(1, 2, 3)');
    results.push('Actual sandboxed renderer loads and executes the static script and applies the stylesheet; no guard replacement in test.');

    await original.call(child, origin + '/en/sign-in');
    assert.equal(await child.webContents.executeJavaScript('globalThis.syntheticCaptchaLoaded'), true);
    const captchaFrames = child.webContents.mainFrame.frames;
    assert.deepEqual(captchaFrames.map(frame => frame.url), [
      'https://www.recaptcha.net/recaptcha/enterprise/anchor', 'https://www.recaptcha.net/recaptcha/enterprise/bframe',
    ]);
    for (const frame of captchaFrames) assert.equal(await frame.executeJavaScript('globalThis.syntheticCaptchaFrameLoaded'), true);
    const beforeDeniedWidgetRequest = served.length;
    assert.equal(await child.webContents.executeJavaScript(`fetch('https://www.recaptcha.net/recaptcha/unlisted').then(() => true, () => false)`), false);
    assert.equal(served.length, beforeDeniedWidgetRequest);
    results.push('The RSI login page can open both exact CAPTCHA frames and load their scripts. An unlisted CAPTCHA URL remains blocked.');

    for (const body of [persistedImageBody, fallbackImageBody]) {
      const pixels = await child.webContents.executeJavaScript(`(async () => {
        const reply = await fetch('/graphql', { method: 'POST', headers: { 'content-type': 'application/json' }, body: ${JSON.stringify(body)} });
        const [{ data: { account_captcha } }] = await reply.json();
        const image = document.createElement('img');
        const loaded = new Promise((resolve, reject) => {
          image.onload = resolve;
          image.onerror = () => reject(Error('Local test image failed to load'));
        });
        image.src = 'data:' + account_captcha.type + ';' + account_captcha.encoding + ',' + account_captcha.data;
        document.body.prepend(image);
        await loaded;
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0);
        return [image.naturalWidth, image.naturalHeight, Math.round(image.getBoundingClientRect().width),
          ...ctx.getImageData(5, 5, 1, 1).data, ...ctx.getImageData(90, 5, 1, 1).data];
      })()`);
      assert.deepEqual(pixels, [96, 32, 96, 23, 82, 160, 255, 252, 175, 40, 255]);
    }
    const tryGraphqlPost = (body: string) => `fetch(${JSON.stringify(origin + '/graphql')}, {
      method: 'POST', mode: 'no-cors', body: ${JSON.stringify(body)}
    }).then(() => true, () => false)`;
    const beforeRejectedPosts = served.length;
    for (const name of ['checkout', 'gift', 'reclaim', 'applyUpgrade', 'buyback']) {
      const body = JSON.stringify([{ ...imageOperation, query: 'mutation captcha { ' + name + ' }' }]);
      assert.equal(await child.webContents.executeJavaScript(tryGraphqlPost(body)), false);
    }
    assert.equal(await captchaFrames[0]!.executeJavaScript(tryGraphqlPost(persistedImageBody)), false);
    assert.equal(served.length, beforeRejectedPosts);
    redirectGraphqlToCheckout = true;
    assert.equal(await child.webContents.executeJavaScript(tryGraphqlPost(persistedImageBody)), false);
    assert.deepEqual(served.slice(beforeRejectedPosts), [{ path: '/graphql', method: 'POST' }]);
    redirectGraphqlToCheckout = false;
    results.push('Both sign-in image payloads render the local 96 x 32 PNG with verified pixels. Purchase/change mutations, the CAPTCHA iframe, and a 307 redirect to checkout are blocked before dispatch.');

    for (const { code, fallback, accepted } of [
      { code: wrongCode, fallback: false, accepted: false },
      { code: confirmationOperation.variables.captcha_code, fallback: false, accepted: true },
      { code: confirmationOperation.variables.captcha_code, fallback: true, accepted: true },
    ]) {
      const signInResult = await child.webContents.executeJavaScript(`new Promise((resolve, reject) => {
        const form = document.createElement('form');
        const input = document.createElement('input');
        const confirm = document.createElement('button');
        confirm.textContent = 'Confirm';
        input.value = ${JSON.stringify(code)};
        form.append(input, confirm);
        document.body.append(form);
        form.addEventListener('submit', async event => {
          event.preventDefault();
          try {
            const operation = ${JSON.stringify(confirmationOperation)};
            operation.variables.captcha_code = input.value;
            if (${fallback}) operation.query = ${JSON.stringify(confirmationQuery)};
            const reply = await fetch('/graphql', { method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify([operation]) });
            if (!reply.ok) throw Error('Unexpected local confirmation status');
            const [result] = await reply.json();
            resolve(result.data?.account_signin?.status === 'Active' ? 'accepted' :
              result.errors?.[0]?.message === 'Invalid synthetic code' ? 'rejected' : 'unexpected');
          } catch (error) { reject(error); } finally { form.remove(); }
        }, { once: true });
        confirm.click();
      })`);
      assert.equal(signInResult, accepted ? 'accepted' : 'rejected');
    }
    const beforeRejectedConfirmations = served.length;
    assert.equal(await captchaFrames[0]!.executeJavaScript(tryGraphqlPost(persistedConfirmationBody)), false);
    assert.equal(await child.webContents.executeJavaScript(tryGraphqlPost(JSON.stringify([confirmationOperation, imageOperation]))), false);
    assert.equal(await child.webContents.executeJavaScript(tryGraphqlPost(JSON.stringify([{
      ...confirmationOperation, query: 'mutation signin { checkout }',
    }]))), false);
    assert.equal(served.length, beforeRejectedConfirmations);
    redirectGraphqlToCheckout = true;
    assert.equal(await child.webContents.executeJavaScript(tryGraphqlPost(persistedConfirmationBody)), false);
    assert.deepEqual(served.slice(beforeRejectedConfirmations), [{ path: '/graphql', method: 'POST' }]);
    redirectGraphqlToCheckout = false;
    results.push('Manual image confirmation reaches the local fixture in both RSI wire forms. Its incorrect code stays rejected; altered, mixed and foreign-frame submissions and a checkout redirect stay blocked.');

    const blockedPaths = ['/api/cart', '/api/checkout', '/api/reclaim', '/api/apply-upgrade', '/api/gift', '/api/buyback', '/api/payment',
      '/api/cart.js', '/scripts/api/cart.js', '/scripts/cart/reclaim.js', '/%63art', '/%2563art', '/scripts/..%2fapi/%63art.js'];
    const before = served.length;
    for (const pathname of blockedPaths) for (const method of ['GET', 'POST', 'DELETE']) {
      await assert.rejects(() => isolated.fetch('https://cdn.robertsspaceindustries.com' + pathname, { method }), /ERR_BLOCKED_BY_CLIENT/);
    }
    assert.equal(served.length, before);
    await assert.rejects(() => isolated.fetch(asset, { method: 'POST', body: canary }), /ERR_BLOCKED_BY_CLIENT/);
    await assert.rejects(() => isolated.fetch(asset + '?action=checkout&token=' + canary), /ERR_BLOCKED_BY_CLIENT/);
    await assert.rejects(() => isolated.fetch('http://cdn.robertsspaceindustries.com/scripts/cart-widget.js'), /ERR_BLOCKED_BY_CLIENT/);
    assert.equal(served.length, before);
    results.push('Known purchase/change APIs, encoded routes, extension disguises, action queries and static POST never reach the local server; HTTP remains blocked.');

    assert.equal(fs.readFileSync(diagnostics.file, 'utf8').includes(canary), false);
    // Reset only this synthetic log so the 80-event retention cannot hide count changes.
    fs.writeFileSync(diagnostics.file, JSON.stringify({ schemaVersion: 1, appVersion: APP_VERSION, events: [] }));
    const detailCases = [
      ['/api/cart', 'GET', 'api-or-action-path'],
      ['/unknown/cart.js', 'GET', 'unknown-static-root'],
      ['/scripts/cart.bin', 'GET', 'unsupported-file-name'],
      ['/scripts/cart.js?unknown=' + canary, 'GET', 'unsupported-query-key'],
      ['/scripts/cart.js?v=SYNTHETIC%20PRIVATE', 'GET', 'unsupported-query-value'],
      ['/scripts/cart.js', 'POST', 'non-read-method'],
    ];
    for (const [pathname, method, detail] of detailCases) {
      // Isolate each assertion from the diagnostic rate limit and preceding network failures.
      await wait(1100);
      const count = () => JSON.parse(fs.readFileSync(diagnostics.file, 'utf8')).events.filter((e: { blockDetail: string }) => e.blockDetail === detail).length;
      const prior = count();
      await assert.rejects(() => isolated.fetch('https://cdn.robertsspaceindustries.com' + pathname, { method }), /ERR_BLOCKED_BY_CLIENT/);
      assert.equal(count(), prior + 1);
    }
    assert.equal(served.length, before);
    results.push('Actual request guard records distinct fixed exclusions for API, unknown asset root, filename, query key/value and write method; no URL or supplied value stored.');

    await assert.rejects(() => isolated.fetch('https://cdn.robertsspaceindustries.com/scripts/cart-redirect.js'), /ERR_BLOCKED_BY_CLIENT/);
    assert.equal(served.length, before + 1); assert.equal(served.at(-1)?.path, '/scripts/cart-redirect.js');
    results.push('Allowed static URL redirecting to a protected action is checked again and blocked before action dispatch.');

    await original.call(child, origin + '/account/pledges');
    const beforeHangarWidget = served.length;
    await child.webContents.executeJavaScript(`new Promise(resolve => {
      const frame = document.createElement('iframe');
      frame.src = 'https://www.recaptcha.net/recaptcha/enterprise/anchor';
      frame.onload = resolve;
      document.body.append(frame);
    })`);
    assert.equal(served.length, beforeHangarWidget);
    assert.equal(await child.webContents.executeJavaScript(tryGraphqlPost(persistedImageBody)), false);
    assert.equal(await child.webContents.executeJavaScript(tryGraphqlPost(persistedConfirmationBody)), false);
    assert.equal(served.length, beforeHangarWidget);
    assert.equal(await child.webContents.executeJavaScript("fetch('/en/sign-in',{method:'POST'}).then(()=>true,()=>false)"), false);
    const page = await child.webContents.executeJavaScriptInIsolatedWorld(1, [{ code: rsiFetchPageProbe(2, origin + '/account/pledges') }]);
    assert.equal(page.ok, true);
    assert.equal(page.pledges.length, 1);
    results.push('Actual hangar navigation revokes auth submissions and the isolated world can still read a bounded paginated GET.');
    await login.probe(account);
    const frozenBefore = served.length;
    await assert.rejects(() => isolated.fetch('https://robertsspaceindustries.com/api/session', { method: 'POST' }), /ERR_BLOCKED_BY_CLIENT/);
    assert.equal(served.length, frozenBefore);
    const stillReadable = await isolated.fetch(asset); assert.equal(stillReadable.status, 200); await stillReadable.arrayBuffer();
    let prevented = false;
    child.webContents.emit('will-navigate', { preventDefault: () => { prevented = true; } }, 'https://robertsspaceindustries.com/store/cart');
    assert.equal(prevented, true);
    results.push('After structured synthetic hangar probe, general read-only lock still blocks writes; static reads remain possible and store navigation remains denied.');

    await isolated.cookies.set({url:'https://robertsspaceindustries.com',name:'Rsi-Token',value:canary,secure:true,httpOnly:true,path:'/'});
    await child.webContents.executeJavaScript(`(()=>{const meta=document.createElement('meta');meta.name='csrf-token';meta.content=${JSON.stringify(canary)};document.head.append(meta);})()`);
    const creditPosts=()=>served.filter(r=>r.path==='/graphql'&&r.method==='POST').length, beforeLedger=creditPosts();
    const creditCandidate=await login.probe(account);assert.equal(creditCandidate.document.storeCredit?.minor,12500);assert.equal(creditCandidate.document.storeCredit?.currency,'USD');
    const creditCache=new LastSeenStore(path.join(root,'credit-cache')),creditAccount={id:account,name:'Synthetic',mode:'real' as const,reference:null,identityKind:null,identityStatus:'unbound' as const,lastComplete:null};
    creditCache.save(creditAccount,creditCandidate);assert.equal(creditCache.load(creditAccount)?.document.storeCredit?.minor,12500);
    assert.equal(creditCache.load({...creditAccount,id:randomUUID()}),null);
    const withoutCredit=structuredClone(creditCandidate);delete withoutCredit.document.storeCredit;creditCache.save(creditAccount,withoutCredit);assert.equal(creditCache.load(creditAccount)?.document.storeCredit,undefined);
    const posted=creditPosts();assert.equal(posted,beforeLedger+1);
    for(const body of [CREDIT_BODY,'mutation { syntheticPurchase }',CREDIT_BODY+' ',JSON.stringify([{query:'query { customer { otherLedger } }'}])]){
      const passed=await child.webContents.executeJavaScript(`fetch(${JSON.stringify(CREDIT_URL)},{method:'POST',headers:{'content-type':'application/json'},body:${JSON.stringify(body)}}).then(()=>true).catch(()=>false)`);assert.equal(passed,false);
    }
    assert.equal(creditPosts(),posted);results.push('Frozen native RSI session permits only the exact store-credit ledger query; mutations, other queries and modified bodies never reach the local fixture.');

    const bytes = fs.readFileSync(diagnostics.file, 'utf8');
    assert.equal(bytes.includes(canary), false); assert.equal(bytes.includes(account), false); assert.equal(bytes.includes('https://'), false);
    for (const value of Object.values(confirmationOperation.variables)) {
      if (typeof value === 'string') assert.equal(bytes.includes(value), false);
    }
    const events = JSON.parse(bytes).events;
    assert.ok(events.every((e: { appVersion: string }) => e.appVersion === APP_VERSION));
    assert.ok(events.some((e: { reason: string }) => e.reason === 'protected-operation'));
    assert.ok(events.some((e: { reason: string }) => e.reason === 'read-only'));
    results.push('Automatic diagnostic categories retained without synthetic request body, token, account ID or full URL.');
    assert.equal(child.isDestroyed(), false);
    await login.close(account);
    assert.equal(child.isDestroyed(), true); assert.equal(login.status(account).state, 'closed');
    await isolated.closeAllConnections();
  } finally {
    BrowserWindow.prototype.loadURL = original; await login.shutdown(); parent.destroy();
    for (const socket of sockets) socket.destroy();
    if (proxy?.listening) await new Promise<void>(resolve => proxy!.close(() => resolve()));
  }
  fs.writeFileSync(path.join(root, 'results.json'), JSON.stringify({ status: 'PASS', data: 'synthetic-only; local TLS fixture and proxy never forward; external DNS unavailable; ephemeral test certificate not installed', results }, null, 2));
  console.log('PASS: ' + results.join('\nPASS: ')); console.log('REPORT: ' + path.join(root, 'results.json')); app.quit();
}).catch(error => {
  fs.writeFileSync(path.join(root, 'results.json'), JSON.stringify({ status: 'FAIL', results, error: error.message }, null, 2));
  console.error(error.message); app.exit(1);
});
