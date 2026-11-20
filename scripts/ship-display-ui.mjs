import { _electron } from 'playwright-core';
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';

const baselineArg = process.argv.find(v => v.startsWith('--baseline-dir='))?.slice(15);
const baseline = baselineArg !== undefined;
const project = process.cwd(), sourceRoot = baseline ? path.resolve(baselineArg) : project;
const version = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'package.json'), 'utf8').replace(/^\uFEFF/, '')).version;
if (baseline && version !== '0.3.12') throw new Error('BASELINE_VERSION_MISMATCH');
const folder = path.resolve('work/temp/ship-display-ui', randomUUID());
fs.mkdirSync(folder, { recursive: true });
await build({ entryPoints: [path.join(sourceRoot, 'src/ui/App.tsx')], outfile: path.join(folder, 'app.js'), bundle: true,
  platform: 'browser', format: 'iife', target: 'chrome144', nodePaths: [path.join(project, 'node_modules')] });
fs.copyFileSync(path.join(project, 'assets/app.svg'), path.join(folder, 'app.svg'));
fs.copyFileSync(path.join(project, 'assets/app.png'), path.join(folder, 'app.png'));
fs.copyFileSync(path.join(project, 'tests/fixtures/ship-display-main.cjs'), path.join(folder, 'fixture-main.cjs'));
fs.copyFileSync(path.join(project, 'tests/fixtures/ship-display-preload.cjs'), path.join(folder, 'fixture-preload.cjs'));
fs.writeFileSync(path.join(folder, 'index.html'), `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'none'; base-uri 'none'"><title>SYNTHETISCHE VORSCHAU · Produkt-Renderer</title><link rel="stylesheet" href="app.css"></head><body><div id="root"></div><script src="app.js"></script></body></html>`);
const id = '11111111-1111-4111-8111-111111111111';
const account = { id, name: 'VORSCHAU · Testdaten', mode: 'real', reference: null, identityKind: null, identityStatus: 'unbound', lastComplete: null };
const lti = { kind: 'lti', evidence: 'Synthetischer Lifetime-Insurance-Beleg' };
const unknown = { kind: 'unknown', reason: 'Synthetischer unbekannter Beleg' };
function pledge(pledgeId, name, names, extra = {}) {
  return { pledgeId, name, insurance: lti, originalDescription: 'Synthetischer Bestand, keine echten Kontodaten',
    ships: names.map((modelName, i) => ({ childId: pledgeId + '-child-' + i, modelName, modelId: null, identity: 'unresolved', role: 'unverified' })),
    ccus: [], protected: true, baseReleased: false, restrictions: [], acquisitionCost: null, unknownCostReason: 'Synthetisch unbekannt', meltValue: null, sourceValues: {}, ...extra };
}
const pledges = [
  pledge('synthetic-paladin', 'Standalone Ships - Shiv', ['Paladin']),
  pledge('synthetic-shiv', 'Standalone Ships - Shiv', ['Shiv']),
  pledge('synthetic-package', 'Synthetic Multi-Ship Package', ['Paladin', 'Shiv', 'Shiv']),
  pledge('synthetic-ccu', 'Upgrade - Synthetic Alpha to Synthetic Beta', ['SYNTHETIC_CCU_SHIP_CANARY'], { insurance: unknown,
    ccus: [{ instanceId: 'synthetic-ccu-instance', from: 'Synthetic Alpha', to: 'Synthetic Beta', status: 'unverified', applicability: 'unverified', insurance: unknown }] }),
  pledge('synthetic-unresolved', 'Synthetic unresolved upgrade', ['SYNTHETIC_UNRESOLVED_SHIP_CANARY'], { insurance: unknown,
    sourceValues: { upgradeState: 'unresolved', upgradeIssue: 'ambiguous' } }),
  pledge('synthetic-other', 'Synthetic unknown contents', [], { insurance: unknown }),
];
const importedAt = new Date(Date.now() - 60000).toISOString(), observedAt = new Date(Date.now() + 60000).toISOString();
const fixture = { state: { accounts: [account], selectedAccountId: id, dataDir: 'Synthetischer Testordner · keine echten Nutzerdaten',
  version: version + ' · SYNTHETISCHE VORSCHAU', packaged: false, electron: 'fixture', node: 'fixture' },
  inventory: { account, items: pledges.map(p => ({ pledge: p, availability: 'present', source: 'rsi-dom-probe/1', importedAt })), buybacks: [] },
  observed: { schemaVersion: 1, accountId: id, revision: '22222222-2222-4222-8222-222222222222', observedAt,
    document: { type: 'sarevocs-ccu-inventory', schemaVersion: 1, appVersion: version, createdAt: observedAt, dataMode: 'real',
      account: { reference: 'rsi-local:' + id, identityKind: 'manual-reference' },
      scope: { kind: 'partial', exportComplete: false, expectedPledges: null, pagesExpected: null, pagesRead: 1 }, pledges, buybacks: [] } } };
