import { app, BrowserWindow, session } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { RSI_PAGE_PROBE, RSI_CONNECTION_PROBE, rsiFetchPageProbe } from '../src/importers/rsi-page';
import { parseImport } from '../src/importers/files';

const root = path.resolve(process.argv.find(x => x.startsWith('--test-root='))!.slice(12));
const baseline = process.argv.includes('--baseline');
fs.mkdirSync(root, { recursive: true });
app.setPath('userData', path.join(root, 'runtime'));
app.setPath('sessionData', path.join(root, 'memory'));
app.setPath('crashDumps', path.join(root, 'crashes'));
app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND');
app.commandLine.appendSwitch('proxy-server', 'http://127.0.0.1:1');
const origin = 'https://robertsspaceindustries.com', hangar = origin + '/en/account/pledges';
const escape = (s: string) => s.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
const data = (from: string[], to: string[]) => ({ match_items: from.map(name => ({ name })), target_items: to.map(name => ({ name })) });
type Fixture = { id: string; pledge: string; titles: string[]; source: string[]; targets: string[]; targetCandidates: number; expected: string; lti: boolean };
const fixtures: Fixture[] = [
  { id: 'synthetic-three', pledge: 'Upgrade - Synthetic Alpha to Synthetic Beta Warbond Edition', titles: ['Upgrade - Synthetic Alpha to Synthetic Beta'],
    source: ['Synthetic Alpha'], targets: ['Synthetic Beta', 'Synthetic Equipment', 'Lifetime Insurance'], targetCandidates: 2, expected: 'Synthetic Beta', lti: true },
  { id: 'synthetic-five', pledge: 'Upgrade - synthetic alpha to synthetic delta Warbond Edition', titles: ['Upgrade - Synthetic Alpha to Synthetic Delta'],
    source: ['Synthetic Alpha'], targets: ['Synthetic Delta', 'Synthetic Equipment', 'Synthetic Hangar', 'Lifetime Insurance', 'Synthetic Delta Paint'], targetCandidates: 3, expected: 'Synthetic Delta', lti: true },
  { id: 'synthetic-four', pledge: 'Upgrade - Synthetic Alpha to Synthetic Epsilon', titles: [], source: ['Synthetic Alpha', 'Lifetime Insurance'],
    targets: ['Synthetic Epsilon', 'Synthetic Instrument', 'Synthetic Access', 'Synthetic Epsilon Livery'], targetCandidates: 3, expected: 'Synthetic Epsilon', lti: false },
  { id: 'synthetic-module', pledge: 'Upgrade - Synthetic Alpha to Synthetic Beta', titles: ['Upgrade - Synthetic Alpha to Synthetic Beta Module'],
    source: ['Synthetic Alpha'], targets: ['Synthetic Beta Module', 'Synthetic Equipment', 'Lifetime Insurance', 'Synthetic Schematic'], targetCandidates: 2, expected: 'Synthetic Beta Module', lti: true },
];
function item(f: Fixture, raw = JSON.stringify(data(f.source, f.targets))) {
  return `<li><input class="js-pledge-id" value="${escape(f.id)}"><input class="js-pledge-name" value="${escape(f.pledge)}"><input class="js-upgrade-data" value="${escape(raw)}">` +
    '<div class="items-col">Synthetic inventory only</div>' + f.titles.map(title => `<div class="item"><span class="title">${escape(title)}</span><span class="kind">Synthetic</span></div>`).join('') + '<div class="without-images"></div></li>';
}
const page = (rows: string) => '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; connect-src https://robertsspaceindustries.com"><ul class="list-items">' + rows + '</ul>';
type RawPledge = { pledgeId: string; pledgeName?: string; upgrade?: { from: string; to: string }; upgradeIssue?: string;
  upgradeEvidence?: { resolution: string; sourceCandidates: number; targetCandidates: number } };
