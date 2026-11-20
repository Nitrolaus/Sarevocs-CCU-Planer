import { _electron } from 'playwright-core';
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';

const project = process.cwd(), folder = path.resolve('work/temp/spinner-ui', randomUUID());
fs.mkdirSync(folder, { recursive: true });
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const sourceHashes = Object.fromEntries(['src/ui/App.tsx', 'src/ui/app.css', 'src/ui/game-packages.ts'].map(file => [file, hash(file)]));
const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
const approvedPath = path.resolve(process.argv.find(value => value.startsWith('--approved-preview='))?.slice(19) ?? 'work/temp/spinner-preview/fcc838da-b035-411c-a52e-54b2b50a076b/results.json');
const approved = JSON.parse(fs.readFileSync(approvedPath, 'utf8')); assert.equal(approved.status, 'PASS');
const bundle = path.join(folder, 'bundle'); fs.mkdirSync(bundle, { recursive: true });
await build({ entryPoints: ['src/ui/App.tsx'], outfile: path.join(bundle, 'app.js'), bundle: true, platform: 'browser', format: 'iife', target: 'chrome144' });
const id = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const account = { id, name: 'VORSCHAU · Testdaten', mode: 'real', reference: null, identityKind: null, identityStatus: 'unbound', lastComplete: null };
const other = { ...account, id: otherId, name: 'VORSCHAU · Profil B' };
const fixture = { state: { accounts: [account, other], selectedAccountId: id, dataDir: 'Isolierter Renderer · keine echten Nutzerdaten', version: version + ' · VORSCHAU', packaged: false, electron: 'fixture', node: 'fixture' },
  inventories: { [id]: { account, items: [], buybacks: [] }, [otherId]: { account: other, items: [], buybacks: [] } }, views: { [id]: null, [otherId]: null },
  backgroundStatus: { [id]: 'connecting', [otherId]: 'connected' } };
