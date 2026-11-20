import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
const require = createRequire(import.meta.url), root = process.cwd();
const real = process.argv.includes('--real-metadata-only');
const synthetic = process.argv.find(x => x.startsWith('--synthetic-vault='));
const expectedState = process.argv.find(x => x.startsWith('--expect-state='))?.slice(15);
if (real && expectedState) throw new Error('Expectations are only allowed for synthetic fixtures');
if (real === !!synthetic) throw new Error('Nur nach Freigabe --real-metadata-only oder einen kuenstlichen Testordner angeben.');
if (synthetic && !path.resolve(synthetic.slice(18)).startsWith(path.resolve('work/temp/session-roundtrip') + path.sep)) throw new Error('Only synthetic test directories accepted');
const folder = path.resolve('work/temp/session-metadata', randomUUID()); fs.mkdirSync(folder, { recursive: true });
const harness = path.join(folder, 'harness.cjs');
await build({ entryPoints: ['tests/session-metadata-harness.ts'], outfile: harness, bundle: true, platform: 'node', format: 'cjs', target: 'node24', external: ['electron'] });
const env = { ...process.env, TEMP: path.resolve('work/temp/tooling'), TMP: path.resolve('work/temp/tooling') };
delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
await new Promise((resolve, reject) => {
  const child = spawn(require('electron'), [harness, '--output-dir=' + folder, real ? '--real-metadata-only' : synthetic, '--disable-gpu', '--disable-background-networking', '--disable-breakpad'], { cwd: root, env, windowsHide: true, stdio: 'ignore' });
  const timer = setTimeout(() => { child.kill(); reject(new Error('Metadata-only inspection timed out')); }, 20000);
  child.once('error', e => { clearTimeout(timer); reject(e); });
  child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('Metadata-only inspection unavailable')); });
});
const result = JSON.parse(fs.readFileSync(path.join(folder, 'results.json'), 'utf8'));
// Whitelist the console contract too: never forward arbitrary decrypted/parser output.
const summary = { mode: real ? 'approved-metadata-only' : 'synthetic-only' };
for (const key of ['fileCount', 'readableCount', 'unreadableCount', 'readFailures', 'decryptFailures', 'formatFailures', 'cookieCount', 'activeKnownAuthCookies', 'expiredKnownAuthCookies', 'consentCookies', 'protectionCookies', 'otherCookies', 'sessionFileWrites', 'rsiRequests']) {
  if (!Number.isSafeInteger(result[key]) || result[key] < 0 || result[key] > 50000) throw new Error('Invalid metadata-only result');
  summary[key] = result[key];
}
if (typeof result.mfaDeviceCookiePresent !== 'boolean' || result.sessionFileWrites !== 0 || result.rsiRequests !== 0) throw new Error('Invalid metadata-only result');
summary.mfaDeviceCookiePresent = result.mfaDeviceCookiePresent;
const states = new Set(['no-saved-session', 'unreadable-or-partial', 'present-unverified', 'locally-expired', 'no-known-auth-token']);
if (!states.has(result.state)) throw new Error('Invalid metadata-only result');
summary.state = result.state;
console.log(JSON.stringify(summary)); console.log('REPORT:', path.join(folder, 'results.json'));
if (expectedState && (!states.has(expectedState) || summary.state !== expectedState)) throw new Error('Synthetic metadata expectation failed');
