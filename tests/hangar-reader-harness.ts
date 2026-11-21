import { app, BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { RsiLogin, RSI_CONNECTION_PROBE, RSI_PAGE_PROBE } from '../src/importers/rsi';
import { SessionVault } from '../src/security/session-vault';
import type { ImportCandidate } from '../src/domain/model';

const root = path.resolve(process.argv.find(value => value.startsWith('--test-root='))!.slice(12));
const baseline = process.argv.includes('--baseline');
const ccuBaseline = process.argv.includes('--ccu-baseline');
fs.mkdirSync(root, { recursive: true });
app.setPath('userData', path.join(root, 'runtime'));
app.setPath('sessionData', path.join(root, 'memory'));
app.setPath('crashDumps', path.join(root, 'crashes'));
app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND');
app.commandLine.appendSwitch('proxy-server', 'http://127.0.0.1:1');
const origin = 'https://robertsspaceindustries.com', hangar = origin + '/account/pledges';
const results: string[] = [];
let phase = 'INITIALIZATION';
let baselineEvidence: Record<string, unknown> | undefined;
class CheckFailure extends Error { constructor(readonly fixedCode: string) { super(fixedCode); } }
function expect(value: unknown, code: string): void { if (!value) throw new CheckFailure(code); }
const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
async function bounded<T>(task: Promise<T>, code: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([task, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new CheckFailure(code)), 7000); })]); }
  finally { if (timer) clearTimeout(timer); }
}
type RawPledge = { pledgeId: string; pledgeName: string; upgrade?: { from: string; to: string }; upgradeIssue?: 'ambiguous' | 'unreadable'; alsoContains?: { title: string }[] };
type RawProbe = { ok?: boolean; reason?: string; handle?: string | null; pledges?: RawPledge[] };
type PagePlan = { html: string; status?: number; redirected?: boolean; contentType?: string };
type FetchRecord = { page: number; method: string; credentials: string; redirect: string; cache: string };
const attr = (value: string) => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
function pledge(id: string, name = 'SYNTHETIC PLEDGE', extra = '') {
  return `<li><input class="js-pledge-id" value="${attr(id)}"><input class="js-pledge-name" value="${attr(name)}">${extra}
<div class="items-col">Synthetic contents</div><div class="date-col">Synthetic date</div>
<div class="item"><span class="title">Synthetic ship</span><span class="kind">Ship</span></div><div class="without-images"></div></li>`;
}
const list = (items: string, legacyHandle = false) => (legacyHandle ? '<div class="c-account-sidebar__profile-info-handle">SYNTHETIC_HANDLE</div>' : '') + `<ul class="list-items">${items}</ul>`;
const batch = (first: number, count: number) => list(Array.from({ length: count }, (_value, offset) => pledge('synthetic-' + (first + offset))).join(''));
const emptyList = list('<li><div class="empty-list">No synthetic pledges</div></li>');
const upgradeField = (value: unknown, alreadyJson = false) => `<input class="js-upgrade-data" value="${attr(alreadyJson ? String(value) : JSON.stringify(value))}">`;
const multiComponentUpgrade = { match_items: [{ name: 'Synthetic Alpha' }], target_items: [
  { name: 'Lifetime Insurance' }, { name: 'Synthetic Beta Paint' }, { name: 'Schematic - Synthetic Beta' }, { name: 'Synthetic Beta' }
] };

