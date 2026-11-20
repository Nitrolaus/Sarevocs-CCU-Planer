import { app, BrowserWindow, safeStorage, net } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { SessionVault, type StoredCookie } from '../src/security/session-vault';
import { RsiLogin } from '../src/importers/rsi';
import { protectSessionDirectory } from '../src/security/directory';
const root = path.resolve(process.argv.find(x => x.startsWith('--test-root='))!.slice(12));
for (const folder of ['runtime','sessions','crashes']) fs.mkdirSync(path.join(root, folder), { recursive: true });
app.setPath('userData', path.join(root, 'runtime')); app.setPath('sessionData', path.join(root, 'sessions')); app.setPath('crashDumps', path.join(root, 'crashes'));
const results: string[] = [];
app.whenReady().then(async () => {
  const vault = new SessionVault(path.join(root, 'Anmeldung'), safeStorage, app.getPath('sessionData'));
  const accountId = randomUUID(), otherId = randomUUID();
  const cookie: StoredCookie = { name: 'Rsi-Token', value: 'FAKE_COOKIE_NOT_A_REAL_SESSION_749813', domain: 'robertsspaceindustries.com',
    path: '/', secure: true, httpOnly: true, hostOnly: true, session: true, sameSite: 'lax' };
  assert.equal(await safeStorage.isAsyncEncryptionAvailable(), true);
  try { await protectSessionDirectory(vault.directory); }
  catch (error) { console.error('SYNTHETIC DIRECTORY TEST:', (error as { stderr?: string }).stderr ?? (error as Error).message); throw error; }
  await vault.save(accountId, [cookie]); const file = path.join(vault.directory, accountId + '.session.enc');
  const encrypted = fs.readFileSync(file);
  assert.equal(encrypted.includes(Buffer.from(cookie.value)), false);
  assert.equal(encrypted.includes(Buffer.from(cookie.name)), false);
  assert.deepEqual(await vault.load(accountId), [cookie]);
  results.push('Reale Windows-DPAPI/safeStorage-Verschluesselung mit synthetischer Sitzung; keine Klartextwerte in Datei.');
  assert.equal((await vault.status(accountId)).available, true);
  results.push('Anmeldeordner mit geschuetzter DACL: nur aktueller Benutzer und SYSTEM, keine geerbten Fremdrechte.');
  const consent = { ...cookie, name: 'CookieConsent' };
  assert.equal(await vault.save(otherId, [consent]), false);
  assert.equal((await vault.status(otherId)).stored, false);
  assert.equal(await vault.save(accountId, [consent]), false);
  assert.deepEqual(fs.readFileSync(file), encrypted);
  assert.equal((await vault.status(accountId)).saved, true);
  results.push('Zustimmung allein erzeugt keine Anmeldung und ueberschreibt keinen vorhandenen Anmeldesnapshot.');
  const legacy = path.join(vault.directory, otherId + '.session.enc');
  fs.writeFileSync(legacy, await safeStorage.encryptStringAsync(JSON.stringify({ schemaVersion: 1, accountId: otherId,
    issuer: 'https://robertsspaceindustries.com', cookies: [consent] })));
  const legacyBytes = fs.readFileSync(legacy); const legacyStatus = await vault.status(otherId);
  assert.equal(legacyStatus.stored, true); assert.equal(legacyStatus.saved, false);
  assert.deepEqual(fs.readFileSync(legacy), legacyBytes); await vault.remove(otherId);
  results.push('Alte reine Zustimmungsdatei wird als Datei erkannt, nicht als Anmeldung und bleibt bei Statusabfrage unveraendert.');
  const otherFile = path.join(vault.directory, otherId + '.session.enc'); fs.copyFileSync(file, otherFile);
  await assert.rejects(() => vault.load(otherId), /nicht lesbar/); await vault.remove(otherId);
  const corrupt = Buffer.from(encrypted); corrupt[Math.floor(corrupt.length / 2)]! ^= 0x4a; fs.writeFileSync(file, corrupt);
  await assert.rejects(() => vault.load(accountId), /nicht lesbar/); fs.writeFileSync(file, encrypted);
  results.push('Umbenannte Kontositzung und manipulierte Chiffre abgewiesen, keine Konto-Vermischung.');
  const blockedFolder = path.join(root, 'unavailable'); let encryptionCalled = false;
  const blocked = new SessionVault(blockedFolder, { isAsyncEncryptionAvailable: async () => false,
    encryptStringAsync: async () => { encryptionCalled = true; throw new Error('must not run'); }, decryptStringAsync: async () => { throw new Error('must not run'); } });
  await assert.rejects(() => blocked.save(accountId, [cookie])); assert.equal(encryptionCalled, false); assert.equal(fs.existsSync(blockedFolder), false);
  results.push('Fehlender Windows-Schutz verweigert Speicherung ohne Klartext-Fallback.');
  // Prevent any network request: the real BrowserWindow/session/cookie APIs remain in use.
  const originalLoad = BrowserWindow.prototype.loadURL;
  BrowserWindow.prototype.loadURL = async () => {};
  const parent = new BrowserWindow({ show: false, webPreferences: { sandbox: true, nodeIntegration: false, partition: 'synthetic-parent' } });
  const login = new RsiLogin(vault);
  try {
    await login.open(accountId, parent, true);
    let child = BrowserWindow.getAllWindows().find(w => w !== parent)!;
    const transportError = await new Promise<string>((resolve, reject) => {
      const request = net.request({ url: 'http://127.0.0.1:9/ccu-transport-test', session: child.webContents.session });
      const timer = setTimeout(() => { request.abort(); reject(new Error('Transport guard timed out')); }, 5000);
      request.on('error', e => { clearTimeout(timer); resolve(e.message); });
      request.on('response', () => { clearTimeout(timer); request.abort(); reject(new Error('Insecure request escaped guard')); });
      request.end();
    });
    assert.match(transportError, /ERR_BLOCKED_BY_CLIENT/);
    results.push('Tatsaechlicher unverschluesselter HTTP-Request im RSI-Kontext vor Netzversand blockiert.');
    assert.equal((await child.webContents.session.cookies.get({ name: cookie.name }))[0]!.value, cookie.value);
    await child.webContents.session.cookies.set({ url: 'https://robertsspaceindustries.com/', name: cookie.name, value: 'UPDATED_FAKE_SESSION', secure: true, httpOnly: true, sameSite: 'lax' });
    await login.close(accountId);
    assert.deepEqual(fs.readFileSync(file), encrypted);
    await login.open(accountId, parent, true); child = BrowserWindow.getAllWindows().find(w => w !== parent)!;
    assert.equal((await child.webContents.session.cookies.get({ name: cookie.name }))[0]!.value, cookie.value);
    results.push('Ohne bestätigte Hangaridentität bleibt die verschlüsselte Sitzung beim Schließen bytegleich und lässt sich erneut laden.');
    await login.open(otherId, parent, false);
    const ephemeral = BrowserWindow.getAllWindows().find(w => w !== parent && w !== child)!;
    await ephemeral.webContents.session.cookies.set({ url: 'https://robertsspaceindustries.com/', name: cookie.name, value: 'EPHEMERAL_FAKE_SESSION', secure: true, httpOnly: true });
    await login.close(otherId); assert.equal((await vault.status(otherId)).saved, false);
    const marker = path.join(root, 'inventory-preserved.txt'); fs.writeFileSync(marker, 'SYNTHETIC INVENTORY');
    const pending = path.join(vault.directory, accountId + '.11111111-1111-4111-8111-111111111111.session.pending');
    const unrelated = path.join(vault.directory, otherId + '.11111111-1111-4111-8111-111111111111.session.pending');
    fs.copyFileSync(file, pending); fs.copyFileSync(file, unrelated);
    await login.remove(accountId);
    assert.equal(fs.existsSync(file), false); assert.equal(fs.existsSync(pending), false);
    assert.equal(fs.existsSync(unrelated), true); fs.unlinkSync(unrelated);
    assert.equal(fs.readFileSync(marker, 'utf8'), 'SYNTHETIC INVENTORY');
    results.push('Fluechtiger Modus schreibt keine Sitzungsdatei; gezieltes Loeschen entfernt nur dieses Konto und erhaelt Inventar.');
    assert.equal(await login.shutdown(), true);
  } finally { BrowserWindow.prototype.loadURL = originalLoad; parent.destroy(); }
  fs.writeFileSync(path.join(root, 'results.json'), JSON.stringify({ status: 'PASS', data: 'synthetic-only', network: 'blocked in test before navigation', results }, null, 2));
  console.log('PASS: ' + results.join('\nPASS: ')); console.log('REPORT: ' + path.join(root, 'results.json')); app.quit();
}).catch(error => {
  fs.writeFileSync(path.join(root, 'results.json'), JSON.stringify({ status: 'FAIL', results, error: error.message }, null, 2));
  console.error('Sicherheitstest fehlgeschlagen; Details im synthetischen Testbericht.'); app.exit(1);
});