let fixtureMain = fs.readFileSync('tests/fixtures/upgrade-history-ui-main.cjs', 'utf8');
assert.equal(fixtureMain.split("status: 'connected'").length, 2);
fixtureMain = fixtureMain.replace("status: 'connected'", 'status: fixture.backgroundStatus[command.accountId]');
const refreshAnchor = "  if (command.action === 'rsi.upgradeHistory') {";
assert.equal(fixtureMain.split(refreshAnchor).length, 2);
fixtureMain = fixtureMain.replace(refreshAnchor, "  if (command.action === 'rsi.refresh') { fixture.backgroundStatus[command.accountId] = 'connecting'; return { ok: true, data: { status: 'connecting', revision: null, changed: false } }; }\n" + refreshAnchor);
const require = createRequire(import.meta.url), geometry = {}, screenshots = [], phases = [], checks = [];
let application, page;
async function launch(mode) {
  const run = path.join(folder, mode); fs.mkdirSync(run, { recursive: true });
  fs.copyFileSync(path.join(bundle, 'app.js'), path.join(run, 'app.js'));
  fs.copyFileSync(path.join(bundle, 'app.css'), path.join(run, 'app.css'));
  fs.copyFileSync('assets/app.svg', path.join(run, 'app.svg'));
fs.copyFileSync('assets/app.png', path.join(run, 'app.png')); fs.copyFileSync('tests/fixtures/ship-display-preload.cjs', path.join(run, 'fixture-preload.cjs'));
  fs.writeFileSync(path.join(run, 'fixture-main.cjs'), fixtureMain); fs.writeFileSync(path.join(run, 'fixture.json'), JSON.stringify(fixture));
  fs.writeFileSync(path.join(run, 'index.html'), `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'none'; base-uri 'none'"><title>VORSCHAU · drehender Ladekreis mit künstlichen Daten</title><link rel="stylesheet" href="app.css"></head><body><div id="root"></div><script src="app.js"></script></body></html>`);
  const env = { ...process.env, TEMP: path.join(run, 'tmp'), TMP: path.join(run, 'tmp') }; fs.mkdirSync(env.TEMP, { recursive: true }); delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
  application = await _electron.launch({ executablePath: require('electron'), args: [path.join(run, 'fixture-main.cjs'), '--disable-gpu', '--disable-background-networking', '--host-resolver-rules=MAP * ~NOTFOUND', '--proxy-server=http://127.0.0.1:9'], cwd: project, env });
  page = await application.firstWindow(); await page.emulateMedia({ reducedMotion: 'no-preference' }); await page.locator('.connection-status.pending').waitFor();
  assert.equal(await page.locator('.connection-status').innerText(), 'Wird aktualisiert …');
  assert.equal(await page.getByRole('button', { name: 'Aktualisieren', exact: true }).isDisabled(), true);
  return run;
}
async function close() { if (application) { const child = application.process(); await application.close(); assert.equal(child.exitCode, 0); application = undefined; } }
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, code) { for (let n = 0; n < 400; n++) { if (await predicate()) return; await wait(20); } throw new Error(code); }
async function check(name, run) { await run(); checks.push(name); console.log('PASS: ' + name); }
async function status(value) { await application.evaluate((_electron, { id, value }) => { globalThis.fixture.backgroundStatus[id] = value; }, { id, value }); }
async function noSpinner(text) {
  await until(async () => (await page.locator('.connection-status').innerText()) === text, 'STATUS_DID_NOT_SETTLE');
  const result = await page.locator('.status-dot').evaluate(dot => ({ width: getComputedStyle(dot).width, animation: getComputedStyle(dot).animationName, animations: dot.getAnimations().length }));
  assert.equal(result.width, '8px'); assert.equal(result.animation, 'none'); assert.equal(result.animations, 0);
}
async function measure(width, scale = 1) {
  await page.setViewportSize({ width, height: 1400 }); let cdp;
  if (scale !== 1) { cdp = await page.context().newCDPSession(page); await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 1400, mobile: false, deviceScaleFactor: scale }); }
  const measured = await page.evaluate(() => {
    const line = document.querySelector('.connection-line'), lr = line.getBoundingClientRect(), status = document.querySelector('.connection-status'), sr = status.getBoundingClientRect(), dot = document.querySelector('.status-dot'), dr = dot.getBoundingClientRect(), css = getComputedStyle(dot);
    const children = [...line.querySelectorAll('select,button,.connection-status')].map(node => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; });
    return { clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth, devicePixelRatio: window.devicePixelRatio,
      line: { left: lr.left, right: lr.right, height: lr.height }, status: { left: sr.left, right: sr.right },
      circle: { cssWidth: css.width, cssHeight: css.height, border: css.borderTopWidth, rectWidth: dr.width, rectHeight: dr.height, duration: css.animationDuration, timing: css.animationTimingFunction, iterations: css.animationIterationCount, transform: css.transform }, children };
  });
  assert.ok(measured.scrollWidth <= measured.clientWidth); assert.ok(measured.children.every(r => r.left >= measured.line.left - 1 && r.right <= measured.line.right + 1));
  assert.ok(Math.abs(measured.devicePixelRatio - scale) < 0.02);
  return { measured, cdp };
}
async function region() { return page.evaluate(() => { const line = document.querySelector('.connection-line').getBoundingClientRect(), header = document.querySelector('main > header').getBoundingClientRect(); return { x: line.x, y: line.y, width: line.width, height: header.bottom - line.top }; }); }
async function capture(file, clip, cdp, scale) {
  if (cdp) { const result = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: true, clip: { ...clip, scale: 1 } }); const bytes = Buffer.from(result.data, 'base64');
    assert.ok(Math.abs(bytes.readUInt32BE(16) - clip.width * scale) <= 2 && Math.abs(bytes.readUInt32BE(20) - clip.height * scale) <= 2); fs.writeFileSync(file, bytes);
  } else await page.screenshot({ path: file, clip });
  screenshots.push(file);
}
try {
  const run = await launch('product');
  await check('BUSY_STARTS_REAL_CSS_ANIMATION_AND_DISABLING_EXISTING_REFRESH_BUTTON', async () => {
  const liveAnimation = await page.locator('.status-dot').evaluate(dot => ({ count: dot.getAnimations().length, state: dot.getAnimations()[0]?.playState }));
  assert.equal(liveAnimation.count, 1); assert.equal(liveAnimation.state, 'running');
  assert.equal(await page.getByRole('button', { name: 'Aktualisieren', exact: true }).isDisabled(), true);
  });
  await check('PRODUCT_RING_AND_HEADER_MATCH_APPROVED_1440_1024_AND_125_GEOMETRY', async () => {
  for (const [width, scale] of [[1440, 1], [1024, 1], [1024, 1.25]]) {
    const { measured, cdp } = await measure(width, scale); geometry[width + '@' + scale] = measured;
    assert.equal(measured.circle.cssWidth, '24px'); assert.equal(measured.circle.cssHeight, '24px'); assert.equal(measured.circle.border, '3px');
    assert.equal(measured.circle.duration, '0.9s'); assert.equal(measured.circle.timing, 'linear'); assert.equal(measured.circle.iterations, 'infinite');
    assert.ok(Math.abs(measured.line.height - approved.geometry[width + '@' + scale].line.height) < 0.1, 'CONNECTION_LINE_HEIGHT_CHANGED');
    await capture(path.join(folder, `product-${width}-${String(scale).replace('.', '_')}-header.png`), await region(), cdp, scale);
    if (cdp) await cdp.detach();
  }
  });
  await check('CSS_ANIMATION_HAS_DISTINCT_REAL_QUARTER_TURN_FRAMES', async () => {
  await page.setViewportSize({ width: 1440, height: 1400 });
  for (const phase of [0, 225]) {
    const transform = await page.locator('.status-dot').evaluate((dot, time) => { const animation = dot.getAnimations()[0]; animation.pause(); animation.currentTime = time; return getComputedStyle(dot).transform; }, phase);
    phases.push({ controlledTimeMs: phase, transform });
    await capture(path.join(folder, `animation-phase-${phase}ms.png`), await region(), null, 1);
  }
  assert.notEqual(phases[0].transform, phases[1].transform);
  await page.locator('.status-dot').evaluate(dot => dot.getAnimations()[0].play());
  });
  await check('SUCCESS_AND_UNAVAILABLE_ERROR_STOP_SPINNER_AND_RETAIN_ORIGINAL_DOT', async () => {
    await status('connected'); await noSpinner('Verbunden');
    assert.equal(await page.getByRole('button', { name: 'Aktualisieren', exact: true }).isEnabled(), true);
    await page.getByRole('button', { name: 'Aktualisieren', exact: true }).click(); await page.locator('.connection-status.pending').waitFor();
    assert.equal(await page.locator('.status-dot').evaluate(dot => dot.getAnimations().length), 1);
    await status('unavailable'); await noSpinner('Nicht erreichbar');
  });
  await check('PROFILE_CHANGE_STOPS_OLD_LOADING_INDICATOR_AND_RESTORES_SELECTED_STATUS', async () => {
    await page.getByRole('button', { name: 'Aktualisieren', exact: true }).click(); await page.locator('.connection-status.pending').waitFor();
    const combo = page.getByRole('combobox', { name: 'Lokales Kontoprofil', exact: true });
    await combo.selectOption(otherId); await noSpinner('Verbunden');
    await combo.selectOption(id); await page.locator('.connection-status.pending').waitFor();
    assert.equal(await page.locator('.status-dot').evaluate(dot => dot.getAnimations().length), 1);
  });
  let reducedMotion;
  await check('REDUCED_MOTION_KEEPS_RING_AND_BUSY_TEXT_WITHOUT_ROTATION', async () => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  reducedMotion = await page.locator('.status-dot').evaluate(dot => ({ animation: getComputedStyle(dot).animationName, width: getComputedStyle(dot).width }));
  assert.equal(reducedMotion.animation, 'none'); assert.equal(reducedMotion.width, '24px'); await page.emulateMedia({ reducedMotion: 'no-preference' });
  assert.equal(await page.locator('.connection-status').innerText(), 'Wird aktualisiert …');
  });
  const html = await page.evaluate(() => { const documentCopy = document.documentElement.cloneNode(true); documentCopy.querySelectorAll('script').forEach(node => node.remove()); return '<!doctype html>\n' + documentCopy.outerHTML; });
  const animatedHtml = path.join(run, 'animated-preview.html'); fs.writeFileSync(animatedHtml, html);
  assert.equal(await application.evaluate(() => globalThis.blockedRequests), 0);
  assert.equal(await application.evaluate(() => globalThis.fixture.commands.some(c => !['state', 'inventory', 'rsi.background', 'rsi.refresh', 'account.select', 'pricing.status'].includes(c.action))), false);
  for (const file of Object.keys(sourceHashes)) assert.equal(hash(file), sourceHashes[file], 'PRODUCT_SOURCE_CHANGED');
  fs.writeFileSync(path.join(folder, 'results.json'), JSON.stringify({ status: 'PASS', sourceVersion: version, productIntegration: true, sourceChangedByHarness: false, sourceHashes,
    syntheticOnly: true, realUserFilesRead: false, realRsiNetwork: false, newLogin: false, networkBlocked: true,
    approvedPreview: approvedPath, checks, geometry, animationInitiallyRunning: true, controlledAnimationPhases: phases, reducedMotionBehavior: reducedMotion,
    screenshots, animatedHtml, animatedHtmlContainsScripts: false, dpi125Mode: 'Chromium device-scale emulation with PNG-size validation; no Windows setting changed',
    note: 'Static PNGs show genuine controlled phases of the CSS animation. The script-free local HTML preserves the live CSS rotation and honors reduced motion.' }, null, 2));
} catch (error) { fs.writeFileSync(path.join(folder, 'results.json'), JSON.stringify({ status: 'FAIL', error: error.message, geometry, phases }, null, 2)); throw error; }
finally { await close(); }
console.log('REPORT: ' + path.join(folder, 'results.json'));
