import { _electron } from 'playwright-core';
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';

const project = process.cwd(), folder = path.resolve('work/temp/inventory-display-ui', randomUUID());
fs.mkdirSync(folder, { recursive: true });
const baselineArg = process.argv.find(value => value.startsWith('--baseline-dir='))?.slice(15);
const baselineRoot = baselineArg ? path.resolve(baselineArg) : null;
if (baselineRoot) assert.equal(JSON.parse(fs.readFileSync(path.join(baselineRoot, 'package.json'), 'utf8').replace(/^\uFEFF/, '')).version, '0.3.15');
const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
const id = '11111111-1111-4111-8111-111111111111', revision = '22222222-2222-4222-8222-222222222222';
const account = { id, name: 'VORSCHAU · Testdaten', mode: 'real', reference: null, identityKind: null, identityStatus: 'unbound', lastComplete: null };
const unknown = { kind: 'unknown', reason: 'Künstliche Testdaten' }, lti = { kind: 'lti', evidence: 'Künstlicher LTI-Beleg' };
const months = count => ({ kind: 'months', months: count, evidence: 'Künstlicher Monatsbeleg' });
const field = (...titles) => JSON.stringify(titles.map(title => ({ title })));
function pledge(pledgeId, name, models, insurance = unknown, extra = {}) {
  return { pledgeId, name, insurance, originalDescription: 'Künstliche Testdaten ohne echte Kontodaten', ships: models.map((modelName, n) => ({ childId: pledgeId + '-' + n, modelName, modelId: null, identity: 'unresolved', role: 'unverified' })),
    ccus: [], protected: true, baseReleased: false, restrictions: [], acquisitionCost: null, unknownCostReason: 'Künstliche Testdaten', meltValue: null, sourceValues: {}, ...extra };
}
const ccu = (n, insurance) => ({ instanceId: 'synthetic-instance-' + n, from: 'Synthetic Alpha', to: 'Synthetic Beta', status: 'unverified', applicability: 'unverified', insurance });
const pledges = [
  pledge('4001', 'Synthetic SC + Squadron 42 Package', ['Prospector'], months(6), { sourceValues: { items: field('Star Citizen Digital Download'), alsoContains: field('Squadron 42 Digital Download') } }),
  pledge('4002', 'Synthetic Ground Vehicle Access Package', ['Synthetic Rover'], months(12), { sourceValues: { items: field('Star Citizen Digital Download') } }),
  pledge('4003', 'Synthetic Standalone Paladin', ['Paladin'], lti),
  pledge('4004', 'Synthetic Ship With Unproven Insurance', ['Synthetic Unknown Ship']),
  pledge('4005', 'Synthetic Two-Ship Package', ['Shiv', 'Shiv'], lti),
  pledge('4101', 'Synthetic normal CCU', [], unknown, { ccus: [ccu(1, unknown)] }),
  pledge('4102', 'Synthetic LTI CCU', [], unknown, { ccus: [ccu(2, lti)] }),
  pledge('4103', 'Synthetic 120-month CCU', [], unknown, { ccus: [ccu(3, months(120))] }),
  pledge('4104', 'Synthetic independent CCUs', [], unknown, { ccus: [ccu(4, months(6)), ccu(5, months(120))] }),
  pledge('4105', 'Synthetic mixed ship and CCU pledge', ['Synthetic Mixed Ship'], lti, { ccus: [ccu(6, unknown)] }),
  pledge('4106', 'Synthetic unresolved upgrade with explicit child', ['Synthetic Explicit Unresolved Child'], unknown, { sourceValues: { upgradeState: 'unresolved' } }),
  pledge('4201', 'Synthetic other contents', []),
];
const at = new Date(Date.now() + 60000).toISOString();
const fixture = { state: { accounts: [account], selectedAccountId: id, dataDir: 'Vorschauordner · künstliche Testdaten', version: version + ' · VORSCHAU', packaged: false, electron: 'fixture', node: 'fixture' },
  inventories: { [id]: { account, items: [], buybacks: [] } }, views: { [id]: { schemaVersion: 1, accountId: id, revision, observedAt: at,
    document: { type: 'sarevocs-ccu-inventory', schemaVersion: 1, appVersion: version, createdAt: at, dataMode: 'real', account: { reference: 'rsi-local:' + id, identityKind: 'manual-reference' },
      scope: { kind: 'partial', exportComplete: false, expectedPledges: null, pagesExpected: null, pagesRead: 1 }, pledges, buybacks: [] } } } };
