import { _electron } from 'playwright-core';
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';

const project = process.cwd(), folder = path.resolve('work/temp/game-access-ui', randomUUID());
fs.mkdirSync(folder, { recursive: true });
const approvedArg = process.argv.find(value => value.startsWith('--approved-preview='))?.slice(19);
const approved = approvedArg ? JSON.parse(fs.readFileSync(path.resolve(approvedArg), 'utf8')) : null;
if (approved) assert.equal(approved.status, 'PASS');
const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
await build({ entryPoints: ['src/ui/App.tsx'], outfile: path.join(folder, 'app.js'), bundle: true, platform: 'browser', format: 'iife', target: 'chrome144' });
fs.copyFileSync('assets/app.svg', path.join(folder, 'app.svg'));
fs.copyFileSync('assets/app.png', path.join(folder, 'app.png'));
fs.copyFileSync('tests/fixtures/upgrade-history-ui-main.cjs', path.join(folder, 'fixture-main.cjs'));
fs.copyFileSync('tests/fixtures/ship-display-preload.cjs', path.join(folder, 'fixture-preload.cjs'));
fs.writeFileSync(path.join(folder, 'index.html'), `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'none'; base-uri 'none'"><title>VORSCHAU · künstliche Spielkopien</title><link rel="stylesheet" href="app.css"></head><body><div id="root"></div><script src="app.js"></script></body></html>`);
const id = '11111111-1111-4111-8111-111111111111';
const revisions = ['22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444', '55555555-5555-4555-8555-555555555555'];
const account = { id, name: 'VORSCHAU · Testdaten', mode: 'real', reference: null, identityKind: null, identityStatus: 'unbound', lastComplete: null };
const unknown = { kind: 'unknown', reason: 'Künstliche Testdaten' };
const field = (...titles) => JSON.stringify(titles.map(title => ({ title })));
function pledge(pledgeId, name, models, insurance = unknown, extra = {}) {
  return { pledgeId, name, insurance, originalDescription: 'Künstliche Vorschau ohne echte Kontodaten', ships: models.map((modelName, n) => ({ childId: pledgeId + '-' + n, modelName, modelId: null, identity: 'unresolved', role: 'unverified' })),
    ccus: [], protected: true, baseReleased: false, restrictions: [], acquisitionCost: null, unknownCostReason: 'Künstliche Testdaten', meltValue: null, sourceValues: {}, ...extra };
}
const combined = { items: field('Star Citizen Digital Download'), alsoContains: field('Squadron 42 Digital Download') };
const pledges = [
  pledge('3001', 'Synthetic SC + Squadron 42 Package', ['Prospector'], { kind: 'months', months: 6, evidence: 'Synthetic six-month insurance' }, { sourceValues: combined }),
  pledge('3002', 'Synthetic Star Citizen Starter', ['Aurora MkII'], { kind: 'months', months: 3, evidence: 'Synthetic three-month insurance' }, { sourceValues: { items: field('Star Citizen Digital Download') } }),
  pledge('3003', 'Synthetic Standalone Paladin', ['Paladin'], { kind: 'lti', evidence: 'Synthetic Lifetime Insurance' }),
  pledge('3004', 'Synthetic Star Citizen Giveaway', ['Stingray'], unknown, { sourceValues: { alsoContains: field('Star Citizen Digital Download') } }),
  pledge('3005', 'Synthetic Star Citizen Starter M80', ['M80'], unknown, { sourceValues: { items: field('Star Citizen Digital Download') } }),
  pledge('3006', 'Synthetic VIP High Admiral', [], unknown, { sourceValues: { items: field('Star Citizen Digital Download') } }),
  pledge('3007', 'Upgrade - Synthetic Alpha to Synthetic Beta', [], unknown, { ccus: [{ instanceId: 'synthetic-ccu', from: 'Synthetic Alpha', to: 'Synthetic Beta', status: 'unverified', applicability: 'unverified', insurance: unknown }] }),
];
const at = new Date(Date.now() + 60000).toISOString();
const fixture = { state: { accounts: [account], selectedAccountId: id, dataDir: 'Vorschauordner · künstliche Testdaten', version: version + ' · VORSCHAU', packaged: false, electron: 'fixture', node: 'fixture' },
  inventories: { [id]: { account, items: [], buybacks: [] } }, views: { [id]: { schemaVersion: 1, accountId: id, revision: revisions[0], observedAt: at,
    document: { type: 'sarevocs-ccu-inventory', schemaVersion: 1, appVersion: version, createdAt: at, dataMode: 'real', account: { reference: 'rsi-local:' + id, identityKind: 'manual-reference' },
      scope: { kind: 'partial', exportComplete: false, expectedPledges: null, pagesExpected: null, pagesRead: 1 }, pledges, buybacks: [] } } } };
