import { _electron } from 'playwright-core';
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';

const project = process.cwd(), folder = path.resolve('work/temp/upgrade-history-ui', randomUUID());
fs.mkdirSync(folder, { recursive: true });
const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
await build({ entryPoints: ['src/ui/App.tsx'], outfile: path.join(folder, 'app.js'), bundle: true, platform: 'browser', format: 'iife', target: 'chrome144' });
fs.copyFileSync('assets/app.svg', path.join(folder, 'app.svg'));
fs.copyFileSync('assets/app.png', path.join(folder, 'app.png'));
fs.copyFileSync('tests/fixtures/upgrade-history-ui-main.cjs', path.join(folder, 'fixture-main.cjs'));
fs.copyFileSync('tests/fixtures/ship-display-preload.cjs', path.join(folder, 'fixture-preload.cjs'));
fs.writeFileSync(path.join(folder, 'index.html'), `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'none'; base-uri 'none'"><title>VORSCHAU · künstliche Tooltip-Testdaten</title><link rel="stylesheet" href="app.css"></head><body><div id="root"></div><script src="app.js"></script></body></html>`);
const ids = { a: '11111111-1111-4111-8111-111111111111', b: '22222222-2222-4222-8222-222222222222', c: '33333333-3333-4333-8333-333333333333' };
const revisions = { a: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', b: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', next: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' };
const accounts = Object.values(ids).map((id, index) => ({ id, name: 'VORSCHAU · Testdaten ' + ['A', 'B', 'C'][index], mode: 'real', reference: null, identityKind: null, identityStatus: 'unbound', lastComplete: null }));
const insurance = { kind: 'unknown', reason: 'Künstliche Testdaten' };
function pledge(pledgeId, name, models, extra = {}) {
  return { pledgeId, name, insurance, originalDescription: 'SYNTHETIC ONLY', ships: models.map((modelName, n) => ({ childId: pledgeId + '-' + n, modelName,
    modelId: null, identity: 'unresolved', role: 'unverified' })), ccus: [], protected: true, baseReleased: false, restrictions: [], acquisitionCost: null,
    unknownCostReason: 'Künstliche Testdaten', meltValue: null, sourceValues: {}, ...extra };
}
const pledges = [pledge('1001', 'Standalone Ships - Shiv', ['Paladin']), pledge('1002', 'Synthetic Multi-Ship Package', ['Shiv', 'Paladin']),
  ...['1003', '1004', '1005', '1006'].map(id => pledge(id, 'Synthetic Ship ' + id, ['Synthetic Model ' + id])),
  pledge('1007', 'Synthetic CCU', ['Synthetic CCU Child'], { ccus: [{ instanceId: 'synthetic-ccu', from: 'Synthetic Alpha', to: 'Synthetic Beta', status: 'unverified', applicability: 'unverified', insurance }] }),
  pledge('1008', 'Synthetic unresolved upgrade', ['Synthetic unresolved child'], { sourceValues: { upgradeState: 'unresolved' } }), pledge('1009', 'Synthetic unknown contents', [])];
function view(accountId, revision, prefix = '') {
  const at = new Date(Date.now() + 60000).toISOString(), items = structuredClone(pledges);
  for (const p of items) for (const s of p.ships) s.modelName = prefix + s.modelName;
  return { schemaVersion: 1, accountId, revision, observedAt: at, document: { type: 'sarevocs-ccu-inventory', schemaVersion: 1, appVersion: version,
    createdAt: at, dataMode: 'real', account: { reference: 'rsi-local:' + accountId, identityKind: 'manual-reference' },
    scope: { kind: 'partial', exportComplete: false, expectedPledges: null, pagesExpected: null, pagesRead: 1 }, pledges: items, buybacks: [] } };
}
const fixture = { state: { accounts, selectedAccountId: ids.a, dataDir: 'Künstlicher Testordner · keine echten Nutzerdaten', version: version + ' · VORSCHAU', packaged: false, electron: 'fixture', node: 'fixture' },
  inventories: Object.fromEntries(accounts.map(account => [account.id, { account, items: account.id === ids.c ? [{ pledge: pledge('2001', 'Synthetic canonical ship', ['Synthetic Canonical']), availability: 'present', source: 'hangarlink-v2/1', importedAt: new Date().toISOString() }] : [], buybacks: [] }])),
  views: { [ids.a]: view(ids.a, revisions.a), [ids.b]: view(ids.b, revisions.b, 'B '), [ids.c]: null } };
fs.writeFileSync(path.join(folder, 'fixture.json'), JSON.stringify(fixture));
const require = createRequire(import.meta.url), env = { ...process.env, TEMP: path.join(folder, 'tmp'), TMP: path.join(folder, 'tmp') };
fs.mkdirSync(env.TEMP, { recursive: true }); delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
const checks = [], titles = {}, pageErrors = [];
let application, page;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, code) { for (let n = 0; n < 400; n++) { if (await predicate()) return; await wait(20); } throw new Error(code); }
async function check(name, run) { await run(); checks.push(name); console.log('PASS: ' + name); }
const cell = pledgeId => page.locator('tbody tr').filter({ hasText: 'Pledge: ' + pledgeId }).locator('td').first();
const key = (accountId, revision, pledgeId) => ({ accountId, revision, pledgeId });
const histories = () => application.evaluate(() => globalThis.fixture.commands.filter(c => c.action === 'rsi.upgradeHistory'));
const requestCount = async target => (await histories()).filter(c => c.accountId === target.accountId && c.revision === target.revision && c.pledgeId === target.pledgeId).length;
async function resolve(target, result) { await application.evaluate((_electron, { target, result }) => globalThis.resolveHistory(target, result), { target, result }); }
async function titleContains(pledgeId, text) { await until(async () => (await cell(pledgeId).getAttribute('title'))?.includes(text), 'EXPECTED_NATIVE_TITLE_MISSING'); }
const loaded = (steps = [], partial = false) => ({ status: 'loaded', steps, partial });
const mainSteps = [{ from: 'Shiv', to: 'Synthetic Alpha', appliedAt: '2026-11-01 23:30' }, { from: 'Synthetic Alpha', to: 'Paladin', appliedAt: '2026-11-02 00:15' }];
try {
  application = await _electron.launch({ executablePath: require('electron'), args: [path.join(folder, 'fixture-main.cjs'), '--disable-gpu', '--disable-background-networking', '--host-resolver-rules=MAP * ~NOTFOUND', '--proxy-server=http://127.0.0.1:9'], cwd: project, env });
  page = await application.firstWindow(); page.on('pageerror', e => pageErrors.push(e.message));
  await page.getByRole('button', { name: 'Alle Gegenstände', exact: true }).click();
  await cell('1009').waitFor();
  await check('NO_AUTOMATIC_HISTORY_LOGIN_OR_REFRESH_ON_START', async () => assert.equal((await histories()).length, 0));
  await check('HOVER_AND_FOCUS_SHARE_ONE_PENDING_HISTORY_AND_NATIVE_TITLE', async () => {
    const target = key(ids.a, revisions.a, '1001');
    await cell('1001').hover(); await cell('1001').focus();
    await until(async () => await requestCount(target) === 1, 'LAZY_HISTORY_REQUEST_MISSING');
    await titleContains('1001', 'wird geladen');
    await resolve(target, loaded(mainSteps)); await titleContains('1001', 'Shiv → Synthetic Alpha');
    titles.singleShip = await cell('1001').getAttribute('title');
    assert.ok(titles.singleShip.includes('Pledge: Standalone Ships - Shiv\nAktuell: Paladin'));
    assert.ok(titles.singleShip.includes('01.11.2026 23:30') && titles.singleShip.includes('02.11.2026 00:15'));
    assert.ok(titles.singleShip.indexOf('Shiv →') < titles.singleShip.indexOf('Alpha →'));
    assert.equal(await cell('1001').locator('small').count(), 1);
    await page.locator('h1').first().hover(); await cell('1001').hover(); assert.equal(await requestCount(target), 1);
  });
  await check('PACKAGE_PARTIAL_AND_EMPTY_RESULTS_ARE_EXPLICIT', async () => {
    await cell('1002').focus(); await until(async () => await requestCount(key(ids.a, revisions.a, '1002')) === 1, 'PACKAGE_REQUEST_MISSING');
    await resolve(key(ids.a, revisions.a, '1002'), loaded([{ from: 'Shiv', to: 'Paladin', appliedAt: null }], true));
    await titleContains('1002', 'Zuordnung zu Paketkindern ungeprüft'); await titleContains('1002', 'Unvollständiges');
    titles.package = await cell('1002').getAttribute('title');
    await cell('1003').focus(); await until(async () => await requestCount(key(ids.a, revisions.a, '1003')) === 1, 'EMPTY_REQUEST_MISSING');
    await resolve(key(ids.a, revisions.a, '1003'), loaded()); await titleContains('1003', 'Keine Upgrade-Schritte im abgerufenen RSI-Protokoll.');
    titles.empty = await cell('1003').getAttribute('title');
  });
  await check('UNAVAILABLE_AUTH_REQUIRED_AND_CANCELLED_STAY_LOCAL_AND_MEMOIZED', async () => {
    for (const [pledgeId, status, text] of [['1004', 'unavailable', 'derzeit nicht verfügbar'], ['1005', 'auth-required', 'gültige RSI-Sitzung'], ['1006', 'cancelled', 'abgebrochen']]) {
      const target = key(ids.a, revisions.a, pledgeId); await cell(pledgeId).focus();
      await until(async () => await requestCount(target) === 1, 'STATUS_REQUEST_MISSING');
      await resolve(target, { status, steps: [], partial: false }); await titleContains(pledgeId, text);
      titles[status] = await cell(pledgeId).getAttribute('title');
      assert.ok(!titles[status].includes('Keine Upgrade-Schritte'));
      await page.locator('h1').first().hover(); await cell(pledgeId).hover(); assert.equal(await requestCount(target), 1);
    }
    assert.equal(await page.locator('[role="alert"]').count(), 0); assert.equal(await page.locator('dialog[open]').count(), 0);
  });
  await check('CCU_UNRESOLVED_UNKNOWN_AND_CANONICAL_IMPORTS_NEVER_FETCH_HISTORY', async () => {
    const before = (await histories()).length;
    for (const pledgeId of ['1007', '1008', '1009']) { await cell(pledgeId).hover(); assert.equal(await cell(pledgeId).getAttribute('tabindex'), null); }
    assert.equal((await histories()).length, before);
    await page.getByRole('combobox', { name: 'Lokales Kontoprofil', exact: true }).selectOption(ids.c); await cell('2001').waitFor();
    assert.equal(await cell('2001').getAttribute('title'), 'Pledge: Synthetic canonical ship'); await cell('2001').hover();
    assert.equal((await histories()).length, before);
  });
  await check('LATE_ACCOUNT_REPLY_NEVER_APPEARS_IN_OTHER_PROFILE', async () => {
    const combo = page.getByRole('combobox', { name: 'Lokales Kontoprofil', exact: true });
    await combo.selectOption(ids.a); await cell('1001').waitFor(); await cell('1001').focus();
    await until(async () => await requestCount(key(ids.a, revisions.a, '1001')) === 2, 'SECOND_PROFILE_VISIT_REQUEST_MISSING');
    await combo.selectOption(ids.b); await cell('1001').waitFor(); await titleContains('1001', 'Aktuell: B Paladin');
    await resolve(key(ids.a, revisions.a, '1001'), loaded([{ from: 'STALE_ACCOUNT_CANARY', to: 'Paladin', appliedAt: null }]));
    assert.ok(!(await cell('1001').getAttribute('title')).includes('STALE_ACCOUNT_CANARY'));
    await cell('1001').focus(); await until(async () => await requestCount(key(ids.b, revisions.b, '1001')) === 1, 'OTHER_PROFILE_REQUEST_MISSING');
    await resolve(key(ids.b, revisions.b, '1001'), loaded([{ from: 'B Synthetic Alpha', to: 'B Paladin', appliedAt: null }]));
    await titleContains('1001', 'B Synthetic Alpha → B Paladin');
  });
  await check('LATE_REVISION_REPLY_IS_DISCARDED_AND_NEW_REVISION_CAN_FETCH', async () => {
    await cell('1002').focus(); await until(async () => await requestCount(key(ids.b, revisions.b, '1002')) === 1, 'OLD_REVISION_REQUEST_MISSING');
    await application.evaluate((_electron, { id, revision }) => { const v = globalThis.fixture.views[id]; v.revision = revision; v.document.pledges[0].ships[0].modelName = 'NEW B Paladin'; }, { id: ids.b, revision: revisions.next });
    await titleContains('1001', 'Aktuell: NEW B Paladin');
    await resolve(key(ids.b, revisions.b, '1002'), loaded([{ from: 'STALE_REVISION_CANARY', to: 'B Paladin', appliedAt: null }]));
    assert.ok(!(await cell('1002').getAttribute('title')).includes('STALE_REVISION_CANARY'));
    await page.getByRole('button', { name: 'Alle Gegenstände', exact: true }).focus(); await cell('1002').focus();
    await until(async () => await requestCount(key(ids.b, revisions.next, '1002')) === 1, 'NEW_REVISION_REQUEST_MISSING');
    await resolve(key(ids.b, revisions.next, '1002'), loaded()); await titleContains('1002', 'Keine Upgrade-Schritte');
  });
  await check('NATIVE_TITLE_VALUES_AND_UNCHANGED_PRODUCT_LAYOUT_ARE_CAPTURED', async () => {
    await page.getByRole('combobox', { name: 'Lokales Kontoprofil', exact: true }).selectOption(ids.a); await cell('1001').waitFor(); await cell('1001').focus();
    await until(async () => await requestCount(key(ids.a, revisions.a, '1001')) === 3, 'PREVIEW_REQUEST_MISSING');
    await resolve(key(ids.a, revisions.a, '1001'), loaded(mainSteps)); await titleContains('1001', 'Shiv → Synthetic Alpha');
    await page.setViewportSize({ width: 1440, height: 1200 });
    const clip = await page.locator('.inventory-table').evaluate(table => { const r = table.getBoundingClientRect(), first = table.querySelector('tbody tr').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: first.bottom - r.top }; });
    await page.screenshot({ path: path.join(folder, 'product-synthetic-history-table.png'), clip });
    for (const width of [1440, 1024]) { await page.setViewportSize({ width, height: 1200 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true); }
    fs.writeFileSync(path.join(folder, 'native-title-values.json'), JSON.stringify(titles, null, 2));
  });
  await check('CONFIRMED_SESSION_DELETION_CLEARS_TOOLTIP_CACHE_WITHOUT_LOGIN', async () => {
    await page.getByRole('button', { name: 'Sitzung & Sicherheit', exact: true }).click();
    const dialog = page.getByRole('dialog'); await dialog.locator('summary').click();
    await dialog.getByRole('button', { name: 'Gespeicherte Sitzung löschen', exact: true }).click();
    await until(async () => (await cell('1001').getAttribute('title'))?.includes('beim Darüberfahren'), 'DELETED_SESSION_HISTORY_CACHE_RETAINED');
    await dialog.getByRole('button', { name: 'Schließen', exact: true }).click();
    await cell('1001').focus(); await titleContains('1001', 'gültige RSI-Sitzung');
    assert.equal(await page.locator('dialog[open]').count(), 0);
  });
  assert.equal(await application.evaluate(() => globalThis.fixture.commands.some(c => ['rsi.open', 'rsi.connect', 'rsi.authorize', 'rsi.refresh', 'import.commit'].includes(c.action))), false);
  assert.equal(await application.evaluate(() => globalThis.blockedRequests), 0); assert.deepEqual(pageErrors, []);
  fs.writeFileSync(path.join(folder, 'results.json'), JSON.stringify({ status: 'PASS', sourceVersion: version, syntheticOnly: true, hiddenOffscreen: true,
    networkBlocked: true, realUserFilesRead: false, realRsiNetwork: false, newLogin: false,
    nativeTitleScreenshotLimit: 'Native operating-system tooltip is not visible in page screenshots. Title strings were inspected directly; screenshot shows actual product table only.',
    rendererSha256: createHash('sha256').update(fs.readFileSync('src/ui/App.tsx')).digest('hex'), helperSha256: createHash('sha256').update(fs.readFileSync('src/ui/upgrade-history.ts')).digest('hex'),
    checks, titleEvidence: path.join(folder, 'native-title-values.json'), screenshot: path.join(folder, 'product-synthetic-history-table.png'), pageErrors }, null, 2));
} catch (error) { fs.writeFileSync(path.join(folder, 'results.json'), JSON.stringify({ status: 'FAIL', checks, error: error.message, pageErrors }, null, 2)); throw error; }
finally { if (application) { const child = application.process(); await application.close(); assert.equal(child.exitCode, 0); } }
console.log('REPORT: ' + path.join(folder, 'results.json'));