const require = createRequire(import.meta.url), checks = [], screenshots = [], geometry = {}, baselineGeometry = {}, comparisons = {}, titles = {}, pageErrors = [];
let application, page;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, code) { for (let n = 0; n < 300; n++) { if (await predicate()) return; await wait(20); } throw new Error(code); }
async function check(name, run) { await run(); checks.push(name); console.log('PASS: ' + name); }
const row = pledgeId => page.locator('tbody tr').filter({ hasText: 'Pledge: ' + pledgeId });
const insurance = pledgeId => row(pledgeId).locator('td').nth(2).locator('.badge');
async function launch(sourceRoot, label) {
  const runFolder = path.join(folder, label); fs.mkdirSync(runFolder, { recursive: true });
  await build({ entryPoints: [path.join(sourceRoot, 'src/ui/App.tsx')], outfile: path.join(runFolder, 'app.js'), bundle: true, platform: 'browser', format: 'iife', target: 'chrome144', nodePaths: [path.join(project, 'node_modules')] });
  fs.copyFileSync('assets/app.svg', path.join(runFolder, 'app.svg'));
fs.copyFileSync('assets/app.png', path.join(runFolder, 'app.png')); fs.copyFileSync('tests/fixtures/upgrade-history-ui-main.cjs', path.join(runFolder, 'fixture-main.cjs')); fs.copyFileSync('tests/fixtures/ship-display-preload.cjs', path.join(runFolder, 'fixture-preload.cjs'));
  fs.writeFileSync(path.join(runFolder, 'fixture.json'), JSON.stringify(fixture));
  fs.writeFileSync(path.join(runFolder, 'index.html'), `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'none'; base-uri 'none'"><title>VORSCHAU · künstlicher Bestand</title><link rel="stylesheet" href="app.css"></head><body><div id="root"></div><script src="app.js"></script></body></html>`);
  const env = { ...process.env, TEMP: path.join(runFolder, 'tmp'), TMP: path.join(runFolder, 'tmp') }; fs.mkdirSync(env.TEMP, { recursive: true }); delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
  application = await _electron.launch({ executablePath: require('electron'), args: [path.join(runFolder, 'fixture-main.cjs'), '--disable-gpu', '--disable-background-networking', '--host-resolver-rules=MAP * ~NOTFOUND', '--proxy-server=http://127.0.0.1:9'], cwd: project, env });
  page = await application.firstWindow(); page.on('pageerror', e => pageErrors.push(e.message));
  await page.getByRole('button', { name: 'Alle Gegenstände', exact: true }).click(); await row('4201').waitFor();
}
async function close() { if (application) { const child = application.process(); await application.close(); assert.equal(child.exitCode, 0); application = undefined; } }
async function measure(width) {
  await page.setViewportSize({ width, height: 1600 });
  return page.evaluate(() => { const table = document.querySelector('.table-scroll'); return { clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth,
    tableWidth: table.clientWidth, tableScrollWidth: table.scrollWidth, cards: [...document.querySelectorAll('main > .stats > .stat')].map(node => { const r = node.getBoundingClientRect(); return { top: r.top, height: r.height }; }),
    rows: [...document.querySelectorAll('tbody tr')].map(tr => ({ height: tr.getBoundingClientRect().height, smallLines: tr.querySelectorAll('td:first-child small').length })) }; });
}
async function capture(filter, width, scale = 1) {
  await page.getByRole('button', { name: filter, exact: true }).click();
  await page.setViewportSize({ width, height: 1600 }); let cdp;
  if (scale !== 1) { cdp = await page.context().newCDPSession(page); await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 1600, mobile: false, deviceScaleFactor: scale }); }
  const clip = await page.evaluate(filter => {
    const table = document.querySelector('.inventory-table'), first = document.querySelector('main > .stats').getBoundingClientRect();
    const rows = table.querySelectorAll('tbody tr'), last = rows[filter === 'Schiffe & Fahrzeuge' ? 2 : rows.length - 1].getBoundingClientRect();
    const panel = table.closest('section').getBoundingClientRect(); return { x: panel.x, y: first.top, width: panel.width, height: last.bottom - first.top };
  }, filter);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
  assert.ok(Math.abs(await page.evaluate(() => window.devicePixelRatio) - scale) < 0.02);
  const file = path.join(folder, `product-${filter === 'CCUs' ? 'ccus' : 'ships'}-${width}-${String(scale).replace('.', '_')}.png`);
  if (cdp) { const result = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: true, clip: { ...clip, scale: 1 } });
    const bytes = Buffer.from(result.data, 'base64'); assert.ok(Math.abs(bytes.readUInt32BE(16) - clip.width * scale) <= 2 && Math.abs(bytes.readUInt32BE(20) - clip.height * scale) <= 2); fs.writeFileSync(file, bytes); await cdp.detach();
  } else await page.screenshot({ path: file, clip });
  screenshots.push(file);
}
try {
  if (baselineRoot) { await launch(baselineRoot, 'baseline'); for (const width of [1440, 1024]) baselineGeometry[width] = await measure(width); await close(); }
  await launch(project, 'product');
  await check('TOTAL_SHIP_CHILDREN_AND_LTI_SUBCOUNT_KEEP_THREE_CARDS', async () => {
    assert.equal(await page.locator('main > .stats > .stat').count(), 3);
    const card = page.locator('main > .stats > .stat').first();
    assert.equal(await card.locator('label').innerText(), 'Schiffe & Fahrzeuge'); assert.equal(await card.locator('strong').innerText(), '8'); assert.equal(await card.locator('small').innerText(), 'davon 4 mit LTI');
    await page.getByRole('heading', { name: 'Schiffe, Fahrzeuge & CCUs', exact: true }).waitFor();
  });
  await check('CCU_BASE_INSURANCE_IS_NEUTRAL_AND_EXPLICIT_BONUSES_REMAIN', async () => {
    assert.equal(await insurance('4101').innerText(), 'Basis gilt'); assert.equal(await insurance('4102').innerText(), '+LTI'); assert.equal(await insurance('4103').innerText(), '+120 Mon.');
    assert.equal(await insurance('4104').innerText(), 'Zusatz prüfen'); assert.equal(await insurance('4105').innerText(), 'Basis gilt'); assert.equal(await insurance('4106').innerText(), 'Basis gilt');
    assert.equal(await insurance('4101').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(32, 48, 62)'); assert.equal(await insurance('4101').getAttribute('class').then(value => value.includes('unknown')), false);
    titles.ccuBase = await insurance('4101').getAttribute('title'); titles.ccuMixed = await insurance('4104').getAttribute('title');
    assert.ok(titles.ccuBase.includes('höhere Laufzeit gilt') && titles.ccuBase.includes('nicht addiert')); assert.ok(titles.ccuMixed.includes('Exemplare einzeln prüfen'));
    assert.equal(await insurance('4001').innerText(), '6 Monate'); assert.equal(await insurance('4004').innerText(), 'Unbekannt');
  });
  await check('ROW_HEIGHTS_AND_THREE_CARD_LAYOUT_MATCH_BASELINE_AT_1440_AND_1024', async () => {
    for (const width of [1440, 1024]) { geometry[width] = await measure(width); const current = geometry[width]; assert.ok(current.scrollWidth <= current.clientWidth); assert.equal(current.tableWidth, current.tableScrollWidth); assert.equal(current.cards.length, 3); assert.ok(current.cards.every(card => Math.abs(card.top - current.cards[0].top) < 0.1));
      if (baselineGeometry[width]) { comparisons[width] = current.rows.map((r, n) => ({ before: baselineGeometry[width].rows[n].height, after: r.height, delta: r.height - baselineGeometry[width].rows[n].height })); for (const r of comparisons[width]) assert.ok(Math.abs(r.delta) < 0.1, 'ROW_HEIGHT_CHANGED'); }
    }
  });
  await check('SHIP_AND_VEHICLE_FILTER_INCLUDES_NON_LTI_VEHICLES_PACKAGES_AND_MIXED_CHILDREN', async () => {
    await page.getByRole('button', { name: 'Schiffe & Fahrzeuge', exact: true }).click(); assert.equal(await page.locator('tbody tr').count(), 7);
    for (const pledgeId of ['4001', '4002', '4003', '4004', '4005', '4105', '4106']) await row(pledgeId).waitFor();
    assert.ok((await row('4105').locator('td').first().innerText()).startsWith('Synthetic Mixed Ship'));
    assert.ok((await row('4106').locator('td').first().innerText()).startsWith('Synthetic Explicit Unresolved Child'));
    assert.ok((await row('4005').locator('td').first().innerText()).startsWith('Shiv, Shiv'));
    assert.equal(await row('4105').locator('td').nth(1).innerText(), 'CCU · ungeprüft'); assert.equal(await row('4106').locator('td').nth(1).innerText(), 'CCU · ungeklärt');
    assert.equal(await insurance('4105').innerText(), 'LTI · belegt'); assert.equal(await insurance('4106').innerText(), 'Unbekannt');
  });
  await check('CCU_FILTER_STAYS_SEPARATE_WITHOUT_UNKNOWN_BADGES_OR_COMBINED_MAXIMUM', async () => {
    await page.getByRole('button', { name: 'CCUs', exact: true }).click(); assert.equal(await page.locator('tbody tr').count(), 6);
    assert.equal(await page.locator('tbody td:nth-child(3)').allTextContents().then(texts => texts.some(text => text.includes('Unbekannt'))), false);
    assert.ok((await row('4105').locator('td').first().innerText()).startsWith('Synthetic mixed ship and CCU pledge'));
    assert.equal(await insurance('4104').innerText(), 'Zusatz prüfen');
    assert.equal(await insurance('4105').innerText(), 'Basis gilt');
  });
  await check('CORRECTED_PRODUCT_PREVIEW_FITS_1440_1024_AND_125_PERCENT_DPI', async () => {
    for (const width of [1440, 1024]) { await capture('Schiffe & Fahrzeuge', width); await capture('CCUs', width); }
    await capture('Schiffe & Fahrzeuge', 1024, 1.25); await capture('CCUs', 1024, 1.25);
  });
  await check('GAME_COPY_CROWN_AND_RESOLVED_TWO_STEP_TOOLTIP_REMAIN', async () => {
    await page.getByRole('button', { name: 'Schiffe & Fahrzeuge', exact: true }).click(); assert.equal(await page.getByRole('img', { name: 'Spielkopie im Pledge', exact: true }).count(), 2);
    assert.equal(await row('4001').locator('td').nth(1).innerText(), 'Nur upgraden'); await row('4001').locator('td').first().focus();
    await until(() => application.evaluate(() => globalThis.fixture.pending.some(p => p.command.pledgeId === '4001' && !p.done)), 'HISTORY_REQUEST_MISSING');
    await application.evaluate((_electron, { id, revision }) => globalThis.resolveHistory({ accountId: id, revision, pledgeId: '4001' }, { status: 'loaded', partial: false, steps: [
      { from: 'Shiv', to: 'Synthetic Intermediate', appliedAt: '2025-11-01 10:00' }, { from: 'Synthetic Intermediate', to: 'Prospector', appliedAt: '2026-11-01 12:30' },
    ] }), { id, revision });
    await until(async () => (await row('4001').locator('td').first().getAttribute('title')).includes('Synthetic Intermediate → Prospector'), 'TWO_STEP_TITLE_MISSING');
    titles.history = await row('4001').locator('td').first().getAttribute('title'); assert.ok(titles.history.includes('Shiv → Synthetic Intermediate') && titles.history.includes('Star Citizen + Squadron 42'));
  });
  await check('NO_REAL_NETWORK_AUTHENTICATION_OR_MUTATING_COMMAND', async () => {
    assert.equal(await application.evaluate(() => globalThis.blockedRequests), 0); assert.deepEqual(pageErrors, []); assert.equal(await page.locator('dialog[open]').count(), 0);
    assert.equal(await application.evaluate(() => globalThis.fixture.commands.some(c => ['rsi.open', 'rsi.authorize', 'rsi.connect', 'rsi.refresh', 'import.commit'].includes(c.action))), false);
  });
  const sourceHashes = Object.fromEntries(['src/ui/App.tsx', 'src/ui/app.css', 'src/ui/ccu-insurance.ts'].map(file => [file, createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));
  fs.writeFileSync(path.join(folder, 'title-values.json'), JSON.stringify(titles, null, 2));
  fs.writeFileSync(path.join(folder, 'results.json'), JSON.stringify({ status: 'PASS', sourceVersion: version, syntheticOnly: true, realUserFilesRead: false, realRsiNetwork: false, newLogin: false,
    checks, sourceHashes, baseline: baselineRoot, baselineGeometry, geometry, rowHeightComparison: comparisons, screenshots, titleEvidence: path.join(folder, 'title-values.json'),
    dpi125Mode: 'Chromium device-scale emulation with direct PNG pixel-size validation; no Windows setting changed', pageErrors }, null, 2));
} catch (error) { fs.writeFileSync(path.join(folder, 'results.json'), JSON.stringify({ status: 'FAIL', checks, error: error.message, pageErrors, geometry, baselineGeometry }, null, 2)); throw error; }
finally { await close(); }
console.log('REPORT: ' + path.join(folder, 'results.json'));
