import { _electron } from 'playwright-core';
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { reportFixture } from './fixtures/report-data.ts';
import { prepareChains } from '../src/planner/chain.ts';
import { approveStartBase } from '../src/planner/bases.ts';
import { emptyDraft } from '../src/planner/draft.ts';
import { extractFile } from '@electron/asar';

const folder = path.resolve('work/temp/incoming-warbond-ui', randomUUID()); fs.mkdirSync(folder, { recursive: true });
const packaged = process.env.CCU_TEST_ASAR;
if (packaged) for (const name of ['app.js', 'app.css']) fs.writeFileSync(path.join(folder, name), extractFile(packaged, path.join('build', 'renderer', name)));
else await build({ entryPoints: ['src/ui/App.tsx'], outfile: path.join(folder, 'app.js'), bundle: true, platform: 'browser', target: 'chrome156' });
for (const file of ['app.svg', 'app.png']) fs.copyFileSync('assets/' + file, path.join(folder, file));
fs.copyFileSync('tests/fixtures/ship-display-preload.cjs', path.join(folder, 'fixture-preload.cjs'));
let main = fs.readFileSync('tests/fixtures/upgrade-history-ui-main.cjs', 'utf8');
const anchor = '  fixture.commands.push(copy(command));'; assert.equal(main.split(anchor).length, 2);
main = main.replace(anchor, anchor + `
  if(command.action==='market.checkOffers')return {ok:true,data:copy(fixture.market)};
  if(command.action==='market.shopPrices')return {ok:true,data:null};
  if(command.action==='market.openUpgrades')return {ok:true,data:{opened:true}};
  if(command.action==='planner.creditBudget')return {ok:true,data:null};
  if(command.action==='market.targets'){if(command.ids)fixture.targets[command.accountId]=command.ids;return {ok:true,data:copy(fixture.targets[command.accountId]??[null,null,null])};}
`);
fs.writeFileSync(path.join(folder, 'fixture-main.cjs'), main);
const data = reportFixture(), a = data.inventory.account.id, at = new Date().toISOString();
const account = { ...data.inventory.account, name: 'VORSCHAU · erfundene Angebote', mode: 'demo', lastComplete: at };
const market = data.market, ships = market.catalogue.ships, offers = market.offers.items;
ships[3].name = 'Eclipse'; offers[3].targetName = 'Eclipse'; offers[3].regularMinor = 30000; offers[3].warbondMinor = 28000;
offers[1].warbond = true; offers[1].warbondMinor = 9000;
offers[4].warbond = true; offers[4].warbondMinor = 55000;
ships.push({ ...ships[0], id: 6, name: 'Meteor' });
offers.push({ ...offers[0], key: 'test-meteor', toShipId: 6, targetName: 'Meteor', regularMinor: 26000 });
market.values = { schemaVersion: 1, source: 'rsi-from-ships', currency: 'USD', taxBasis: 'net', fetchedAt: at,
  items: offers.map(o => ({ id: o.toShipId, name: o.targetName, minor: o.regularMinor })) };
const quotes = [[1, 2, 3270, 4360], [6, 4, 2180, 4360], [4, 5, 27250, 29975]].flatMap(([fromId, toId, wb, std]) =>
  ['standard', 'warbond'].map(edition => ({ fromId, toId, edition, checkedAt: Date.now(),
    amount: { minor: edition === 'warbond' ? wb : std, currency: 'EUR', taxMode: 'gross', vatBasisPoints: 1900 } })));
market.shopPrices = quotes;
const items = data.inventory.items.slice(0, 2), pool = prepareChains(items.map(i => i.pledge), ships, offers, true, undefined, market.values);
const base = pool.bases[0], ccu = pool.ccus[0];
const draft = { ...approveStartBase(pool, emptyDraft(), base.key), mode: 'manual', initialized: true,
  anchors: [{ kind: 'owned', key: ccu.key, fromName: ccu.from.name, toName: ccu.to.name }] };
const fixture = { state: { accounts: [account], selectedAccountId: a, dataDir: 'Synthetischer Ordner', version: 'TEST · erfundene Angebote', packaged: false, electron: 'fixture', node: 'fixture' },
  inventories: { [a]: { account, items, buybacks: [] } }, views: {}, targets: { [a]: [4, 5, null] },
  planDrafts: { [a + ':4']: draft }, pricing: data.display, market };