fs.writeFileSync(path.join(folder, 'fixture.json'), JSON.stringify(fixture));
const require = createRequire(import.meta.url), checks = [], screenshots = [], geometries = [], errors = [];
let application;
async function check(name, fn) { await fn(); checks.push(name); console.log('PASS: ' + name); }
const primaryTexts = page => page.locator('tbody tr td:first-child').evaluateAll(cells => cells.map(cell => [...cell.childNodes].filter(n => n.nodeType === Node.TEXT_NODE).map(n => n.textContent).join('').trim()));
async function launch(scale) {
  const runtime = path.join(folder, 'runtime-' + scale), env = { ...process.env, TEMP: path.join(folder, 'tmp'), TMP: path.join(folder, 'tmp') };
  fs.mkdirSync(env.TEMP, { recursive: true }); delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
  application = await _electron.launch({ executablePath: require('electron'), args: [path.join(folder, 'fixture-main.cjs'), '--fixture-runtime=' + runtime,
    '--disable-gpu', '--disable-background-networking', '--host-resolver-rules=MAP * ~NOTFOUND', '--proxy-server=http://127.0.0.1:9', '--force-device-scale-factor=' + scale], cwd: project, env });
  const page = await application.firstWindow(); page.on('pageerror', e => errors.push(e.message));
  await page.getByRole('button', { name: 'Alle Gegenstände', exact: true }).click();
  await page.locator('tbody tr').nth(5).waitFor();
  return page;
}
async function close() { if (application) { const child = application.process(); await application.close(); assert.equal(child.exitCode, 0); application = undefined; } }
const expected = ['Paladin', 'Shiv', 'Paladin, Shiv, Shiv', pledges[3].name, pledges[4].name, pledges[5].name];
async function capture(page, width, scale) {
  await page.setViewportSize({ width, height: 1200 });
  let cdp;
  if (scale !== 1) {
    cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 1200, mobile: false, deviceScaleFactor: scale });
  }
  const geometry = await page.evaluate(() => {
    const table = document.querySelector('.table-scroll');
    return { clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth,
      tableWidth: table.clientWidth, tableScrollWidth: table.scrollWidth, devicePixelRatio: window.devicePixelRatio,
      rows: [...table.querySelectorAll('tbody tr')].map(row => { const r = row.getBoundingClientRect(); return { width: r.width, height: r.height }; }) };
  });
  assert.ok(geometry.scrollWidth <= geometry.clientWidth, 'DOCUMENT_OVERFLOW');
  assert.equal(geometry.tableScrollWidth, geometry.tableWidth, 'TABLE_OVERFLOW');
  assert.equal(geometry.rows.length, 6); assert.ok(Math.abs(geometry.devicePixelRatio - scale) < 0.02, 'UNEXPECTED_DPI_' + geometry.devicePixelRatio);
  const label = `${baseline ? 'baseline' : 'product'}-${width}-${String(scale).replace('.', '_')}`;
  for (const [suffix, locator] of [['page', page], ['table', page.locator('.table-scroll')]]) {
    const image = path.join(folder, label + '-' + suffix + '.png');
    if (cdp) {
      const clip = suffix === 'page' ? { x: 0, y: 0, width, height: 1200 } : await locator.evaluate(node => {
        const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height };
      });
      const capture = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: true, clip: { ...clip, scale: 1 } });
      const bytes = Buffer.from(capture.data, 'base64');
      assert.ok(Math.abs(bytes.readUInt32BE(16) - clip.width * scale) <= 2 && Math.abs(bytes.readUInt32BE(20) - clip.height * scale) <= 2, 'DPI_SCREENSHOT_PIXEL_SIZE_MISMATCH');
      fs.writeFileSync(image, bytes);
    } else await locator.screenshot({ path: image });
    screenshots.push(image);
  }
  if (!baseline && width === 1440 && scale === 1) {
    const clip = await page.locator('.inventory-table').evaluate(table => {
      const rect = table.getBoundingClientRect(), last = table.querySelectorAll('tbody tr')[1].getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: last.bottom - rect.top };
    });
    const image = path.join(folder, 'product-1440-first-two-ships.png');
    await page.screenshot({ path: image, clip }); screenshots.push(image);
  }
  const geometryFile = path.join(folder, label + '-geometry.json'); fs.writeFileSync(geometryFile, JSON.stringify(geometry, null, 2)); geometries.push(geometryFile);
  assert.ok(Math.abs(await page.evaluate(() => window.devicePixelRatio) - scale) < 0.02, 'DPI_CHANGED_DURING_CAPTURE');
  if (cdp) await cdp.detach();
}
try {
  let page = await launch(1);
  if (baseline) {
    await check('BASELINE_ORIGINAL_PLEDGE_NAME_HIDES_CURRENT_SHIP', async () => {
      const texts = await primaryTexts(page);
      assert.deepEqual(texts.slice(0, 2), ['Standalone Ships - Shiv', 'Standalone Ships - Shiv']);
      assert.equal(texts.includes('Paladin'), false);
    });
    await capture(page, 1440, 1);
  } else {
    await check('CURRENT_SHIPS_REPLACE_OLD_PLEDGE_NAME_IN_ACCEPTED_INVENTORY', async () => assert.deepEqual(await primaryTexts(page), expected));
    await check('ORIGINAL_PLEDGE_REMAINS_TOOLTIP_WITHOUT_EXTRA_LINE', async () => {
      const cells = page.locator('tbody tr td:first-child');
      for (let i = 0; i < pledges.length; i++) assert.equal(await cells.nth(i).getAttribute('title'), 'Pledge: ' + pledges[i].name);
      assert.deepEqual(await cells.evaluateAll(nodes => nodes.map(n => n.querySelectorAll('small.subline').length)), [1, 1, 1, 2, 2, 1]);
      assert.equal(await cells.nth(0).innerText().then(t => t.includes('Standalone Ships - Shiv')), false);
    });
    await check('PACKAGE_KEEPS_ALL_CHILDREN_AND_DUPLICATE_MODEL_NAMES', async () => {
      assert.equal((await primaryTexts(page))[2], 'Paladin, Shiv, Shiv');
      await page.locator('tbody tr').filter({ hasText: 'Pledge: synthetic-package' }).getByText(/3 Paketkinder/).waitFor();
    });
    await check('CCU_UNRESOLVED_AND_UNKNOWN_PLEDGES_KEEP_EXISTING_MAIN_TEXT', async () => {
      assert.deepEqual((await primaryTexts(page)).slice(3), expected.slice(3));
      assert.equal(await page.locator('tbody').innerText().then(t => /SYNTHETIC_(?:CCU|UNRESOLVED)_SHIP_CANARY/.test(t)), false);
      assert.equal(await page.locator('.stat').filter({ hasText: 'Erkannte CCUs' }).locator('strong').innerText(), '2');
    });
    await check('CURRENT_SHIPS_ALSO_APPEAR_IN_OBSERVED_CACHE', async () => {
      await application.evaluate(() => { globalThis.fixture.useObserved = true; });
      await page.getByText('Zuletzt gelesener Bestand', { exact: true }).waitFor();
      assert.deepEqual(await primaryTexts(page), expected);
    });
    await check('TABLE_FITS_1440_AND_1024_WITH_CURRENT_CSS', async () => { await capture(page, 1440, 1); await capture(page, 1024, 1); });
  }
  await check('NO_LOGIN_DIALOG_OR_MUTATING_COMMAND_OR_NETWORK_REQUEST', async () => {
    assert.equal(await page.locator('dialog[open]').count(), 0);
    // The current renderer also reads local display preferences; no pricing mutation is allowed.
    assert.equal(await application.evaluate(() => globalThis.fixture.commands.some(c => !['state', 'inventory', 'rsi.background', 'pricing.status'].includes(c.action))), false);
    assert.equal(await application.evaluate(() => globalThis.blockedRequests), 0);
  });
  await close();
  if (!baseline) {
    page = await launch(1.25);
    await check('TABLE_FITS_1024_AT_125_PERCENT_DPI', async () => { assert.deepEqual(await primaryTexts(page), expected); await capture(page, 1024, 1.25); });
    assert.equal(await application.evaluate(() => globalThis.blockedRequests), 0);
    await close();
  }
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(folder, 'results.json'), JSON.stringify({ status: 'PASS', baseline, expectedBaselineFailure: baseline, sourceVersion: version,
    rendererSha256: createHash('sha256').update(fs.readFileSync(path.join(sourceRoot, 'src/ui/App.tsx'))).digest('hex'),
    cssSha256: createHash('sha256').update(fs.readFileSync(path.join(sourceRoot, 'src/ui/app.css'))).digest('hex'),
    syntheticOnly: true, hiddenOffscreen: true, networkBlocked: true, realUserFilesRead: false, realRsiNetwork: false, newLogin: false,
    dpi125Mode: baseline ? null : 'Chromium CDP device-scale emulation; not a Windows display-setting change', checks, screenshots, geometries, pageErrors: errors }, null, 2));
} catch (error) {
  fs.writeFileSync(path.join(folder, 'results.json'), JSON.stringify({ status: 'FAIL', baseline, sourceVersion: version, checks, error: error.message, pageErrors: errors }, null, 2));
  throw error;
} finally { await close(); }
console.log('REPORT: ' + path.join(folder, 'results.json'));
