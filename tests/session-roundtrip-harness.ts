import { app, BrowserWindow, safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { RsiLogin } from '../src/importers/rsi';
import { SessionVault } from '../src/security/session-vault';
const argument = (key: string) => process.argv.find(x => x.startsWith(key + '='))?.slice(key.length + 1);
const root = path.resolve(argument('--test-root')!);
const phase = argument('--phase');
const runtime = argument('--runtime') ?? 'runtime';
const mixed = argument('--case') === 'nonsecure-auth';
const duplicateHandle = argument('--case') === 'duplicate-handle';
const account = 'b5a061d3-28ca-4c8b-bb89-3f79106e6e5d';
if (!root.startsWith(path.resolve('work/temp/session-roundtrip') + path.sep) || !['runtime', 'other-runtime'].includes(runtime) || !['write', 'read'].includes(phase ?? '')) throw new Error('Synthetic test arguments required');
fs.mkdirSync(root, { recursive: true });
app.setPath('userData', path.join(root, runtime));
app.setPath('sessionData', path.join(root, 'memory'));
app.setPath('crashDumps', path.join(root, 'crashes'));
const expected = [
  { name: 'Rsi-Token', value: 'SYNTHETIC_AUTH_ONLY', secure: !mixed, httpOnly: true, sameSite: 'lax' as const },
  { name: '_rsi_device', value: 'SYNTHETIC_DEVICE_ONLY', secure: true, httpOnly: true, sameSite: 'lax' as const },
  { name: 'CookieConsent', value: 'SYNTHETIC_CONSENT_ONLY', secure: !mixed, httpOnly: false, sameSite: 'lax' as const },
];
app.whenReady().then(async () => {
  const vault = new SessionVault(path.join(root, 'Anmeldung'), safeStorage, app.getPath('sessionData'));
  const login = new RsiLogin(vault, undefined, undefined, (id, identity) => id === account && identity.reference === 'SYNTHETIC_HANDLE');
  const parent = new BrowserWindow({ show: false, webPreferences: { sandbox: true, nodeIntegration: false } });
  const fixture = path.join(root, 'offline.html'); fs.writeFileSync(fixture, `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'"><span class="c-account-sidebar__profile-info-handle">SYNTHETIC_HANDLE</span>${duplicateHandle?'<span class="c-account-sidebar__profile-info-handle">SYNTHETIC_HANDLE</span>':''}<ul class="list-items"><li><div class="empty-list"></div></li></ul>`);
  let navigations = 0;
  BrowserWindow.prototype.loadURL = async function () {
    navigations++;
    this.webContents.getURL = () => 'https://robertsspaceindustries.com/account/pledges';
    await this.loadFile(fixture);
  };
  try {
    await login.open(account, parent, true);
    const remote = BrowserWindow.getAllWindows().find(w => w !== parent)!;
    // The fixture has no remote resources; also reject every HTTP subresource explicitly.
    remote.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: /^https?:/.test(details.url) }));
    if (phase === 'write') for (const cookie of expected) {
      await remote.webContents.session.cookies.set({ ...cookie, url: 'https://robertsspaceindustries.com/',
        ...(cookie.name === '_rsi_device' ? { expirationDate: Date.now() / 1000 + 3600 } : {}) });
    }
    const observed = await remote.webContents.session.cookies.get({});
    const allFieldsMatch = expected.every(e => observed.some(c => c.name === e.name && c.value === e.value && c.secure === (phase === 'read' ? true : e.secure) && c.httpOnly === e.httpOnly && c.sameSite === e.sameSite));
    const beforeClose = { count: observed.length, authPresent: observed.some(c => c.name === 'Rsi-Token'), allFieldsMatch };
    if (phase === 'write') {
      if (remote.webContents.isLoadingMainFrame()) await new Promise<void>(resolve => remote.webContents.once('did-finish-load', () => resolve()));
      await login.probe(account);
    }
    await login.close(account);
    const stored = await vault.load(account);
    const settings = await vault.status(account);
    const result = { status: phase === 'write' || allFieldsMatch ? 'PASS' : 'FAIL', phase, case: duplicateHandle ? 'duplicate-handle' : mixed ? 'nonsecure-auth' : 'secure-only',
      data: 'synthetic-only', beforeClose, storedCount: stored.length, storedAuthPresent: stored.some(c => c.name === 'Rsi-Token'),
      filePresent: settings.saved, navigations, actualRsiRequests: 0 };
    fs.writeFileSync(path.join(root, phase + '.json'), JSON.stringify(result, null, 2));
  } finally { await login.shutdown(); parent.destroy(); }
  app.quit();
}).catch(error => {
  fs.writeFileSync(path.join(root, phase + '.json'), JSON.stringify({ status: 'ERROR', data: 'synthetic-only', error: error.message }, null, 2));
  app.exit(1);
});