fixture.pricing.settings.taxMode = 'gross';
fs.writeFileSync(path.join(folder, 'fixture.json'), JSON.stringify(fixture));
fs.writeFileSync(path.join(folder, 'index.html'), `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'none'"><link rel="stylesheet" href="app.css"></head><body><div id="root"></div><script src="app.js"></script></body></html>`);
const env = { ...process.env, TEMP: path.join(folder, 'tmp'), TMP: path.join(folder, 'tmp') };
fs.mkdirSync(env.TEMP, { recursive: true }); delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
const require = createRequire(import.meta.url); let app; const checks = [], errors = [];
try {
  app = await _electron.launch({ executablePath: require('electron'), args: [path.join(folder, 'fixture-main.cjs'), '--disable-gpu', '--disable-background-networking', '--host-resolver-rules=MAP * ~NOTFOUND'], env });
  const page = await app.firstWindow(); page.on('pageerror', e => errors.push(String(e)));
  page.setDefaultTimeout(12000);
  async function planner() {
    await page.reload(); await page.getByRole('heading', { name: 'Bestand', exact: true }).waitFor();
    await page.getByRole('button', { name: /CCU-Planer/ }).click();
    await page.getByRole('heading', { name: 'Warbond-Kauftipps für die Kette zu Eclipse · Schiff 1', exact: true }).waitFor();
  }
  await planner(); await page.locator('.outgoing-table').waitFor();
  assert.equal(await page.locator('.outgoing-table tbody tr').count(), 2);
  assert.match(await page.locator('.outgoing-table').innerText(), /Starter → A[\s\S]*32,70[\s\S]*10,90[\s\S]*Noch nicht gekauft/);
  assert.match(await page.locator('.outgoing-table').innerText(), /Meteor → Eclipse[\s\S]*21,80[\s\S]*21,80[\s\S]*Noch nicht gekauft/);
  assert.doesNotMatch(await page.locator('.outgoing-table').innerText(), /Eclipse →|Liberator/);
  assert.deepEqual(await app.evaluate(() => globalThis.fixture.planDrafts), fixture.planDrafts);
  checks.push('intermediate and final Warbond steps lead toward Eclipse; no outbound upgrades; draft unchanged');
  const colors = await page.locator('.outgoing-table').evaluate(table => [...table.querySelectorAll('tbody tr')].map(row => ({
    fill: getComputedStyle(row.cells[0]).backgroundColor, warbond: getComputedStyle(row.querySelector('.outgoing-warbond-label')).color })));
  assert.ok(colors.every(c => c.fill === 'rgb(48, 37, 25)' && c.warbond === 'rgb(82, 255, 240)'));
  const dimensions = [];
  for (const [width, zoom] of [[1540, 1], [1024, 1], [1280, 1.25]]) {
    await app.evaluate(({ BrowserWindow }, { width, zoom }) => { const w = BrowserWindow.getAllWindows()[0]; w.webContents.setZoomFactor(zoom); w.setContentSize(width, 1350); }, { width, zoom });
    await page.waitForTimeout(150);
    dimensions.push(await page.locator('.outgoing-scroll').evaluate(n => ({ client: n.clientWidth, scroll: n.scrollWidth, overflow: getComputedStyle(n).overflowX })));
    assert.equal(dimensions.at(-1).overflow, 'auto');
  }
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.webContents.setZoomFactor(1); w.setContentSize(1540, 1350); });
  const screenshot = path.join(folder, 'incoming-warbond.png'); await page.locator('.outgoing-warbonds').screenshot({ path: screenshot });
  await page.locator('.outgoing-purchase button').first().click();
  let commands = await app.evaluate(() => globalThis.fixture.commands);
  const pairs = commands.filter(c => c.action === 'market.shopPrices').flatMap(c => c.pairs);
  assert.ok(pairs.some(p => p.fromId === 6 && p.toId === 4));
  assert.ok(!pairs.some(p => p.fromId === 4), 'never request outgoing Eclipse offers');
  assert.ok(commands.some(c => c.action === 'market.openUpgrades'));
  await page.getByRole('article', { name: 'Zielschiff 2: Liberator', exact: true }).click();
  assert.equal(await page.locator('.outgoing-table tbody tr').count(), 2);
  assert.match(await page.locator('.outgoing-head').innerText(), /Eclipse/);
  checks.push('public pair quotes and shop link only; switching active editor to ship 2 leaves ship 1 tips unchanged');
  const hiddenCases = [];
  for (const kind of ['no-discount-proof', 'standard-only', 'zero-discount', 'different-tax', 'already-owned', 'locked-owned', 'incomplete-inventory', 'expired', 'stale-offers', 'base-unapproved', 'missing-anchor']) {
    const testQuotes = structuredClone(quotes), testItems = structuredClone(items); let prices = testQuotes;
    if (kind === 'no-discount-proof') prices = prices.filter(p => p.edition === 'warbond');
    if (kind === 'standard-only') prices = prices.filter(p => p.edition === 'standard');
    if (kind === 'zero-discount') prices.forEach(p => { if (p.edition === 'standard') p.amount.minor = quotes.find(q => q.fromId === p.fromId && q.toId === p.toId && q.edition === 'warbond').amount.minor; });
    if (kind === 'different-tax') prices.forEach(p => { if (p.edition === 'standard') p.amount.taxMode = 'net'; });
    if (kind === 'already-owned' || kind === 'locked-owned') for (const [from, to] of [['Starter', 'A'], ['Meteor', 'Eclipse']]) {
      const extra = structuredClone(items[1]); extra.pledge.pledgeId = 'new-owned:' + to; extra.pledge.ccus[0] = { ...extra.pledge.ccus[0], instanceId: 'new-copy', from, to }; testItems.push(extra);
    }
    if (kind === 'expired') prices.forEach(p => p.checkedAt = Date.now() - 301000);
    if (kind === 'missing-anchor') testItems.splice(1, 1);
    await app.evaluate((_electron, { a, at, prices, testItems, draft, kind }) => {
      const f = globalThis.fixture; f.market.shopPrices = prices; f.inventories[a].items = testItems;
      f.inventories[a].account.lastComplete = kind === 'incomplete-inventory' ? null : at;
      f.market.offers.sourceAt = kind === 'stale-offers' ? new Date(Date.now() - 7 * 3600000).toISOString() : at;
      f.planDrafts = { [a + ':4']: draft };
      if (kind === 'base-unapproved') delete f.planDrafts[a + ':4'].baseApprovedKey;
      f.excludedCcus = { [a]: kind === 'locked-owned' ? ['A', 'Eclipse'].map(to => JSON.stringify(['new-owned:' + to, 'new-copy'])) : [] };
    }, { a, at, prices, testItems, draft, kind });
    await planner(); await page.locator('.outgoing-status').waitFor();
    assert.equal(await page.locator('.outgoing-table tbody tr').count(), 0, kind); hiddenCases.push(kind);
    if (kind === 'base-unapproved') assert.match(await page.locator('.outgoing-status').innerText(), /LTI-Startbasis/);
  }
  commands = await app.evaluate(() => globalThis.fixture.commands);
  assert.ok(!commands.some(c => /^(rsi\.(connect|open|authorize)|cart|purchase|checkout)(\.|$)/.test(c.action)));
  assert.ok(!commands.some(c => c.action === 'planner.draft' && c.draft || c.action === 'planner.exclude' || c.action === 'planner.batch'));
  assert.deepEqual(errors, []); checks.push('owned/locked/partial/stale/unproven/invalid cases hidden; no login, draft changes or renderer errors');
  const report = { status: 'PASS', syntheticOnly: true, realSessionRead: false, newRsiLogin: false, packagedRenderer: !!packaged, checks, hiddenCases, dimensions, colors, screenshot };
  fs.writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
} catch (error) {
  fs.writeFileSync(path.join(folder, 'report.json'), JSON.stringify({ status: 'FAIL', syntheticOnly: true, checks, errors, error: String(error.stack) }, null, 2)); throw error;
} finally { if (app) await app.close(); }
