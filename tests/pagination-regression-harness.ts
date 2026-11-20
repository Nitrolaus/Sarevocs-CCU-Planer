import { app, BrowserWindow, session } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { rsiFetchPageProbe } from '../src/importers/rsi-page';

const root = path.resolve(process.argv.find(x => x.startsWith('--test-root='))!.slice(12));
const baseline = process.argv.includes('--baseline');
fs.mkdirSync(root, { recursive: true });
app.setPath('userData', path.join(root, 'runtime'));
app.setPath('sessionData', path.join(root, 'memory'));
app.setPath('crashDumps', path.join(root, 'crashes'));
app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND');
app.commandLine.appendSwitch('proxy-server', 'http://127.0.0.1:1');
const origin = 'https://robertsspaceindustries.com';
const attr = (s: string) => s.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
const upgrade = attr(JSON.stringify({ match_items: [{ name: 'Synthetic Alpha' }], target_items: [{ name: 'Synthetic Beta' }] }));
const html = '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; connect-src https://robertsspaceindustries.com"><ul class="list-items">' +
  `<li><input class="js-pledge-id" value="synthetic-ccu"><input class="js-pledge-name" value="SYNTHETIC UPGRADE"><input class="js-upgrade-data" value="${upgrade}"><div class="without-images"></div></li></ul>`;