fs.writeFileSync(path.join(folder, 'fixture.json'), JSON.stringify(fixture));
const require = createRequire(import.meta.url), env = { ...process.env, TEMP: path.join(folder, 'tmp'), TMP: path.join(folder, 'tmp') };
fs.mkdirSync(env.TEMP, { recursive: true }); delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
const checks = [], geometry = {}, rowHeightComparison = {}, screenshots = [], titleEvidence = {}, pageErrors = [];
let application, page;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, code) { for (let n = 0; n < 400; n++) { if (await predicate()) return; await wait(20); } throw new Error(code); }
async function check(name, run) { await run(); checks.push(name); console.log('PASS: ' + name); }
const row = pledgeId => page.locator('tbody tr').filter({ hasText: 'Pledge: ' + pledgeId });
const firstCell = pledgeId => row(pledgeId).locator('td').first();
const status = pledgeId => row(pledgeId).locator('td').nth(1).innerText();
async function capture(width, scale = 1) {
  await page.setViewportSize({ width, height: 1400 });
  let cdp;
  if (scale !== 1) { cdp = await page.context().newCDPSession(page); await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 1400, mobile: false, deviceScaleFactor: scale }); }
  const measured = await page.evaluate(() => { const table = document.querySelector('.table-scroll'); return { clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth,
    tableWidth: table.clientWidth, tableScrollWidth: table.scrollWidth, devicePixelRatio: window.devicePixelRatio,
    rows: [...document.querySelectorAll('tbody tr')].map(tr => ({ height: tr.getBoundingClientRect().height, smallLines: tr.querySelectorAll('td:first-child small').length })) }; });
  assert.ok(measured.scrollWidth <= measured.clientWidth); assert.equal(measured.tableWidth, measured.tableScrollWidth);
  assert.equal(measured.rows.length, 7); assert.ok(Math.abs(measured.devicePixelRatio - scale) < 0.02);
  geometry[width + '@' + scale] = measured;
  if (approved && scale === 1) {
    rowHeightComparison[width] = measured.rows.map((r, n) => ({ pledgeId: pledges[n].pledgeId, approved: approved.geometry.draft[width].rows[n].height, actual: r.height, delta: r.height - approved.geometry.draft[width].rows[n].height,
      approvedSmallLines: approved.geometry.draft[width].rows[n].smallLines, actualSmallLines: r.smallLines }));
    for (const comparison of rowHeightComparison[width]) { assert.ok(Math.abs(comparison.delta) < 0.1, 'APPROVED_ROW_HEIGHT_CHANGED'); assert.equal(comparison.actualSmallLines, comparison.approvedSmallLines); }
  }
  const clip = await page.locator('.inventory-table').evaluate(table => { const r = table.getBoundingClientRect(), last = table.querySelectorAll('tbody tr')[2].getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: last.bottom - r.top }; });
  const image = path.join(folder, `product-${width}-${String(scale).replace('.', '_')}-first-three.png`);
  if (cdp) {
    const result = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: true, clip: { ...clip, scale: 1 } });
    const bytes = Buffer.from(result.data, 'base64'); assert.ok(Math.abs(bytes.readUInt32BE(16) - clip.width * scale) <= 2 && Math.abs(bytes.readUInt32BE(20) - clip.height * scale) <= 2, 'DPI_CAPTURE_SIZE_CHANGED'); fs.writeFileSync(image, bytes);
    assert.ok(Math.abs(await page.evaluate(() => window.devicePixelRatio) - scale) < 0.02); await cdp.detach();
  } else await page.screenshot({ path: image, clip });
  screenshots.push(image);
}
try {
  application = await _electron.launch({ executablePath: require('electron'), args: [path.join(folder, 'fixture-main.cjs'), '--disable-gpu', '--disable-background-networking', '--host-resolver-rules=MAP * ~NOTFOUND', '--proxy-server=http://127.0.0.1:9'], cwd: project, env });
  page = await application.firstWindow(); page.on('pageerror', e => pageErrors.push(e.message));
  await page.getByRole('button', { name: 'Alle Gegenstände', exact: true }).click(); await row('3007').waitFor();
  await check('FIVE_GAME_COPY_MARKERS_AND_ONE_UPGRADE_ONLY_MATCH_APPROVED_DESIGN', async () => {
    assert.equal(await page.getByRole('img', { name: 'Spielkopie im Pledge', exact: true }).count(), 5);
    assert.deepEqual(await page.locator('tbody tr td:nth-child(2)').allTextContents(), ['Nur upgraden', 'Spielzugang', 'Schiff / Pledge', 'Spielzugang', 'Spielzugang', 'Spielzugang', 'CCU · ungeprüft']);
    assert.equal(await row('3001').locator('.badge').innerText(), '6 Monate'); assert.equal(await firstCell('3003').getByRole('img').count(), 0);
  });
  await check('PRODUCT_TABLE_MATCHES_APPROVED_ROW_HEIGHTS_AT_1440_1024_AND_DPI_125', async () => { await capture(1440); await capture(1024); await capture(1024, 1.25); });
  await check('GAME_EVIDENCE_SURVIVES_CURRENT_MODEL_AND_ORIGINAL_NAME_CHANGE', async () => {
    await application.evaluate((_electron, { id, revision }) => { const v = globalThis.fixture.views[id]; v.revision = revision; v.document.pledges[0].ships[0].modelName = 'Synthetic Future Ship'; v.document.pledges[0].name = 'Synthetic Renamed Original Package'; }, { id, revision: revisions[1] });
    await until(async () => (await firstCell('3001').innerText()).includes('Synthetic Future Ship'), 'MODEL_CHANGE_NOT_VISIBLE');
    assert.equal(await status('3001'), 'Nur upgraden'); assert.equal(await firstCell('3001').getByRole('img', { name: 'Spielkopie im Pledge', exact: true }).count(), 1);
    await application.evaluate((_electron, { id, revision }) => { const v = globalThis.fixture.views[id]; v.revision = revision; v.document.pledges[0].ships[0].modelName = 'Prospector'; v.document.pledges[0].name = 'Synthetic SC + Squadron 42 Package'; }, { id, revision: revisions[2] });
    await until(async () => (await firstCell('3001').innerText()).includes('Prospector'), 'MODEL_RESTORE_NOT_VISIBLE');
  });
  await check('GAME_COPY_TOOLTIP_PRESERVES_LEGACY_TWO_STEP_HISTORY_WITHOUT_EXCLUSIVITY_CLAIM', async () => {
    await firstCell('3001').focus();
    await until(() => application.evaluate(() => globalThis.fixture.pending.some(p => p.command.pledgeId === '3001' && !p.done)), 'HISTORY_REQUEST_MISSING');
    await application.evaluate((_electron, { id, revision }) => globalThis.resolveHistory({ accountId: id, revision, pledgeId: '3001' }, { status: 'loaded', partial: false, steps: [
      { from: 'Shiv', to: 'Synthetic Intermediate', appliedAt: '2025-11-01 10:00' }, { from: 'Synthetic Intermediate', to: 'Prospector', appliedAt: '2026-11-01 12:30' },
    ] }), { id, revision: revisions[2] });
    await until(async () => (await firstCell('3001').getAttribute('title')).includes('Synthetic Intermediate → Prospector'), 'TWO_STEP_TITLE_MISSING');
    titleEvidence.combined = await firstCell('3001').getAttribute('title');
    assert.ok(titleEvidence.combined.startsWith('Spielkopien: Star Citizen + Squadron 42\nPlaner-Schutz: Nur upgraden. Nicht einschmelzen oder verschenken.\n'));
    assert.ok(titleEvidence.combined.indexOf('Shiv → Synthetic Intermediate') < titleEvidence.combined.indexOf('Synthetic Intermediate → Prospector'));
    assert.ok(!/einzig|Game Library|ausgewählt/i.test(titleEvidence.combined));
    titleEvidence.singleGame = await firstCell('3002').getAttribute('title'); assert.ok(titleEvidence.singleGame.includes('Star Citizen') && !titleEvidence.singleGame.includes('Planer-Schutz'));
  });
  await check('MALFORMED_AND_UNKNOWN_CONTENTS_NEVER_INFER_GAME_ACCESS_FROM_NAMES', async () => {
    const extras = [pledge('3009', 'Star Citizen Digital Download', ['Prospector'], unknown, { sourceValues: { items: '{' } }),
      pledge('3010', 'Synthetic unknown package', ['Synthetic Unknown'], unknown, { sourceValues: { items: field('Star Citizen Digital Download Poster') } })];
    await application.evaluate((_electron, { id, revision, extras }) => { const v = globalThis.fixture.views[id]; v.revision = revision; v.document.pledges.push(...extras); }, { id, revision: revisions[3], extras });
    await row('3010').waitFor();
    for (const pledgeId of ['3009', '3010']) { assert.equal(await firstCell(pledgeId).getByRole('img').count(), 0); assert.equal(await status(pledgeId), 'Schiff / Pledge'); assert.ok(!(await firstCell(pledgeId).getAttribute('title')).includes('Spielkopien')); }
  });
  await check('CCU_AND_UNRESOLVED_GAME_FIELDS_NEVER_SHOW_FALSE_UPGRADE_ONLY_STATUS', async () => {
    const extra = pledge('3008', 'Synthetic unresolved combined-game upgrade', ['Synthetic Unresolved'], unknown, { sourceValues: { ...combined, upgradeState: 'unresolved' } });
    await application.evaluate((_electron, { id, extra, combined }) => { const p = globalThis.fixture.views[id].document.pledges; p.find(x => x.pledgeId === '3007').sourceValues = combined; p.push(extra); globalThis.fixture.views[id].revision = '66666666-6666-4666-8666-666666666666'; }, { id, extra, combined });
    await row('3008').waitFor();
    assert.equal(await status('3007'), 'CCU · ungeprüft'); assert.equal(await status('3008'), 'CCU · ungeklärt');
    const before = await application.evaluate(() => globalThis.fixture.commands.filter(c => c.action === 'rsi.upgradeHistory').length);
    for (const pledgeId of ['3007', '3008']) { await firstCell(pledgeId).hover(); assert.ok(!(await firstCell(pledgeId).getAttribute('title')).includes('Nur upgraden')); }
    assert.equal(await application.evaluate(() => globalThis.fixture.commands.filter(c => c.action === 'rsi.upgradeHistory').length), before);
  });
  await check('MARKERS_ADD_NO_NETWORK_AUTHENTICATION_OR_MUTATING_COMMAND', async () => {
    assert.equal(await application.evaluate(() => globalThis.blockedRequests), 0);
    assert.equal(await application.evaluate(() => globalThis.fixture.commands.some(c => ['rsi.open', 'rsi.authorize', 'rsi.connect', 'rsi.refresh', 'import.commit'].includes(c.action))), false);
    assert.equal(await page.locator('dialog[open]').count(), 0); assert.deepEqual(pageErrors, []);
  });
  fs.writeFileSync(path.join(folder, 'title-values.json'), JSON.stringify(titleEvidence, null, 2));
  const sourceHashes = Object.fromEntries(['src/ui/App.tsx', 'src/ui/app.css', 'src/ui/game-access.ts', 'src/domain/game-access.ts'].map(file => [file, createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));
  fs.writeFileSync(path.join(folder, 'results.json'), JSON.stringify({ status: 'PASS', sourceVersion: version, syntheticOnly: true, hiddenOffscreen: true, realUserFilesRead: false,
    newLogin: false, realRsiNetwork: false, networkBlocked: true, checks, sourceHashes, approvedPreview: approvedArg ? path.resolve(approvedArg) : null, rowHeightComparison, geometry, screenshots,
    titleEvidence: path.join(folder, 'title-values.json'), dpi125Mode: 'Chromium device-scale emulation with direct PNG pixel-size validation; no Windows setting changed', pageErrors }, null, 2));
} catch (error) { fs.writeFileSync(path.join(folder, 'results.json'), JSON.stringify({ status: 'FAIL', checks, error: error.message, pageErrors }, null, 2)); throw error; }
finally { if (application) { const child = application.process(); await application.close(); assert.equal(child.exitCode, 0); } }
console.log('REPORT: ' + path.join(folder, 'results.json'));
