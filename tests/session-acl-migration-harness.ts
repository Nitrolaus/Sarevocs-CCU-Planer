import { app, BrowserWindow, safeStorage } from 'electron';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { SessionVault, type Encryption, type StoredCookie } from '../src/security/session-vault';
import { RsiLogin } from '../src/importers/rsi';
import { APP_NAME } from '../src/domain/model';

const resultDirectory = 'C:\\CCU-Test-Result';
const marker = process.argv.find(arg => arg.startsWith('--test-id='))?.slice(10);
const phase = process.argv.find(arg => arg.startsWith('--phase='))?.slice(8);
if (process.env.USERNAME !== 'WDAGUtilityAccount' || !process.env.LOCALAPPDATA || !marker ||
    fs.readFileSync(path.join(resultDirectory, 'run-id.txt'), 'utf8').trim() !== marker ||
    !phase || !['write', 'baseline', 'read', 'reject-links', 'reject-helper'].includes(phase)) {
  throw new Error('Synthetic Windows Sandbox required');
}
const root = path.join(process.env.LOCALAPPDATA, 'SarevocsCCUPlaner-Daten');
const loginPath = path.join(root, 'Anmeldung');
const keyPath = path.join(root, 'FluechtigeSitzungen');
const account = 'b5a061d3-28ca-4c8b-bb89-3f79106e6e5d';
const cookie: StoredCookie = {
  name: 'Rsi-Token', value: 'SYNTHETIC_SESSION_NOT_REAL', domain: 'robertsspaceindustries.com',
  path: '/', secure: true, httpOnly: true, hostOnly: true, session: true, sameSite: 'lax',
};
for (const [key, directory] of [['userData', 'Laufzeit'], ['sessionData', 'FluechtigeSitzungen'], ['crashDumps', 'Diagnose']] as const) {
  const target = path.join(root, directory);
  fs.mkdirSync(target, { recursive: true });
  app.setPath(key, target);
}
app.setName(APP_NAME);

async function checkRestoredCookies(vault: SessionVault) {
  const originalLoad = BrowserWindow.prototype.loadURL;
  BrowserWindow.prototype.loadURL = async () => {};
  const parent = new BrowserWindow({ show: false, webPreferences: { sandbox: true, nodeIntegration: false } });
  const login = new RsiLogin(vault);
  try {
    await login.open(account, parent, true);
    const window = BrowserWindow.getAllWindows().find(candidate => candidate !== parent);
    assert.ok(window);
    const [restored] = await window.webContents.session.cookies.get({ name: cookie.name });
    assert.ok(restored);
    for (const key of ['value', 'domain', 'path', 'secure', 'httpOnly', 'sameSite'] as const) {
      assert.equal(restored[key], cookie[key]);
    }
  } finally {
    await login.shutdown();
    parent.destroy();
    BrowserWindow.prototype.loadURL = originalLoad;
  }
}

async function checkFailure(directory: string, keyDirectory?: string) {
  let encryptionTouched = false;
  const encryption: Encryption = {
    isAsyncEncryptionAvailable: async () => true,
    encryptStringAsync: async () => { encryptionTouched = true; throw new Error('Unexpected encryption'); },
    decryptStringAsync: async () => { encryptionTouched = true; throw new Error('Unexpected decryption'); },
  };
  const vault = new SessionVault(directory, encryption, keyDirectory);
  await assert.rejects(() => vault.save(account, [cookie]), /geschützte Ordnerrechte/);
  await assert.rejects(() => vault.load(account), /geschützte Ordnerrechte/);
  assert.equal(encryptionTouched, false);
}

app.whenReady().then(async () => {
  const report: Record<string, unknown> = { phase, status: 'PASS', data: 'synthetic-only', actualRsiRequests: 0 };
  const negatives = path.join(root, 'Sandbox-Acl-Negatives');
  if (phase === 'reject-links') {
    await checkFailure(path.join(negatives, 'leaf-junction'));
    await checkFailure(path.join(negatives, 'parent-junction', 'must-not-be-created'));
    await checkFailure(path.join(negatives, 'never-created'), path.join(negatives, 'hardlink-key'));
    report.rejectedPaths = ['directory junction', 'ancestor junction', 'linked key file'];
  } else if (phase === 'reject-helper') {
    await checkFailure(path.join(negatives, 'never-created'));
    report.invalidHelperRejected = true;
  } else {
    const vault = new SessionVault(loginPath, safeStorage, keyPath);
    if (phase === 'write') assert.equal(await vault.save(account, [cookie]), true);
    assert.deepEqual(await vault.load(account, false), [cookie]);
    assert.equal((await vault.status(account)).saved, true);
    const ciphertext = fs.readFileSync(path.join(loginPath, account + '.session.enc'));
    assert.equal(ciphertext.includes(Buffer.from(cookie.value)), false);
    report.ciphertextSha256 = createHash('sha256').update(ciphertext).digest('hex');
    if (phase === 'read') {
      await checkRestoredCookies(vault);
      report.restoredBrowserCookies = true;
    }
  }
  fs.writeFileSync(path.join(resultDirectory, phase + '.json'), JSON.stringify(report, null, 2));
  app.quit();
}).catch(error => {
  fs.writeFileSync(path.join(resultDirectory, phase + '.json'), JSON.stringify({ phase, status: 'FAIL', error: error.message }, null, 2));
  app.exit(1);
});
