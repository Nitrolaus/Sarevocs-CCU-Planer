import { _electron } from 'playwright-core';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const require = createRequire(import.meta.url);
const root = process.cwd();
const runDir = path.join(root, 'work/temp/integration', randomUUID());
fs.mkdirSync(runDir, { recursive: true });
const environment = { ...process.env, TEMP: path.join(root, 'work/temp/tooling'), TMP: path.join(root, 'work/temp/tooling') };
delete environment.ELECTRON_RUN_AS_NODE; delete environment.NODE_OPTIONS;
const results = []; const errors = [];
const data = path.join(runDir, 'data');
let application;
async function result(name, fn) { await fn(); results.push({ name, status: 'PASS' }); console.log('PASS:', name); }
try {
  application = await _electron.launch({ executablePath: require('electron'), args: ['.', '--data-dir=' + data, '--disable-gpu'], cwd: root, env: environment, timeout: 30000 });
  const page = await application.firstWindow();
  page.on('pageerror', e => errors.push(e.message));
  await page.getByRole('heading', { name: 'Bestand', exact: true }).waitFor();
  await result('Start und Renderer ohne Node-Zugriff', async () => {
    assert.equal(await page.title(), 'Sarevoc´s CCU Planer');
    const permissions = await page.evaluate(() => ({ require: typeof window.require, process: typeof window.process, keys: Object.keys(window.ccu) }));
    assert.deepEqual(permissions, { require: 'undefined', process: 'undefined', keys: ['request'] });
    const prefs = await application.evaluate(({ BrowserWindow }) => {
      const p = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
      return { nodeIntegration: p.nodeIntegration, contextIsolation: p.contextIsolation, sandbox: p.sandbox, webSecurity: p.webSecurity };
    });
    assert.deepEqual(prefs, { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true });
  });
  await result('Demo mit Vorschau und ausdrücklicher Zuordnung; kein automatischer Import', async () => {
    await page.getByRole('button', { name: 'Demo-Datei ansehen' }).click();
    const modal = page.getByRole('dialog'); await modal.waitFor();
    const take = modal.getByRole('button', { name: 'Geprüften Import übernehmen' });
    assert.equal(await take.isDisabled(), true);
    await modal.getByRole('checkbox').nth(0).check(); await modal.getByRole('checkbox').nth(1).check();
    await page.screenshot({ path: path.join(runDir, 'import-preview.png') });
    await take.click(); await modal.waitFor({ state: 'hidden' });
    assert.equal(await page.getByRole('button', { name: 'CCUs', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('tbody tr').count(), 3);
    await page.getByRole('button', { name: 'Alle Gegenstände', exact: true }).click();
    assert.equal(await page.locator('tbody tr').count(), 5);
    assert.ok(await page.locator('main').innerText().then(t => t.includes('DEMO · synthetischer Bestand')));
    await page.screenshot({ path: path.join(runDir, 'inventory.png'), fullPage: true });
  });
  await result('Wiederimport ohne Duplikate', async () => {
    await page.getByRole('button', { name: 'Demo-Datei ansehen' }).click(); const modal = page.getByRole('dialog');
    for (const checkbox of await modal.getByRole('checkbox').all()) await checkbox.check();
    await modal.getByRole('button', { name: 'Geprüften Import übernehmen' }).click(); await modal.waitFor({ state: 'hidden' });
    assert.equal(await page.locator('tbody tr').count(), 5);
    assert.ok(await page.getByRole('status').filter({ hasText: 'bereits übernommen' }).innerText().then(t => t.includes('bereits übernommen')));
  });
  await result('Echter Dateiweg über nativen Dateidialog (nur Auswahl im Test ersetzt)', async () => {
    await application.evaluate(({ dialog }, fixture) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fixture] }); }, path.join(root, 'tests/fixtures/demo-inventory.json'));
    await page.getByRole('button', { name: 'Datei importieren' }).click();
    const modal = page.getByRole('dialog'); await modal.getByRole('button', { name: 'Datei auswählen' }).click();
    for (const checkbox of await modal.getByRole('checkbox').all()) await checkbox.check();
    await modal.getByRole('button', { name: 'Geprüften Import übernehmen' }).click();
    await modal.waitFor({ state: 'hidden' }); assert.equal(await page.locator('tbody tr').count(), 5);
  });
  await result('Bridge lehnt unbekannte Operationen und zweiten Absender ab', async () => {
    const invalid = await page.evaluate(() => window.ccu.request({ action: 'state', sql: 'DROP TABLE accounts' })); assert.equal(invalid.ok, false);
    const spoof = await application.evaluate(async ({ BrowserWindow }, files) => {
      const w = new BrowserWindow({ show: false, webPreferences: { preload: files.preload, contextIsolation: true, sandbox: true, nodeIntegration: false } });
      try { await w.loadFile(files.html); return await w.webContents.executeJavaScript('window.ccu.request({action:"state"})'); }
      finally { w.destroy(); }
    }, { preload: path.join(root, 'build/preload.cjs'), html: path.join(root, 'build/renderer/index.html') });
    assert.equal(spoof.ok, false); assert.match(spoof.error, /nicht zugelassener/);
  });
  await result('Ausdrückliche Anmeldung und gelesener Bestand ohne Live-Importdialog oder RSI-Netzzugriff', async () => {
    const created = await page.evaluate(async () => (await window.ccu.request({ action: 'account.create', name: 'Testkonto – synthetisch', mode: 'real' })).data);
    // Refresh app state by reloading the local, CSP-protected page; no external site is opened.
    await page.reload(); await page.getByRole('combobox', { name: 'Lokales Kontoprofil', exact: true }).selectOption(created.id);
    await page.getByRole('button', { name: 'Anmelden', exact: true }).waitFor();
    assert.equal(await page.locator('dialog[open]').count(), 0);
    await page.getByRole('button', { name: 'Sitzung & Sicherheit', exact: true }).click(); const modal = page.getByRole('dialog');
    assert.equal(await modal.locator('details').getAttribute('open'), null);
    assert.equal(await modal.getByRole('button', { name: 'Hangarseite prüfen' }).count(), 0);
    await page.screenshot({ path: path.join(runDir, 'login-short.png') });
    await modal.locator('summary').click();
    await modal.getByText('Windows-Schutz: verfügbar', { exact: false }).waitFor();
    assert.equal(await modal.locator('input[type=password]').count(), 0);
    assert.equal(await modal.getByRole('checkbox').isChecked(), true);
    assert.equal(await modal.getByRole('button', { name: 'Gespeicherte Sitzung löschen' }).isDisabled(), true);
    await page.screenshot({ path: path.join(runDir, 'login-security.png') });
    await modal.getByRole('button', { name: 'Schließen', exact: true }).click();
    const legacyCipher = await application.evaluate(async ({ safeStorage }, accountId) => Array.from(await safeStorage.encryptStringAsync(JSON.stringify({
      schemaVersion: 1, accountId, issuer: 'https://robertsspaceindustries.com', cookies: [{ name: 'CookieConsent', value: 'SYNTHETIC_CONSENT_ONLY',
        domain: 'robertsspaceindustries.com', path: '/', secure: true, httpOnly: false, hostOnly: true, session: true, sameSite: 'lax' }]
    }))), created.id);
    fs.writeFileSync(path.join(data, 'Anmeldung', created.id + '.session.enc'), Buffer.from(legacyCipher), { flag: 'wx' });
    await page.getByRole('button', { name: 'Sitzung & Sicherheit', exact: true }).click();
    if (await modal.locator('details').getAttribute('open') === null) await modal.locator('summary').click();
    await modal.getByText('Gespeicherte Anmeldung: keine', { exact: false }).waitFor();
    assert.equal(await modal.getByRole('button', { name: 'Gespeicherte Sitzung löschen' }).isDisabled(), false);
    await modal.getByRole('button', { name: 'Schließen', exact: true }).click();
    const fixture = path.join(runDir, 'synthetic-hangar.html');
    fs.writeFileSync(fixture, '<div class="c-account-sidebar__profile-info-handle">SYNTHETIC_HANDLE</div><ul class="list-items"><li><input class="js-pledge-id" value="synthetic-001"><input class="js-pledge-name" value="SYNTHETIC PLEDGE"><div class="items-col">Synthetic contents</div><div class="date-col">Synthetic date</div><div class="item"><span class="title">Demo Ship</span><span class="kind">Ship</span></div></li></ul>');
    await application.evaluate(({ BrowserWindow }, fixture) => {
      globalThis.ccuOriginalLoadURL = BrowserWindow.prototype.loadURL;
      BrowserWindow.prototype.loadURL = async function () {
        this.webContents.getURL = () => 'https://robertsspaceindustries.com/account/pledges';
        await this.loadFile(fixture);
      };
    }, fixture);
    await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
    await page.getByText('Zuletzt gelesener Bestand', { exact: true }).waitFor();
    assert.equal(await page.locator('dialog[open]').count(), 0);
    await application.evaluate(({ BrowserWindow }) => { BrowserWindow.prototype.loadURL = globalThis.ccuOriginalLoadURL; delete globalThis.ccuOriginalLoadURL; });
    assert.equal((await page.evaluate(async id => (await window.ccu.request({ action: 'inventory', accountId: id })).data, created.id)).items.length, 0);
    await page.getByRole('button', { name: 'Alle Gegenstände', exact: true }).click();
    await page.locator('tbody tr').filter({ hasText: 'SYNTHETIC PLEDGE' }).waitFor();
    await page.getByRole('combobox', { name: 'Lokales Kontoprofil', exact: true }).selectOption({ label: 'Demo – synthetischer Bestand · Demo' });
    await page.locator('tbody tr').filter({ hasText: 'Demo-Basisschiff Alpha' }).waitFor();
  });
  await result('1024-Pixel-Fenster und Importdialog ohne horizontales Abschneiden', async () => {
    await page.setViewportSize({ width: 1024, height: 768 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
    await page.getByRole('button', { name: 'Datei importieren' }).click();
    const bounds = await page.getByRole('dialog').boundingBox(); assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 1024 && bounds.height <= 768);
    await page.screenshot({ path: path.join(runDir, 'layout-1024.png') });
    await page.getByRole('dialog').getByRole('button', { name: 'Abbrechen' }).click();
  });
  await result('Importiertes HTML bleibt Text in der laufenden Oberfläche', async () => {
    const document = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/demo-inventory.json'), 'utf8'));
    document.createdAt = '2026-11-15T00:00:00Z'; document.pledges[0].name = '<img src=x onerror="window.__unsafe=true">';
    const fixture = path.join(runDir, 'inert-html-demo.json'); fs.writeFileSync(fixture, JSON.stringify(document));
    await application.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, fixture);
    await page.getByRole('button', { name: 'Datei importieren' }).click(); const modal = page.getByRole('dialog');
    await modal.getByRole('button', { name: 'Datei auswählen' }).click();
    for (const checkbox of await modal.getByRole('checkbox').all()) await checkbox.check();
    await modal.getByRole('button', { name: 'Geprüften Import übernehmen' }).click(); await modal.waitFor({ state: 'hidden' });
    assert.ok(await page.locator('tbody').innerText().then(t => t.includes('<img src=x')));
    assert.equal(await page.locator('tbody img').count(), 0);
    assert.equal(await page.locator('img:not([src="app.png"])').count(), 0);
    assert.equal(await page.evaluate(() => window.__unsafe), undefined);
  });
  const versions = await page.evaluate(async () => (await window.ccu.request({ action: 'state' })).data);
  await application.close(); application = undefined;
  await result('Neustart mit gespeichertem Bestand und 125-Prozent-Skalierung', async () => {
    application = await _electron.launch({ executablePath: require('electron'), args: ['.', '--data-dir=' + data, '--disable-gpu', '--force-device-scale-factor=1.25'], cwd: root, env: environment, timeout: 30000 });
    const p = await application.firstWindow(); await p.getByRole('heading', { name: 'Bestand', exact: true }).waitFor();
    await p.getByRole('button', { name: 'Alle Gegenstände', exact: true }).click();
    await p.locator('tbody tr').filter({ hasText: '<img src=x' }).waitFor(); assert.equal(await p.locator('tbody tr').count(), 5);
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
    await p.screenshot({ path: path.join(runDir, 'layout-125-percent.png'), fullPage: true });
  });
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(runDir, 'results.json'), JSON.stringify({ status: 'PASS', data: 'synthetic-only', versions, results, pageErrors: errors }, null, 2));
  console.log('REPORT:', path.join(runDir, 'results.json'));
} catch (error) {
  fs.writeFileSync(path.join(runDir, 'results.json'), JSON.stringify({ status: 'FAIL', results, error: error.message }, null, 2));
  console.error(error); process.exitCode = 1;
} finally { if (application) await application.close(); }