app.whenReady().then(async () => {
  const originalLoadUrl = BrowserWindow.prototype.loadURL;
  const parent = new BrowserWindow({ show: false, webPreferences: { sandbox: true, nodeIntegration: false } });
  const allLogins: RsiLogin[] = [];
  const pagesBySession = new WeakMap<Electron.Session, { url: string; html: string }>();
  let fixtureBody = '', fixtureUrl = hangar, fetchPages: Record<string, PagePlan> = {}, navigations = 0;
  BrowserWindow.prototype.loadURL = async function(url) {
    expect(url === origin + '/en/sign-in' || url === hangar, 'UNEXPECTED_TOP_LEVEL_NAVIGATION');
    navigations++;
    const stub = `(() => {
      const origin = ${JSON.stringify(origin)}, pages = ${JSON.stringify(fetchPages)};
      const expectedPath = ${JSON.stringify(baseline || ccuBaseline ? '/account/pledges' : '/' + (new URL(fixtureUrl).pathname.match(/^\/([a-z]{2}(?:-[A-Za-z]{2})?)\/account\/pledges/)?.[1] ?? 'en') + '/account/pledges')};
      window.__fetchLog = []; window.__invalidFetch = 0; window.__foreignScript = 0;
      window.fetch = async (input, init = {}) => {
        const url = new URL(typeof input === 'string' ? input : input.url || String(input), origin);
        const page = Number(url.searchParams.get('page'));
        const method = init.method || 'GET';
        // The optional, independent Buy Back reader has its own fixtures.
        if (url.href === origin + '/en/account/buy-back-pledges?page=1&pagesize=250' && method === 'GET') {
          return new Response(null, { status: 404 });
        }
        window.__fetchLog.push({page,method,credentials:init.credentials || '',redirect:init.redirect || '',cache:init.cache || ''});
        if (url.origin !== origin || url.pathname !== expectedPath || !Number.isInteger(page) || page < 1 ||
          url.search !== '?page=' + page + '&pagesize=10' || method !== 'GET' || init.credentials !== 'same-origin' || init.redirect !== 'error' || init.cache !== 'no-store') {
          window.__invalidFetch++; throw new Error('SYNTHETIC_FETCH_POLICY_REJECTED');
        }
        const response = pages[String(page)];
        if (!response) { window.__invalidFetch++; throw new Error('SYNTHETIC_UNPLANNED_PAGE'); }
        const status = response.status || 200;
        return {ok:status >= 200 && status < 300,status,url:url.href,redirected:response.redirected || false,
          headers:{get: name => name.toLowerCase() === 'content-type' ? (response.contentType === undefined ? 'text/html; charset=utf-8' : response.contentType || null) : null},
          body:new Response(response.html).body,text:async () => response.html};
      };
    })();`;
    const html = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'">
<body><script>${stub.replaceAll('</script', '<\\/script')}</script>${fixtureBody}</body>`;
    const isolated = this.webContents.session;
    if (!pagesBySession.has(isolated)) isolated.protocol.handle('https', request => {
      const page = pagesBySession.get(isolated);
      return page && request.url === page.url && request.method === 'GET'
        ? new Response(page.html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
        : new Response(null, { status: 403 });
    });
    pagesBySession.set(isolated, { url, html });
    this.webContents.getURL = () => fixtureUrl;
    // Fixture fetch is defined in the document. The TLS request-policy test exercises the real isolated world.
    this.webContents.executeJavaScriptInIsolatedWorld = (_id, scripts) => this.webContents.executeJavaScript(scripts[0]!.code);
    await originalLoadUrl.call(this, url);
  };
  async function withPage<T>(body: string, run: (value: RsiLogin, id: string, win: BrowserWindow) => Promise<T>,
    pages: Record<string, PagePlan> = {}, currentUrl = hangar): Promise<T> {
    fixtureBody = body; fetchPages = pages; fixtureUrl = currentUrl; navigations = 0;
    const value = new RsiLogin({ load: async () => [], save: async () => false } as unknown as SessionVault);
    allLogins.push(value); const id = randomUUID();
    await value.open(id, parent, false);
    let win: BrowserWindow | undefined, loaded = false;
    for (let i = 0; i < 150; i++) {
      win = BrowserWindow.getAllWindows().find(window => window !== parent);
      if (win && !win.webContents.isLoadingMainFrame() && await win.webContents.executeJavaScript('Boolean(window.__fetchLog)')) { loaded = true; break; }
      await wait(20);
    }
    expect(win && loaded, 'SYNTHETIC_PAGE_NOT_READY');
    try { return await run(value, id, win!); }
    finally { await value.close(id); }
  }
  async function raw(win: BrowserWindow): Promise<RawProbe> { return win.webContents.executeJavaScript(RSI_PAGE_PROBE); }
  async function observation(win: BrowserWindow): Promise<unknown> { return win.webContents.executeJavaScript(RSI_CONNECTION_PROBE); }
  async function probe(value: RsiLogin, id: string): Promise<ImportCandidate> { return bounded(value.probe(id), 'READER_DID_NOT_SETTLE'); }
  async function rejected(value: RsiLogin, id: string, code: string) {
    let error: unknown;
    try { await probe(value, id); } catch (failure) { error = failure; }
    expect(error instanceof Error && !(error instanceof CheckFailure), code);
    expect(value.status(id).state !== 'page-ready', 'REJECTED_PAGE_MARKED_READY');
  }
  async function check(id: string, run: () => Promise<void>) { phase = id; await run(); results.push(id); }
  async function calls(win: BrowserWindow): Promise<FetchRecord[]> { return win.webContents.executeJavaScript('window.__fetchLog'); }
  async function noNetworkViolation(win: BrowserWindow) {
    expect(await win.webContents.executeJavaScript('window.__invalidFetch === 0'), 'READER_REQUESTED_UNAPPROVED_PAGE');
    expect(navigations === 1, 'READER_NAVIGATED_OR_REOPENED_LOGIN');
  }
  try {
    if (ccuBaseline) {
      await check('MULTICOMPONENT_CCU_BASELINE', async () => {
        await withPage(list(pledge('synthetic-components', 'SYNTHETIC UPGRADE PACKAGE', upgradeField(multiComponentUpgrade))), async (_value, _id, win) => {
          expect(await win.webContents.executeJavaScript('document.querySelectorAll(".list-items > li").length === 1 && Boolean(document.querySelector(".js-pledge-id").value) && Boolean(document.querySelector(".js-pledge-name").value)'), 'CCU_BASELINE_FIXTURE_INVALID');
          const result = await raw(win), state = await observation(win);
          if (result.ok === false && result.reason === 'upgrade-fields' && state === 'upgrade-fields') {
            baselineEvidence = { validPledge: true, sourceItems: 1, targetItems: 4, rawReason: 'upgrade-fields', connectionStatus: 'upgrade-fields' };
            throw new CheckFailure('MULTICOMPONENT_CCU_REJECTED_AS_UPGRADE_FIELDS');
          }
          throw new CheckFailure('EXPECTED_CCU_BASELINE_REGRESSION_NOT_REPRODUCED');
        });
      });
    }
    await check('READINESS_WITHOUT_LEGACY_HANDLE_10_AND_2', async () => {
      const observed: unknown[] = [], rawOk: boolean[] = [], counts: number[] = [];
      for (const count of [10, 2]) {
        await withPage(batch(1, count), async (_value, _id, win) => {
          const domCount = await win.webContents.executeJavaScript('document.querySelectorAll(".list-items > li").length');
          expect(domCount === count, 'READINESS_FIXTURE_PLEDGE_COUNT_INVALID');
          expect(await win.webContents.executeJavaScript('!document.querySelector(".c-account-sidebar__profile-info-handle") && [...document.querySelectorAll(".list-items > li")].every(n => n.querySelector(".js-pledge-id").value && n.querySelector(".js-pledge-name").value)'), 'READINESS_FIXTURE_INVALID');
          const result = await raw(win); observed.push(await observation(win)); rawOk.push(result.ok === true); counts.push(domCount);
        });
      }
      let legacyReady = false;
      await withPage(list(pledge('synthetic-control'), true), async (_value, _id, win) => { legacyReady = await observation(win) === 'ready'; });
      if (baseline && observed.every(value => value === 'waiting') && rawOk.every(value => !value) && legacyReady) {
        baselineEvidence = { legacyHandleAbsent: true, validDirectPledgeCounts: counts, connectionStatuses: observed, legacyControlReady: true };
        throw new CheckFailure('LEGACY_HANDLE_REQUIREMENT_RETURNS_WAITING');
      }
      expect(observed.every(value => value === 'ready') && rawOk.every(Boolean) && legacyReady, 'VALID_HANGAR_NOT_RECOGNIZED_WITHOUT_HANDLE');
    });

    await check('MISSING_HANDLE_USES_LOCAL_MANUAL_REFERENCE', async () => {
      await withPage(batch(1, 1), async (value, id, win) => {
        const result = await raw(win);
        expect(result.ok === true && result.handle === null && result.pledges?.length === 1, 'MISSING_HANDLE_RAW_RESULT_INVALID');
        expect(await observation(win) === 'ready', 'SINGLE_PLEDGE_NOT_READY');
        const candidate = await probe(value, id);
        expect(candidate.document.account.identityKind === 'manual-reference' && candidate.document.account.reference === 'rsi-local:' + id, 'MISSING_HANDLE_INVENTED_RSI_IDENTITY');
        expect(candidate.adapter === 'rsi-dom-probe/1' && candidate.document.pledges.length === 1 && candidate.completeness === 'partial', 'MISSING_HANDLE_CANDIDATE_INVALID');
        expect(candidate.warnings.some(text => /bestätig|zuordn/i.test(text)), 'MANUAL_ACCOUNT_CONFIRMATION_WARNING_MISSING');
        expect(value.status(id).state === 'page-ready' && !win.isDestroyed(), 'SUCCESS_STATUS_OR_WINDOW_INVALID');
        expect((await calls(win)).length === 0, 'SHORT_INITIAL_PAGE_FETCHED_UNNECESSARILY');
        await noNetworkViolation(win);
      });
    });

    await check('LEGACY_HANDLE_REMAINS_AUTHORITATIVE_SOURCE_REFERENCE', async () => {
      await withPage(list(pledge('synthetic-legacy'), true), async (value, id, win) => {
        const candidate = await probe(value, id);
        expect((await raw(win)).handle === 'SYNTHETIC_HANDLE', 'LEGACY_HANDLE_DROPPED');
        expect(candidate.document.account.identityKind === 'rsi-handle' && candidate.document.account.reference === 'SYNTHETIC_HANDLE', 'LEGACY_HANDLE_CHANGED_TO_LOCAL_IDENTITY');
      });
    });

    await check('DIRECT_LIST_ITEMS_AND_EXPLICIT_EMPTY_LIST', async () => {
      const wrapper = '<div><input class="js-pledge-id" value="synthetic-wrapped"><input class="js-pledge-name" value="WRAPPED"></div><script type="application/json">{}</script>';
      await withPage(list(wrapper + pledge('synthetic-direct')), async (value, id, win) => {
        const result = await raw(win);
        expect(result.ok === true && result.pledges?.length === 1 && result.pledges[0]?.pledgeId === 'synthetic-direct', 'WRAPPER_OR_EMPTY_MARKER_IMPORTED');
        expect((await probe(value, id)).document.pledges.length === 1, 'DIRECT_ITEM_CANDIDATE_INVALID');
      });
      await withPage(emptyList, async (value, id, win) => {
        expect(await observation(win) === 'ready', 'EXPLICIT_EMPTY_HANGAR_NOT_READY');
        expect((await raw(win)).pledges?.length === 0 && (await probe(value, id)).document.pledges.length === 0, 'EMPTY_HANGAR_INVENTED_PLEDGES');
      });
      await withPage(list(''), async (_value, _id, win) => { expect((await raw(win)).ok === false && await observation(win) !== 'ready', 'UNMARKED_EMPTY_LIST_MARKED_READY'); });
    });

    await check('INVALID_PLEDGE_FIELDS_HAVE_FIXED_FAILURE', async () => {
      for (const [id, name] of [['', 'SYNTHETIC'], ['synthetic-invalid', ''], ['x'.repeat(161), 'SYNTHETIC'], ['synthetic-invalid', 'x'.repeat(501)], ['synthetic-invalid', ': SYNTHETIC']]) {
        await withPage(list(pledge(id!, name!)), async (value, accountId, win) => {
          const result = await raw(win);
          expect(result.ok === false && result.reason === 'pledge-fields', 'INVALID_FIELD_NOT_DIAGNOSABLE');
          expect(await observation(win) !== 'ready', 'INVALID_FIELD_MARKED_READY');
          await rejected(value, accountId, 'INVALID_FIELD_SILENTLY_IMPORTED');
        });
      }
    });

    await check('STRUCTURED_CCU_NAMES_PRESERVED', async () => {
      const data = JSON.stringify({ match_items: [{ name: 'Synthetic Alpha' }], target_items: [{ name: 'Synthetic Beta' }] });
      await withPage(list(pledge('synthetic-ccu', 'SYNTHETIC UPGRADE PACKAGE', `<input class="js-upgrade-data" value="${attr(data)}">`)), async (value, id, win) => {
        const result = await raw(win), upgrade = result.pledges?.[0]?.upgrade;
        expect(upgrade?.from === 'Synthetic Alpha' && upgrade.to === 'Synthetic Beta', 'STRUCTURED_CCU_NAMES_NOT_EXTRACTED');
        const ccu = (await probe(value, id)).document.pledges[0]?.ccus[0];
        expect(ccu?.from === 'Synthetic Alpha' && ccu.to === 'Synthetic Beta' && ccu.status === 'unverified' && ccu.applicability === 'unverified', 'STRUCTURED_CCU_NAMES_CHANGED_OR_OVERCLAIMED');
      });
      const ambiguous = JSON.stringify({ match_items: [{ name: 'Synthetic Alpha' }, { name: 'Synthetic Other' }], target_items: [{ name: 'Synthetic Beta' }] });
      await withPage(list(pledge('synthetic-ambiguous', 'Upgrade - Wrong Alpha to Wrong Beta', upgradeField(ambiguous, true))), async (value, id, win) => {
        const result = await raw(win);
        expect(result.ok === true && result.pledges?.[0]?.upgradeIssue === 'ambiguous' && !result.pledges[0]?.upgrade, 'AMBIGUOUS_STRUCTURED_CCU_NOT_PRESERVED');
        expect(await observation(win) === 'ready', 'AMBIGUOUS_CCU_STOPPED_VALID_HANGAR');
        const candidate = await probe(value, id), p = candidate.document.pledges[0];
        expect(p?.ccus.length === 0 && p.sourceValues.upgradeState === 'unresolved', 'AMBIGUOUS_CCU_USED_TITLE_FALLBACK');
        expect(candidate.warnings.some(text => /CCU-Zuordnung ist ungeklärt/.test(text)), 'AMBIGUOUS_CCU_WARNING_MISSING');
      });
    });

    await check('MULTICOMPONENT_CCU_AND_EXACT_DUPLICATES', async () => {
      const variants = [multiComponentUpgrade, { match_items: [{ name: 'Synthetic Alpha' }], target_items: [...multiComponentUpgrade.target_items].reverse() },
        { match_items: [{ name: ' Synthetic Alpha ' }, { name: 'Synthetic Alpha' }, { name: 'Synthetic Alpha Skin' }],
          target_items: [...multiComponentUpgrade.target_items, { name: ' Synthetic Beta ' }, { name: 'Synthetic Beta Livery' }, { name: 'Blueprint - Synthetic Beta' }],
          unknownPrivateField: 'SYNTHETIC_UPGRADE_JSON_CANARY' }];
      for (const data of variants) {
        await withPage(list(pledge('synthetic-components', 'SYNTHETIC UPGRADE PACKAGE', upgradeField(data))), async (value, id, win) => {
          const result = await raw(win), parsed = result.pledges?.[0];
          expect(result.ok === true && parsed?.upgrade?.from === 'Synthetic Alpha' && parsed.upgrade.to === 'Synthetic Beta' && !parsed.upgradeIssue, 'MULTICOMPONENT_CCU_NOT_RESOLVED');
          expect(parsed?.alsoContains?.some(item => item.title === 'Lifetime Insurance'), 'TARGET_LTI_EVIDENCE_NOT_EXTRACTED');
          expect(!JSON.stringify(result).includes('SYNTHETIC_UPGRADE_JSON_CANARY') && !JSON.stringify(result).includes('match_items'), 'RAW_UPGRADE_JSON_LEAKED');
          const candidate = await probe(value, id), ccu = candidate.document.pledges[0]?.ccus[0];
          expect(ccu?.from === 'Synthetic Alpha' && ccu.to === 'Synthetic Beta' && ccu.insurance.kind === 'lti', 'MULTICOMPONENT_CCU_NORMALIZATION_INVALID');
          expect(ccu?.status === 'unverified' && ccu.applicability === 'unverified', 'MULTICOMPONENT_CCU_IDENTITY_OVERCLAIMED');
          expect(!JSON.stringify(candidate).includes('SYNTHETIC_UPGRADE_JSON_CANARY'), 'NORMALIZED_UPGRADE_JSON_LEAKED');
          await noNetworkViolation(win);
        });
      }
      for (const targetName of ['120 Month Insurance', 'Lifetime Insurance Bonus']) {
        await withPage(list(pledge('synthetic-source-insurance', 'SYNTHETIC UPGRADE PACKAGE', upgradeField({
          match_items: [{ name: 'Lifetime Insurance' }, { name: 'Synthetic Alpha' }], target_items: [{ name: targetName }, { name: 'Synthetic Beta' }]
        }))), async (value, id) => {
          expect((await probe(value, id)).document.pledges[0]?.ccus[0]?.insurance.kind === 'unknown', 'SOURCE_OR_INEXACT_LTI_ASSUMED');
        });
      }
    });

    await check('UNREADABLE_CCU_PRESERVES_MIXED_HANGAR', async () => {
      const invalid = ['{', '', JSON.stringify({ match_items: [], target_items: [{ name: 'Synthetic Beta' }] }),
        JSON.stringify({ match_items: [{ name: 'Synthetic Alpha' }], target_items: [{ name: 'x'.repeat(501) }] }),
        JSON.stringify({ match_items: [{ name: 'Synthetic Alpha' }], target_items: Array.from({ length: 101 }, () => ({ name: 'Synthetic Beta' })) })];
      for (const data of invalid) {
        const body = list(pledge('synthetic-normal') + pledge('synthetic-unreadable', 'Upgrade - Wrong Alpha to Wrong Beta', upgradeField(data, true)) +
          pledge('synthetic-resolved', 'SYNTHETIC UPGRADE PACKAGE', upgradeField(multiComponentUpgrade)));
        await withPage(body, async (value, id, win) => {
          const result = await raw(win);
          expect(result.ok === true && result.pledges?.length === 3 && result.pledges[1]?.upgradeIssue === 'unreadable', 'UNREADABLE_CCU_ABORTED_PAGE');
          const candidate = await probe(value, id), unresolved = candidate.document.pledges[1];
          expect(candidate.document.pledges.length === 3 && unresolved?.ccus.length === 0 && unresolved.sourceValues.upgradeState === 'unresolved', 'UNREADABLE_CCU_PLEDGE_DROPPED_OR_GUESSED');
          expect(candidate.document.pledges[2]?.ccus.length === 1 && candidate.completeness === 'partial', 'MIXED_HANGAR_KNOWN_CCU_DROPPED');
          expect(candidate.warnings.some(text => /CCU-Zuordnung ist ungeklärt/.test(text)), 'UNREADABLE_CCU_WARNING_MISSING');
          await noNetworkViolation(win);
        });
      }
      await withPage(batch(1, 10), async (value, id, win) => {
        const candidate = await probe(value, id), last = candidate.document.pledges.at(-1);
        expect(candidate.document.pledges.length === 12 && last?.sourceValues.upgradeState === 'unresolved' && last.ccus.length === 0, 'FETCHED_UNREADABLE_CCU_ABORTED_MIXED_HANGAR');
        expect((await calls(win)).map(call => call.page).join(',') === '1,2', 'MIXED_HANGAR_PAGE_SEQUENCE_INVALID');
        await noNetworkViolation(win);
      }, { '1': { html: batch(1, 10) }, '2': { html: list(pledge('synthetic-11') + pledge('synthetic-12', 'Upgrade - Wrong Alpha to Wrong Beta', upgradeField('{', true))) } });
    });

    await check('MISSING_LIST_COOKIE_AND_LOGIN_ARE_NOT_READY', async () => {
      await withPage('<p>Synthetic page still loading</p>', async (_value, _id, win) => {
        const result = await raw(win); expect(result.ok === false && result.reason === 'list-missing' && await observation(win) !== 'ready', 'MISSING_LIST_MARKED_READY');
      });
      await withPage(batch(1, 1) + '<button>Use necessary cookies only</button>', async (value, id, win) => {
        expect((await raw(win)).reason === 'cookie-consent' && await observation(win) === 'consent', 'COOKIE_CONSENT_MARKED_READY');
        await rejected(value, id, 'COOKIE_CONSENT_SILENTLY_BYPASSED');
      });
      for (const body of ['<input type="password"><p>Synthetic login</p>', '<p>You must be authenticated to reach this area.</p>']) {
        await withPage(body, async (value, id, win) => {
          expect(await observation(win) === 'login', 'LOGIN_PAGE_MARKED_READY');
          await rejected(value, id, 'LOGIN_PAGE_SILENTLY_IMPORTED');
        });
      }
    });

    await check('DUPLICATE_PLEDGES_REJECTED', async () => {
      await withPage(list(pledge('synthetic-duplicate') + pledge('synthetic-duplicate')), async (value, id, win) => {
        expect((await raw(win)).pledges?.length === 2, 'DUPLICATE_FIXTURE_NOT_READ');
        await rejected(value, id, 'DUPLICATE_PLEDGES_SILENTLY_ACCEPTED');
      });
    });

    await check('MULTIPAGE_10_PLUS_2_ONLY_CONTROLLED_GETS', async () => {
      const pages = { '1': { html: batch(1, 10) }, '2': { html: batch(11, 2) + '<script>window.__foreignScript=1</script>' } };
      await withPage(batch(1, 10), async (value, id, win) => {
        const candidate = await probe(value, id), fetches = await calls(win);
        expect(candidate.document.pledges.length === 12 && new Set(candidate.document.pledges.map(pledge => pledge.pledgeId)).size === 12, 'MULTIPAGE_PLEDGES_MISSING_OR_DUPLICATED');
        expect(fetches.length === 2 && fetches[0]?.page === 1 && fetches[1]?.page === 2, 'MULTIPAGE_ORDER_OR_STOP_INVALID');
        expect(candidate.completeness === 'partial' && candidate.document.scope.exportComplete === false && candidate.document.scope.pagesRead === 2, 'MULTIPAGE_COMPLETENESS_OVERCLAIMED');
        expect(await win.webContents.executeJavaScript('window.__foreignScript === 0'), 'FETCHED_SCRIPT_EXECUTED');
        await noNetworkViolation(win);
      }, pages);
      await withPage(batch(11, 2), async (value, id, win) => {
        expect((await probe(value, id)).document.pledges.length === 12, 'QUERY_PAGE_NOT_RESTARTED_AT_PAGE_ONE');
        expect((await calls(win)).map(value => value.page).join(',') === '1,2', 'QUERY_PAGE_ORDER_INVALID');
        await noNetworkViolation(win);
      }, pages, hangar + '?page=2&pagesize=10');
    });

    await check('MULTIPAGE_EMPTY_END_SUCCEEDS_REPEATED_PAGE_REJECTED', async () => {
      await withPage(batch(1,10),async(value,id,win)=>{
        const candidate=await probe(value,id);expect(candidate.document.pledges.length===10&&candidate.completeness==='partial','EMPTY_END_INVALID');expect((await calls(win)).length===2,'EMPTY_END_LOOPED');await noNetworkViolation(win);
      },{'1':{html:batch(1,10)},'2':{html:emptyList}});
      await withPage(batch(1,10),async(value,id,win)=>{
        await rejected(value,id,'REPEATED_PAGE_SILENTLY_IMPORTED');expect((await calls(win)).length===2,'REPEAT_LOOPED');await noNetworkViolation(win);
      },{'1':{html:batch(1,10)},'2':{html:batch(1,10)}});
    });

    await check('MULTIPAGE_OVERLAP_LOGIN_REDIRECT_AND_BAD_FIELDS_REJECTED', async () => {
      const endings: PagePlan[] = [{ html: batch(10, 2) }, { html: '<input type="password"><p>Synthetic login</p>' },
        { html: batch(11, 2), redirected: true }, { html: list(pledge('', 'SYNTHETIC INVALID')) },
        { html: batch(11, 2), status: 503 }, { html: batch(11, 2), contentType: '' }, { html: batch(11, 2), contentType: 'text/plain' }];
      for (const ending of endings) {
        await withPage(batch(1, 10), async (value, id, win) => {
          await rejected(value, id, 'MULTIPAGE_UNSAFE_OR_INVALID_RESPONSE_ACCEPTED');
          expect((await calls(win)).length === (ending.status === 503 ? 4 : 2), 'MULTIPAGE_FAILURE_NAVIGATED_OR_LOOPED');
          await noNetworkViolation(win);
        }, { '1': { html: batch(1, 10) }, '2': ending });
      }
    });
  } finally {
    for (const value of allLogins) await value.shutdown();
    BrowserWindow.prototype.loadURL = originalLoadUrl; parent.destroy();
  }
  fs.writeFileSync(path.join(root, 'results.json'), JSON.stringify({ status: 'PASS', data: 'synthetic-only; local file fixtures; controlled fetch stubs; DNS blocked; dead proxy', results }, null, 2));
  for (const result of results) console.log('PASS: ' + result);
  console.log('REPORT: ' + path.join(root, 'results.json')); app.quit();
}).catch(error => {
  const failureCode = error instanceof CheckFailure ? error.fixedCode : 'UNEXPECTED_HARNESS_FAILURE';
  const expectedBaselineFailure = (baseline && phase === 'READINESS_WITHOUT_LEGACY_HANDLE_10_AND_2' &&
    failureCode === 'LEGACY_HANDLE_REQUIREMENT_RETURNS_WAITING' && baselineEvidence?.legacyControlReady === true) ||
    (ccuBaseline && phase === 'MULTICOMPONENT_CCU_BASELINE' && failureCode === 'MULTICOMPONENT_CCU_REJECTED_AS_UPGRADE_FIELDS' && baselineEvidence?.validPledge === true);
  fs.writeFileSync(path.join(root, 'results.json'), JSON.stringify({ status: 'FAIL', phase, failureCode, expectedBaselineFailure,
    ...(baselineEvidence ? { evidence: baselineEvidence } : {}), results }, null, 2));
  console.error('FAIL: ' + failureCode); console.log('REPORT: ' + path.join(root, 'results.json')); app.exit(1);
});
