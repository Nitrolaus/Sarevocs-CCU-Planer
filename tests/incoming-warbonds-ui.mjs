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
const quotes = [[1, 2, 3270, 4360], [3, 4, 2180, 4360], [4, 5, 27250, 29975]].flatMap(([fromId, toId, wb, std]) =>
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
  assert.match(await page.locator('.outgoing-table').innerText(), /B → Eclipse[\s\S]*21,80[\s\S]*21,80[\s\S]*Noch nicht gekauft/);
  assert.equal(await page.locator('.outgoing-relation').first().innerText(), 'Rabatt bereits eingeplant');
  assert.equal(await page.locator('.outgoing-relation').last().innerText(), 'Verbindung eingeplant');
  assert.match(await page.locator('.outgoing-relation').first().getAttribute('title'), /keine zusätzliche Ersparnis/);
  assert.doesNotMatch(await page.locator('.outgoing-table').innerText(), /Eclipse →|Liberator/);
  assert.deepEqual(await app.evaluate(() => globalThis.fixture.planDrafts), fixture.planDrafts);
  checks.push('existing purchase pairs lead toward Eclipse; pair discount is distinguished from additional route saving; draft unchanged');
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
  assert.ok(pairs.some(p => p.fromId === 3 && p.toId === 4));
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
    if (kind === 'already-owned' || kind === 'locked-owned') for (const [from, to] of [['Starter', 'A'], ['B', 'Eclipse']]) {
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
    if (kind === 'already-owned' || kind === 'locked-owned') assert.match(await page.locator('.outgoing-status').innerText(), /bereits im Bestand|im Bestand abgedeckt/);
    if (['no-discount-proof','standard-only','zero-discount','different-tax','expired'].includes(kind))
      assert.match(await page.locator('.outgoing-status').innerText(), /noch nicht bestätigt/);
  }
  await app.evaluate((_electron,{a,items,draft,market,at})=>{
    const f=globalThis.fixture;f.inventories[a].items=items;f.inventories[a].account.lastComplete=at;
    f.market=market;f.market.offers.items.forEach(o=>{o.warbond=false;o.warbondMinor=null;});
    f.planDrafts={ [a+':4']:draft };f.excludedCcus={ [a]:[] };
  },{a,items,draft,market,at});
  await planner();assert.match(await page.locator('.outgoing-status').innerText(),/kein passendes Warbond-Angebot bekannt/);
  // Reproduce the user's equal-value Blade/Sentinel case with entirely synthetic records.
  const demoShips = ['MTC', 'Vanguard Sentinel', 'Blade', 'M80'].map((name, i) => ({ ...ships[0], id: 101 + i, name }));
  const demoOffers = demoShips.map((ship, i) => ({ ...offers[0], key: 'synthetic-m80:' + i, targetName: ship.name, toShipId: ship.id,
    regularMinor: [5000, 27500, 27500, 30000][i], warbond: i === 3, warbondMinor: i === 3 ? 28000 : null }));
  const demoValues = { ...market.values, items: demoOffers.map(o => ({ id: o.toShipId, name: o.targetName, minor: o.regularMinor })) };
  const demoItem = structuredClone(items[0]); demoItem.pledge.ships[0].modelName = 'MTC';
  const demoPool = prepareChains([demoItem.pledge], demoShips, demoOffers, true, undefined, demoValues);
  const demoDraft = { ...approveStartBase(demoPool, emptyDraft(), demoPool.bases[0].key), mode: 'manual', initialized: true,
    anchors: [{ kind: 'purchase', fromKey: 'matrix:101', toKey: 'matrix:102', fromName: 'MTC', toName: 'Vanguard Sentinel' }] };
  const demoQuotes = [102, 103].flatMap(fromId => ['standard', 'warbond'].map(edition => ({ fromId, toId: 104, edition, checkedAt: Date.now(),
    amount: { minor: edition === 'warbond' ? 500 : 2500, currency: 'USD', taxMode: 'net', vatBasisPoints: 0 } })));
  await app.evaluate((_electron, { a, at, demoItem, demoShips, demoOffers, demoValues, demoDraft, demoQuotes }) => {
    const f = globalThis.fixture; f.inventories[a].items = [demoItem]; f.inventories[a].account.lastComplete = at;
    f.market.catalogue.ships = demoShips; f.market.offers.items = demoOffers; f.market.offers.sourceAt = at;
    f.market.values = demoValues; f.market.shopPrices = demoQuotes; f.targets[a] = [104, null, null];
    f.planDrafts = { [a + ':104']: demoDraft }; f.excludedCcus = { [a]: [] };
    f.pricing.settings.currency = 'USD'; f.pricing.settings.taxMode = 'net';
  }, { a, at, demoItem, demoShips, demoOffers, demoValues, demoDraft, demoQuotes });
  await page.reload(); await page.getByRole('heading', { name: 'Bestand', exact: true }).waitFor();
  await page.getByRole('button', { name: /CCU-Planer/ }).click();
  await page.getByRole('heading', { name: 'Warbond-Kauftipps für die Kette zu M80 · Schiff 1', exact: true }).waitFor();
  await page.locator('.outgoing-table').waitFor();
  assert.equal(await page.locator('.outgoing-purchase').count(), 1);
  assert.match(await page.locator('.outgoing-purchase').innerText(), /Vanguard Sentinel → M80/);
  assert.doesNotMatch(await page.locator('.outgoing-purchase').innerText(), /Blade/);
  assert.equal(await page.locator('.outgoing-relation').innerText(), 'Rabatt bereits eingeplant');
  await app.evaluate((_electron, { a, demoShips, demoOffers, demoValues, demoDraft }) => {
    const f = globalThis.fixture, ship = { ...demoShips[3], id: 105, name: 'Liberator' };
    f.market.catalogue.ships = [...demoShips, ship];
    f.market.offers.items = [...demoOffers, { ...demoOffers[0], key: 'synthetic-liberator', targetName: ship.name, toShipId: ship.id, regularMinor: 57500 }];
    f.market.values.items = [...demoValues.items, { id: 105, name: ship.name, minor: 57500 }];
    f.targets[a] = [105, null, null]; f.planDrafts = { [a + ':105']: demoDraft };
  }, { a, demoShips, demoOffers, demoValues, demoDraft });
  await page.reload(); await page.getByRole('heading', { name: 'Bestand', exact: true }).waitFor();
  await page.getByRole('button', { name: /CCU-Planer/ }).click(); await page.locator('.outgoing-table').waitFor();
  assert.equal(await page.locator('.outgoing-relation').innerText(), 'Für offene Verbindung');
  assert.match(await page.locator('.outgoing-relation').getAttribute('title'), /zusätzliche Ersparnis.*noch nicht belegt/);
  checks.push('a new intermediate Warbond is distinguished from a discount already counted in the chain');
  await app.evaluate((_electron, { a, demoDraft }) => { const f = globalThis.fixture; f.targets[a] = [104, null, null]; f.planDrafts = { [a + ':104']: demoDraft }; }, { a, demoDraft });
  await page.reload(); await page.getByRole('heading', { name: 'Bestand', exact: true }).waitFor();
  await page.getByRole('button', { name: /CCU-Planer/ }).click(); await page.locator('.outgoing-table').waitFor();
  assert.equal(await page.locator('.outgoing-relation').innerText(), 'Rabatt bereits eingeplant');
  const rowHeights = [];
  for (const [width, zoom] of [[1540, 1], [1024, 1], [1280, 1.25]]) {
    await app.evaluate(({ BrowserWindow }, { width, zoom }) => { const w = BrowserWindow.getAllWindows()[0]; w.webContents.setZoomFactor(zoom); w.setContentSize(width, 1350); }, { width, zoom });
    await page.waitForTimeout(100);
    const heights = await page.locator('.outgoing-purchase').evaluate(row => {
      const label = row.querySelector('.outgoing-relation'), shown = row.getBoundingClientRect().height;
      label.style.display = 'none'; const hidden = row.getBoundingClientRect().height; label.style.display = '';
      return { shown, hidden };
    });
    assert.equal(heights.shown, heights.hidden, 'the explanation must not increase row height'); rowHeights.push(heights);
  }
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.webContents.setZoomFactor(1); w.setContentSize(1540, 1350); });
  await page.locator('.outgoing-warbonds').evaluate(node => {
    const label = document.createElement('small'); label.textContent = 'VORSCHAU · TESTDATEN · keine Bestellung';
    label.style.cssText = 'display:block;color:#a9bdc9;margin-bottom:8px'; node.prepend(label);
  });
  const plannedScreenshot = path.join(folder, 'm80-planned-warbond.png');
  await page.locator('.outgoing-warbonds').screenshot({ path: plannedScreenshot });
  checks.push('M80 prefers the planned Sentinel over equal-value Blade and marks the already included discount without increasing row height');
  commands = await app.evaluate(() => globalThis.fixture.commands);
  assert.ok(!commands.some(c => /^(rsi\.(connect|open|authorize)|cart|purchase|checkout)(\.|$)/.test(c.action)));
  assert.ok(!commands.some(c => c.action === 'planner.draft' && c.draft || c.action === 'planner.exclude' || c.action === 'planner.batch'));
  assert.deepEqual(errors, []); checks.push('owned/locked/partial/stale/unproven/invalid cases hidden; no login, draft changes or renderer errors');
  const report = { status: 'PASS', syntheticOnly: true, realSessionRead: false, newRsiLogin: false, packagedRenderer: !!packaged, checks, hiddenCases, dimensions, colors, rowHeights, screenshot, plannedScreenshot };
  fs.writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
} catch (error) {
  fs.writeFileSync(path.join(folder, 'report.json'), JSON.stringify({ status: 'FAIL', syntheticOnly: true, checks, errors, error: String(error.stack) }, null, 2)); throw error;
} finally { if (app) await app.close(); }