type Raw = { ok?: boolean; reason?: string; pledges?: RawPledge[]; handle?: string | null };
let body = page(''), win: BrowserWindow | undefined, phase = 'INITIALIZATION', passed = false, unexpectedRequests = 0;
const results: string[] = [];
const expect = (x: unknown, code: string) => { if (!x) throw new Error(code); };
const timer = setTimeout(() => app.quit(), 25000);
async function check(name: string, run: () => Promise<void>) { phase = name; await run(); results.push(name); }
async function load(rows: string) { body = page(rows); await win!.loadURL(hangar); }
async function rawBoth(): Promise<Raw[]> {
  return [await win!.webContents.executeJavaScript(RSI_PAGE_PROBE), await win!.webContents.executeJavaScript(rsiFetchPageProbe(1, hangar))];
}
function normalized(raw: Raw) {
  expect(raw.ok === true, 'VALID_PLEDGE_PAGE_REJECTED');
  return parseImport(JSON.stringify({ type: 'hangarexport', version: 2, handle: 'SYNTHETIC_HANDLE', pledges: raw.pledges }));
}
async function unresolved(f: Fixture, reason = 'ambiguous', raw?: string) {
  await load(item(f, raw));
  expect(await win!.webContents.executeJavaScript(RSI_CONNECTION_PROBE) === 'ready', 'UNRESOLVED_UPGRADE_BLOCKED_WHOLE_HANGAR');
  for (const value of await rawBoth()) {
    const p = value.pledges?.[0];
    expect(value.ok === true && value.pledges?.length === 1 && p?.upgradeIssue === reason && !p.upgrade && !p.upgradeEvidence, 'UNRESOLVED_UPGRADE_INVENTED_TARGET');
    const parsed = normalized(value).document.pledges[0];
    expect(parsed?.ccus.length === 0 && parsed.sourceValues.upgradeState === 'unresolved' && parsed.sourceValues.upgradeIssue === reason && !parsed.sourceValues.upgradeEvidence, 'UNRESOLVED_UPGRADE_USED_TITLE_FALLBACK');
  }
}
app.whenReady().then(async () => {
  try {
    const isolated = session.fromPartition('ccu-targets-' + Date.now());
    await isolated.protocol.handle('https', request => {
      const u = new URL(request.url);
      if (request.method !== 'GET' || u.origin !== origin || u.pathname !== '/en/account/pledges' || (u.search !== '' && u.search !== '?page=1&pagesize=10')) {
        unexpectedRequests++; return new Response('Blocked synthetic request', { status: 403 });
      }
      return new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    });
    win = new BrowserWindow({ show: false, webPreferences: { session: isolated, sandbox: true, contextIsolation: true, nodeIntegration: false } });
    if (baseline) {
      await check('BASELINE_FOUR_MULTITARGET_UPGRADES_UNRESOLVED', async () => {
        await load(fixtures.map(f => item(f)).join(''));
        for (const raw of await rawBoth()) {
          expect(raw.ok === true && raw.pledges?.length === 4 && raw.pledges.every(p => p.upgradeIssue === 'ambiguous' && !p.upgrade), 'BASELINE_AMBIGUITY_NOT_REPRODUCED');
          const parsed = normalized(raw).document.pledges;
          expect(parsed.length === 4 && parsed.every(p => p.ccus.length === 0 && p.sourceValues.upgradeState === 'unresolved'), 'BASELINE_NORMALIZED_AMBIGUITY_NOT_REPRODUCED');
        }
      });
    } else {
      for (const f of fixtures) {
        await check('EXACT_TARGET_' + f.id.replaceAll('-', '_').toUpperCase(), async () => {
          await load(item(f));
          for (const raw of await rawBoth()) {
            const p = raw.pledges?.[0];
            expect(raw.ok === true && raw.pledges?.length === 1 && p?.upgrade?.from === 'Synthetic Alpha' && p.upgrade.to === f.expected && !p.upgradeIssue, 'EXACT_STRUCTURED_TARGET_NOT_RESOLVED');
            expect(p?.upgradeEvidence?.resolution === 'structured-display-match' && p.upgradeEvidence.sourceCandidates === 1 && p.upgradeEvidence.targetCandidates === f.targetCandidates && Object.keys(p.upgradeEvidence).length === 3, 'DISPLAY_SELECTION_FINITE_EVIDENCE_INVALID');
            const parsed = normalized(raw).document.pledges[0], ccu = parsed?.ccus[0];
            expect(parsed?.ccus.length === 1 && ccu?.from === 'Synthetic Alpha' && ccu.to === f.expected && ccu.status === 'unverified' && ccu.applicability === 'unverified', 'CCU_NORMALIZATION_CHANGED_OR_OVERCLAIMED');
            expect((ccu?.insurance.kind === 'lti') === f.lti, 'TARGET_LTI_EVIDENCE_CHANGED_OR_SOURCE_LTI_TRANSFERRED');
            expect(JSON.stringify(JSON.parse(parsed?.sourceValues.upgradeEvidence ?? 'null')) === JSON.stringify(p?.upgradeEvidence), 'NORMALIZED_SELECTION_EVIDENCE_LOST');
            if (f.id === 'synthetic-module') expect(ccu?.to !== 'Synthetic Beta', 'MODULE_FUZZY_MATCHED_TO_BASE_SHIP');
          }
        });
      }
      const base = fixtures[0]!;
      await check('STRUCTURED_UNIQUE_SELECTION_HAS_FINITE_EVIDENCE', async () => {
        await load(item({ ...base, targets: ['Synthetic Beta', 'Lifetime Insurance'] }));
        for (const raw of await rawBoth()) {
          const p = raw.pledges?.[0];
          expect(p?.upgrade?.to === 'Synthetic Beta' && p.upgradeEvidence?.resolution === 'structured-unique' && p.upgradeEvidence.sourceCandidates === 1 && p.upgradeEvidence.targetCandidates === 1, 'UNIQUE_SELECTION_EVIDENCE_INVALID');
        }
      });
      await check('MISSING_UPGRADE_DISPLAY_PAIR_STAYS_UNRESOLVED', () => unresolved({ ...base, pledge: 'SYNTHETIC UPGRADE PACKAGE', titles: ['Synthetic Beta'] }));
      await check('DISPLAY_TARGET_MUST_EXIST_IN_STRUCTURED_TARGETS', () => unresolved({ ...base, pledge: 'Upgrade - Synthetic Alpha to Synthetic Unlisted', titles: [] }));
      await check('DISPLAY_SOURCE_MISMATCH_STAYS_UNRESOLVED', () => unresolved({ ...base, pledge: 'Upgrade - Synthetic Other to Synthetic Beta', titles: [] }));
      await check('MIXED_DISPLAY_SOURCE_CONFLICT_STAYS_UNRESOLVED', () => unresolved({ ...base, pledge: 'Upgrade - Synthetic Other to Synthetic Beta', titles: ['Upgrade - Synthetic Alpha to Synthetic Equipment'] }));
      await check('TWO_DISTINCT_STRUCTURED_TARGET_MATCHES_STAY_UNRESOLVED', () => unresolved({ ...base, titles: ['Upgrade - Synthetic Alpha to Synthetic Equipment'] }));
      await check('CASE_COLLIDING_STRUCTURED_TARGETS_STAY_UNRESOLVED', () => unresolved({ ...base, targets: ['Synthetic Beta', 'synthetic beta', 'Lifetime Insurance'] }));
      await check('MULTIPLE_STRUCTURED_SOURCES_STAY_UNRESOLVED', () => unresolved({ ...base, source: ['Synthetic Alpha', 'Synthetic Other'] }));
      await check('INVALID_JSON_NEVER_USES_DISPLAY_PAIR_FALLBACK', () => unresolved(base, 'unreadable', '{'));
      await check('NONFINAL_WARBOND_TEXT_IS_NOT_STRIPPED', () => unresolved({ ...base, pledge: 'Upgrade - Synthetic Alpha to Synthetic Beta Warbond Edition Extended', titles: [] }));
      await check('MALFORMED_COMPONENTS_ARE_NOT_IGNORED_TO_RESOLVE_TARGET', async () => {
        for (const malformed of [
          { match_items: [{ name: 'Synthetic Alpha' }], target_items: [{ name: 'Synthetic Beta' }, {}] },
          { match_items: [{ name: 'Synthetic Alpha' }], target_items: Array.from({ length: 101 }, () => ({ name: 'Synthetic Beta' })) },
          { match_items: [{ name: 'Synthetic Alpha' }], target_items: [{ name: 'Synthetic Beta' }, { name: '' }] },
        ]) await unresolved(base, 'unreadable', JSON.stringify(malformed));
      });
      await check('FOUR_UPGRADES_SURVIVE_AS_SEPARATE_INSTANCES', async () => {
        await load(fixtures.map(f => item(f)).join(''));
        for (const raw of await rawBoth()) {
          const parsed = normalized(raw).document.pledges;
          expect(parsed.length === 4 && parsed.every(p => p.ccus.length === 1) && new Set(parsed.flatMap(p => p.ccus.map(c => c.instanceId))).size === 4, 'CCU_INSTANCES_MERGED_OR_DROPPED');
        }
      });
      await check('FINITE_EVIDENCE_SCHEMA_AND_NO_ORPHAN_PERSISTENCE', async () => {
        await load(item(base));
        const raw = (await rawBoth())[0]!;
        const valid = raw.pledges?.[0]?.upgradeEvidence!;
        for (const evidence of [
          { ...valid, resolution: 'SYNTHETIC_FREE_TEXT_CANARY' }, { ...valid, sourceCandidates: 0 },
          { ...valid, targetCandidates: 101 }, { ...valid, targetCandidates: 1.5 },
          { ...valid, privateField: 'SYNTHETIC_FREE_TEXT_CANARY' },
        ]) {
          const changed = JSON.parse(JSON.stringify(raw)); changed.pledges[0].upgradeEvidence = evidence;
          let rejected = false; try { normalized(changed); } catch { rejected = true; }
          expect(rejected, 'INVALID_OR_FREE_TEXT_EVIDENCE_ACCEPTED');
        }
        const orphan = JSON.parse(JSON.stringify(raw)); delete orphan.pledges[0].upgrade;
        orphan.pledges[0].pledgeName = 'SYNTHETIC PACKAGE';
        expect(!normalized(orphan).document.pledges[0]?.sourceValues.upgradeEvidence, 'ORPHAN_EVIDENCE_PERSISTED');
        const disputed = JSON.parse(JSON.stringify(raw)); disputed.pledges[0].upgradeIssue = 'ambiguous';
        const parsed = normalized(disputed).document.pledges[0];
        expect(parsed?.ccus.length === 0 && parsed.sourceValues.upgradeIssue === 'ambiguous' && !parsed.sourceValues.upgradeEvidence, 'DISPUTED_EVIDENCE_PERSISTED');
      });
      await check('EVIDENCE_RESOLUTION_MUST_MATCH_CANDIDATE_COUNTS', async () => {
        await load(item(base));
        const raw = (await rawBoth())[0]!;
        const valid = raw.pledges?.[0]?.upgradeEvidence!;
        for (const evidence of [
          { ...valid, sourceCandidates: 2 },
          { ...valid, resolution: 'structured-unique', targetCandidates: 2 },
          { ...valid, resolution: 'structured-display-match', targetCandidates: 1 },
        ]) {
          const changed = JSON.parse(JSON.stringify(raw)); changed.pledges[0].upgradeEvidence = evidence;
          let rejected = false; try { normalized(changed); } catch { rejected = true; }
          expect(rejected, 'INCONSISTENT_SELECTION_EVIDENCE_ACCEPTED');
        }
      });
    }
    expect(unexpectedRequests === 0, 'UNEXPECTED_SYNTHETIC_REQUEST');
    fs.writeFileSync(path.join(root, 'results.json'), JSON.stringify({ status: 'PASS', baseline, expectedBaselineFailure: baseline,
      syntheticOnly: true, realRsiNetwork: false, realSessionRead: false, newLogin: false, targetComponentCounts: fixtures.map(f => f.targets.length),
      liveAndInertDom: true, unexpectedRequests, results,
      limit: 'Synthetic structured targets and display pairs; no real-session test or claim about catalogue identity, applicability, current offers, or complete inventory.' }, null, 2));
    console.log('PASS: CCU_TARGETS_' + (baseline ? 'BASELINE' : 'PRODUCT')); passed = true;
  } catch (e) {
    fs.writeFileSync(path.join(root, 'results.json'), JSON.stringify({ status: 'FAIL', baseline, phase,
      fixedFailure: e instanceof Error && /^[A-Z_]+$/.test(e.message) ? e.message : 'UNCLASSIFIED_SYNTHETIC_FAILURE' }, null, 2));
  } finally {
    clearTimeout(timer); if (win && !win.isDestroyed()) win.destroy(); app.exit(passed ? 0 : 1);
  }
}).catch(() => { clearTimeout(timer); app.exit(1); });
