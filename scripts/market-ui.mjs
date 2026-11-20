import { _electron } from 'playwright-core';
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
const folder = path.resolve('work/temp/market-ui', randomUUID()); fs.mkdirSync(folder, { recursive: true });
await build({ entryPoints: ['src/ui/App.tsx'], outfile: path.join(folder, 'app.js'), bundle: true, platform: 'browser', target: 'chrome156' });
fs.copyFileSync('assets/app.svg', path.join(folder, 'app.svg'));
fs.copyFileSync('assets/app.png', path.join(folder, 'app.png')); fs.copyFileSync('tests/fixtures/ship-display-preload.cjs', path.join(folder, 'fixture-preload.cjs'));
let main = fs.readFileSync('tests/fixtures/upgrade-history-ui-main.cjs', 'utf8');
const anchor = '  fixture.commands.push(copy(command));'; assert.equal(main.split(anchor).length, 2);
main = main.replace(anchor, anchor + `
  if (command.action === 'market.status') return { ok: true, data: copy(fixture.market) };
  if (command.action === 'market.refresh') { fixture.market.pending = true; return { ok: true, data: copy(fixture.market) }; }
  if (command.action === 'market.targets') { if (command.ids) fixture.targets[command.accountId] = command.ids; return { ok: true, data: copy(fixture.targets[command.accountId] ?? [null,null,null]) }; }
`);
fs.writeFileSync(path.join(folder, 'fixture-main.cjs'), main);
const a = '11111111-1111-4111-8111-111111111111', b = '22222222-2222-4222-8222-222222222222';
const account = { id: a, name: 'VORSCHAU · Profil A', mode: 'demo', reference: null, identityKind: null, identityStatus: 'unbound', lastComplete: null };
const other = { ...account, id: b, name: 'VORSCHAU · Profil B' }, at = new Date().toISOString();
const ships = [{ id: 62, name: 'Synthetic Explorer', chassisId: 22, manufacturer: 'Synthetic Manufacturer', manufacturerCode: 'SYN', status: 'flight-ready', focus: 'Exploration', length: 126 }, { id: 206, name: 'Synthetic Explorer Expedition Long Variant', chassisId: 22, manufacturer: 'Synthetic Manufacturer', manufacturerCode: 'SYN', status: 'flight-ready', focus: 'Exploration', length: 126 }];
const offer = { key: 'openh:62:19062', name: 'Upgrade to Synthetic Explorer', targetName: 'Synthetic Explorer', toShipId: 62, toSkuId: 19062, regularMinor: 40000, warbondMinor: 36000, warbond: true, currency: 'USD', taxBasis: 'net', verification: 'target-observation', firstSeenAt: at, lastSeenAt: at, change: 'new', previousRegularMinor: null, previousWarbondMinor: null };
const fixture = { state: { accounts: [account, other], selectedAccountId: a, dataDir: 'Synthetischer Ordner', version: '0.3.19 · VORSCHAU', packaged: false, electron: 'fixture', node: 'fixture' },
  inventories: { [a]: { account, items: [], buybacks: [] }, [b]: { account: other, items: [], buybacks: [] } }, views: {}, targets: {},
  market: { schemaVersion: 1, catalogue: { fetchedAt: at, ships }, offers: { fetchedAt: at, sourceAt: at, checkedAt: at, items: [offer] }, pending: false, errors: { catalogue: null, offers: null }, refreshSchedule: { hour: 17, timeZone: 'Europe/Berlin' } } };
