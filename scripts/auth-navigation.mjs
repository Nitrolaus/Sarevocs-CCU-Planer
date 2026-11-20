import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
const baseline = process.argv.includes('--baseline'), require = createRequire(import.meta.url);
const folder = path.resolve('work/temp/auth-navigation', randomUUID()); fs.mkdirSync(folder, { recursive: true });
const plugins = baseline ? [{ name: 'unchanged-0.3.6', setup(b) {
  const baselineDirectory = process.argv.find(value => value.startsWith('--baseline-dir='))?.slice(15);
  if (!baselineDirectory) throw new Error('BASELINE_DIRECTORY_REQUIRED');
  const checkpoint = { Backup: path.resolve(baselineDirectory) };
  b.onResolve({ filter: /src\/importers\/rsi$/ }, () => ({ path: path.join(checkpoint.Backup, 'src/importers/rsi.ts') }));
} }] : [];
const harness = path.join(folder, 'harness.cjs');
await build({ entryPoints: ['tests/auth-navigation-harness.ts'], outfile: harness, bundle: true, platform: 'node', format: 'cjs', target: 'node24', external: ['electron'], nodePaths: [path.resolve('node_modules')], plugins });
const env = { ...process.env, TEMP: path.resolve('work/temp/tooling'), TMP: path.resolve('work/temp/tooling') }; delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
const code = await new Promise(resolve => {
  const child = spawn(require('electron'), [harness, '--test-root=' + folder, ...(baseline ? ['--baseline'] : []), '--disable-gpu', '--disable-background-networking', '--disable-breakpad'], { env, windowsHide: true, stdio: 'ignore' });
  const timer = setTimeout(() => { child.kill(); resolve(-1); }, 25000);
  child.on('error', () => { clearTimeout(timer); resolve(-1); }); child.on('exit', value => { clearTimeout(timer); resolve(value); });
});
const report = JSON.parse(fs.readFileSync(path.join(folder, 'results.json'), 'utf8'));
const expectedFailure = baseline && report.status === 'FAIL' && report.stage === 'modern-sign-in-wait' && report.navigationBlocked === true;
if (baseline) fs.writeFileSync('work/temp/auth-navigation-baseline-0.3.7.json', JSON.stringify({ expectedFailure, baselineVersion: '0.3.6', report: path.join(folder, 'results.json') }, null, 2));
console.log(JSON.stringify({ status: report.status, baseline, expectedFailure, testGroups: report.results?.length ?? 0 })); console.log('REPORT:', path.join(folder, 'results.json'));
process.exitCode = baseline ? expectedFailure ? 0 : 1 : code === 0 && report.status === 'PASS' ? 0 : 1;
