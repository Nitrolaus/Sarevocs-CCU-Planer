import { app, safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { capsuleMetadata } from '../scripts/lib/session-metadata';
const arg = (key: string) => process.argv.find(x => x.startsWith(key + '='))?.slice(key.length + 1);
const output = path.resolve(arg('--output-dir')!);
const real = process.argv.includes('--real-metadata-only');
const synthetic = arg('--synthetic-vault');
if (!output.startsWith(path.resolve('work/temp/session-metadata') + path.sep) || real === !!synthetic) throw new Error('Explicit metadata mode required');
const directory = real ? path.join(process.env.LOCALAPPDATA!, 'SarevocsCCUPlaner-Daten', 'Anmeldung') : path.resolve(synthetic!);
if (!real && !directory.startsWith(path.resolve('work/temp/session-roundtrip') + path.sep)) throw new Error('Synthetic vault outside test root');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'runtime'));
// Electron 45 stores its Windows encrypted key in sessionData/Local State, not userData.
// Use existing key metadata in place. Never copy it or call vault.load/save/ACL preparation.
const sessionData = real ? path.join(process.env.LOCALAPPDATA!, 'SarevocsCCUPlaner-Daten', 'FluechtigeSitzungen') : path.join(path.dirname(directory), 'memory');
if (!fs.existsSync(path.join(sessionData, 'Local State'))) throw new Error('Existing encryption metadata required');
app.setPath('sessionData', sessionData);
app.setPath('crashDumps', path.join(output, 'crashes'));
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-breakpad');
app.whenReady().then(async () => {
  const report = { mode: real ? 'approved-metadata-only' : 'synthetic-only', fileCount: 0, readableCount: 0, unreadableCount: 0,
    readFailures: 0, decryptFailures: 0, formatFailures: 0,
    consentCookies: 0, protectionCookies: 0, otherCookies: 0,
    cookieCount: 0, activeKnownAuthCookies: 0, expiredKnownAuthCookies: 0, mfaDeviceCookiePresent: false,
    state: 'no-saved-session', sessionFileWrites: 0, rsiRequests: 0 };
  if (fs.existsSync(directory)) {
    if (fs.lstatSync(directory).isSymbolicLink()) throw new Error('Vault directory rejected');
    const files = fs.readdirSync(directory).filter(f => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.session\.enc$/i.test(f));
    if (files.length > 100) throw new Error('Vault file count rejected');
    report.fileCount = files.length;
    if (files.length && !await safeStorage.isAsyncEncryptionAvailable()) throw new Error('Encryption unavailable');
    for (const name of files) {
      let fd: number | undefined, encrypted: Buffer | undefined;
      let stage: 'read' | 'decrypt' | 'format' = 'read';
      try {
        const file = path.join(directory, name);
        if (fs.lstatSync(file).isSymbolicLink()) throw new Error('File rejected');
        fd = fs.openSync(file, 'r');
        const size = fs.fstatSync(fd).size;
        if (size < 1 || size > 2 * 1024 * 1024) throw new Error('File size rejected');
        encrypted = Buffer.alloc(size);
        if (fs.readSync(fd, encrypted, 0, size, 0) !== size || fs.fstatSync(fd).size !== size) throw new Error('File changed');
        stage = 'decrypt';
        const decrypted = await safeStorage.decryptStringAsync(encrypted);
        stage = 'format';
        const metadata = capsuleMetadata(JSON.parse(decrypted.result), name.slice(0, -'.session.enc'.length));
        if (!metadata.readable) throw new Error('Format rejected');
        report.readableCount++; report.cookieCount += metadata.cookieCount;
        report.consentCookies += metadata.consentCookies;
        report.protectionCookies += metadata.protectionCookies;
        report.otherCookies += metadata.otherCookies;
        report.activeKnownAuthCookies += metadata.activeKnownAuthCookies;
        report.expiredKnownAuthCookies += metadata.expiredKnownAuthCookies;
        report.mfaDeviceCookiePresent ||= metadata.mfaDeviceCookiePresent;
      } catch { report.unreadableCount++; if (stage === 'read') report.readFailures++; else if (stage === 'decrypt') report.decryptFailures++; else report.formatFailures++; }
      finally { encrypted?.fill(0); if (fd !== undefined) fs.closeSync(fd); }
    }
    report.state = report.unreadableCount ? 'unreadable-or-partial' : report.activeKnownAuthCookies ? 'present-unverified' : report.expiredKnownAuthCookies ? 'locally-expired' : files.length ? 'no-known-auth-token' : 'no-saved-session';
  }
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(report, null, 2));
  app.quit();
}).catch(() => {
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ state: 'inspection-unavailable', sessionFileWrites: 0, rsiRequests: 0 }));
  app.exit(1);
});