const results: string[] = [];
let win: BrowserWindow | undefined;
let phase = 'INITIALIZATION';
type Mode = 'direct' | 'language-redirect' | 'login-redirect' | 'foreign-redirect';
let mode: Mode = 'direct';
let targetRequests = 0, pageRequests = 0, unexpectedRequests = 0;
let expectedPath = '/en/account/pledges';
let passed = false;
const expect = (x: unknown, code: string) => { if (!x) throw new Error(code); };
const timer = setTimeout(() => { phase = 'WATCHDOG'; app.quit(); }, 20000);
const makeProbe = rsiFetchPageProbe as (page: number, hangarUrl: string) => string;
async function check(name: string, run: () => Promise<void>) { phase = name; pageRequests = 0; targetRequests = 0; await run(); results.push(name); }
function validUpgrade(value: { ok?: boolean; pledges?: { upgrade?: { from?: string; to?: string } }[] }) {
  return value.ok === true && value.pledges?.length === 1 && value.pledges[0]?.upgrade?.from === 'Synthetic Alpha' && value.pledges[0]?.upgrade?.to === 'Synthetic Beta';
}
app.whenReady().then(async () => {
  try {
    const isolated = session.fromPartition('pagination-regression-' + Date.now());
    await isolated.protocol.handle('https', request => {
      const u = new URL(request.url);
      if (u.origin !== origin || request.method !== 'GET') { unexpectedRequests++; return new Response('Blocked synthetic request', { status: 403 }); }
      if (u.pathname === '/en/sign-in') { targetRequests++; return new Response('<input type="password">', { headers: { 'content-type': 'text/html' } }); }
      if (!/^\/(?:[a-z]{2}(?:-[A-Za-z]{2})?\/)?account\/pledges$/.test(u.pathname)) { unexpectedRequests++; return new Response('Blocked synthetic path', { status: 403 }); }
      if (u.search) {
        pageRequests++;
        expect(u.search === '?page=1&pagesize=10', 'UNCONTROLLED_QUERY');
        if (mode === 'language-redirect' && u.pathname === '/account/pledges') return new Response(null, { status: 302, headers: { location: origin + expectedPath + u.search } });
        if (mode === 'login-redirect') return new Response(null, { status: 302, headers: { location: origin + '/en/sign-in' } });
        if (mode === 'foreign-redirect') return new Response(null, { status: 302, headers: { location: 'https://example.invalid/foreign-login' } });
        expect(mode === 'direct' || u.pathname === expectedPath, 'WRONG_LANGUAGE_PATH');
      }
      return new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
    });
    win = new BrowserWindow({ show: false, webPreferences: { session: isolated, sandbox: true, contextIsolation: true, nodeIntegration: false } });
    await win.loadURL(origin + '/en/account/pledges');
    if (baseline) {
      await check('BASELINE_DIRECT_HTML_AND_CCU_CONTROL', async () => {
        const direct = await win!.webContents.executeJavaScript(makeProbe(1, origin + '/en/account/pledges'));
        expect(validUpgrade(direct) && pageRequests === 1, 'BASELINE_DIRECT_CONTROL_FAILED');
      });
      await check('BASELINE_LANGUAGE_REDIRECT_FAILURE_REPRODUCED', async () => {
        mode = 'language-redirect';
        const raw = await win!.webContents.executeJavaScript(makeProbe(1, origin + '/en/account/pledges'));
        expect(raw.ok === false && raw.reason === 'page-read-failed' && pageRequests === 1 && targetRequests === 0, 'BASELINE_FAILURE_NOT_REPRODUCED');
      });
    } else {
      for (const locale of ['en', 'de', 'fr', 'en-US']) {
        await check('LANGUAGE_' + locale.replace('-', '_').toUpperCase() + '_PRESERVES_CCU', async () => {
          mode = 'language-redirect'; expectedPath = '/' + locale + '/account/pledges';
          const raw = await win!.webContents.executeJavaScript(makeProbe(1, origin + expectedPath + '?page=99&private=SYNTHETIC_QUERY_CANARY#SYNTHETIC_HASH_CANARY'));
          expect(validUpgrade(raw) && pageRequests === 1, 'LANGUAGE_PAGE_CCU_FAILED');
        });
      }
      await check('NO_LANGUAGE_USES_FIXED_EN_FALLBACK', async () => {
        mode = 'language-redirect'; expectedPath = '/en/account/pledges';
        const raw = await win!.webContents.executeJavaScript(makeProbe(1, origin + '/account/pledges'));
        expect(validUpgrade(raw) && pageRequests === 1, 'FALLBACK_EN_FAILED');
      });
      for (const redirectMode of ['login-redirect', 'foreign-redirect'] as const) {
        await check(redirectMode === 'login-redirect' ? 'LOGIN_REDIRECT_REMAINS_REJECTED' : 'FOREIGN_REDIRECT_REMAINS_REJECTED', async () => {
          mode = redirectMode;
          const raw = await win!.webContents.executeJavaScript(makeProbe(1, origin + '/en/account/pledges'));
          expect(raw.ok === false && raw.reason === 'page-read-failed' && pageRequests === 1 && targetRequests === 0, 'UNSAFE_REDIRECT_FOLLOWED');
        });
      }
    }
    expect(unexpectedRequests === 0, 'UNEXPECTED_REQUEST');
    fs.writeFileSync(path.join(root, 'results.json'), JSON.stringify({ status: 'PASS', baseline, expectedBaselineFailure: baseline,
      productSourceModifiedByHarness: false, syntheticOnly: true, realRsiNetwork: false, realSessionRead: false, newLogin: false,
      redirectPolicyModified: false, unexpectedRequests, results,
      limit: 'Synthetic Chromium regression; no claim about current server-side RSI session acceptance or real inventory completeness.' }, null, 2));
    console.log('PASS: PAGINATION_REGRESSION_' + (baseline ? 'BASELINE' : 'PRODUCT')); passed = true;
  } catch (e) {
    fs.writeFileSync(path.join(root, 'results.json'), JSON.stringify({ status: 'FAIL', baseline, phase,
      fixedFailure: e instanceof Error && /^[A-Z_]+$/.test(e.message) ? e.message : 'UNCLASSIFIED_SYNTHETIC_FAILURE' }, null, 2));
  } finally {
    clearTimeout(timer); if (win && !win.isDestroyed()) win.destroy(); app.exit(passed ? 0 : 1);
  }
}).catch(() => { clearTimeout(timer); app.exit(1); });