fs.writeFileSync(path.join(folder, 'fixture.json'), JSON.stringify(fixture));
fs.writeFileSync(path.join(folder, 'index.html'), '<!doctype html><html lang="de"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'self\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\'; connect-src \'none\'"><link rel="stylesheet" href="app.css"></head><body><div id="root"></div><script src="app.js"></script></body></html>');
const env = { ...process.env, TEMP: path.join(folder, 'tmp'), TMP: path.join(folder, 'tmp') }; fs.mkdirSync(env.TEMP, { recursive: true }); delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
const require = createRequire(import.meta.url); let application; const checks = [], geometry = [], errors = [];
async function check(name, fn) { await fn(); checks.push(name); console.log('PASS:', name); }
try {
  application = await _electron.launch({ executablePath: require('electron'), args: [path.join(folder, 'fixture-main.cjs'), '--disable-gpu', '--disable-background-networking', '--host-resolver-rules=MAP * ~NOTFOUND'], env });
  const page = await application.firstWindow(); page.on('pageerror', e => errors.push(e.message));
  await page.getByRole('heading', { name: 'Bestand', exact: true }).waitFor();
  await page.getByRole('button', { name: /CCU-Planer/ }).click();
  await page.getByRole('heading', { name: 'Messeangebote', exact: true }).waitFor();
  await check('OFFER_AND_TARGET_SECTIONS_MATCH_APPROVED_ORDER', async () => {
    const offers = await page.locator('.market-offers').boundingBox(), cards = await page.locator('.market-targets').boundingBox(); assert.ok(cards.y > offers.y + offers.height); assert.equal(await page.locator('.market-target').count(), 3);
    assert.equal(await page.getByLabel('Zielschiff 1', { exact: true }).inputValue(), '');
  });
  await check('CATALOGUE_SELECTION_SHOWS_TARGET_VALUE_WITHOUT_INVENTED_CCU_COST', async () => {
    await page.getByLabel('Zielschiff 1', { exact: true }).selectOption('62'); await page.locator('.market-target h2').first().filter({ hasText: 'Synthetic Explorer' }).waitFor();
    assert.match(await page.locator('.market-target').first().innerText(), /360,00/); assert.match(await page.locator('.market-target').first().innerText(), /Zusätzliche CCU-Kosten ungeprüft/);
    assert.equal(await page.locator('.market-chain li').count(), 3); assert.match(await page.locator('.market-chain').innerText(), /Keine bestätigte Kaufkette/);
  });
  await check('FIRST_LOADING_STATE_DOES_NOT_PRETEND_THAT_THE_SOURCE_FAILED', async () => {
    await application.evaluate(() => { globalThis.syntheticPriorMarket = JSON.parse(JSON.stringify(globalThis.fixture.market)); globalThis.fixture.market.offers = null; globalThis.fixture.market.pending = true; });
    await page.locator('.market-spinner').waitFor(); assert.equal(await page.getByRole('alert').count(), 0);
    await application.evaluate(() => { globalThis.fixture.market = globalThis.syntheticPriorMarket; }); await page.locator('.market-offer').waitFor();
  });
  await check('VARIANT_WITHOUT_EXACT_OFFER_IS_NOT_ASSIGNED_THE_BASE_PRICE', async () => {
    await page.getByLabel('Zielschiff 2', { exact: true }).selectOption('206'); await page.locator('.market-target h2').nth(1).filter({ hasText: 'Long Variant' }).waitFor();
    assert.match(await page.locator('.market-target').nth(1).innerText(), /Kein eindeutig zugeordnetes Zielangebot/); assert.doesNotMatch(await page.locator('.market-target').nth(1).innerText(), /360,00/);
  });
  await check('DETAILS_DO_NOT_PRESENT_TARGET_VALUES_AS_BUYABLE_PAIRS', async () => {
    await page.getByRole('button', { name: 'Details zu Synthetic Explorer' }).click(); await page.locator('.market-detail').waitFor(); assert.match(await page.locator('.market-detail').innerText(), /Kein Ausgangsschiff/); assert.match(await page.locator('.market-detail').innerText(), /Angebotsende unbekannt/);
  });
  await check('MARKET_REFRESH_NEVER_STARTS_RSI_AUTH', async () => {
    await page.getByRole('button', { name: 'Aktualisieren', exact: true }).click(); await page.locator('.market-spinner').waitFor();
    assert.equal(await application.evaluate(() => globalThis.fixture.commands.some(c => ['rsi.authorize','rsi.open','rsi.connect'].includes(c.action))), false);
    await page.emulateMedia({ reducedMotion: 'reduce' }); assert.equal(await page.locator('.market-spinner').evaluate(e => getComputedStyle(e).animationName), 'none');
    await application.evaluate(() => { globalThis.fixture.market.pending = false; globalThis.fixture.market.errors.offers = 'Synthetisch offline'; });
    await page.getByRole('alert').filter({ hasText: 'Angebotsstand veraltet' }).waitFor(); assert.equal(await page.locator('.market-offer').count(), 1);
  });
  await check('TARGET_SELECTION_IS_PROFILE_SEPARATED', async () => {
    await page.getByLabel('Lokales Kontoprofil', { exact: true }).selectOption(b); await page.waitForFunction(() => document.querySelector('[aria-label="Zielschiff 1"]').value === '');
    await page.getByLabel('Lokales Kontoprofil', { exact: true }).selectOption(a); await page.waitForFunction(() => document.querySelector('[aria-label="Zielschiff 1"]').value === '62');
  });
  await check('DESKTOP_GEOMETRY_1440_1024_AND_125_PERCENT', async () => {
    for (const [width, scale] of [[1440,1],[1024,1],[1024,1.25]]) {
      await page.setViewportSize({ width, height: 1400 }); const cdp = await page.context().newCDPSession(page); await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 1400, mobile: false, deviceScaleFactor: scale });
      const result = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, bad: [...document.querySelectorAll('.market-view button,.market-target,.market-offer,.market-target select')].filter(e => { const b=e.getBoundingClientRect();return e.getClientRects().length&&(b.left<0||b.right>innerWidth+1); }).map(e=>e.className) }));
      assert.ok(result.scrollWidth <= result.width); assert.deepEqual(result.bad, []); geometry.push({ width, scale, ...result });
      await page.screenshot({ path: path.join(folder, `market-${width}-${scale}.png`), fullPage: true }); await cdp.detach();
    }
  });
  await check('INVENTORY_AND_NETWORK_BOUNDARY_PRESERVED', async () => {
    await page.getByRole('button', { name: '⚙ Daten & Einstellungen' }).click(); await page.getByRole('heading', { name: 'Bestand', exact: true }).waitFor(); await page.locator('#data-location').waitFor(); assert.equal(await page.locator('[aria-label="Bestandsfilter"] button').count(), 5);
    assert.equal(await application.evaluate(() => globalThis.blockedRequests), 0); assert.deepEqual(errors, []);
  });
  fs.writeFileSync(path.join(folder, 'results.json'), JSON.stringify({ status: 'PASS', checks, geometry, syntheticOnly: true, newRsiLogin: false, actualRsiSessionUsed: false, errors }, null, 2));
} catch(error) { fs.writeFileSync(path.join(folder, 'results.json'), JSON.stringify({ status: 'FAIL', checks, geometry, error: error.message }, null, 2)); throw error; }
finally { if (application) { const child=application.process(); await application.close(); assert.equal(child.exitCode,0); } }
console.log('REPORT:', path.join(folder, 'results.json'));
