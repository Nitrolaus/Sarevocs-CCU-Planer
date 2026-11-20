import { build } from 'esbuild';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url), root = process.cwd();
const baseline = process.argv.includes('--baseline');
const folder = path.resolve('work/temp/window-lifecycle', randomUUID());
fs.mkdirSync(folder, { recursive: true });
fs.mkdirSync(path.resolve('work/temp/tooling'), { recursive: true });
const harness = path.join(folder, 'harness.cjs');
let baselineSource;
const plugins = baseline ? [{ name: 'baseline-rsi-0.3.7', setup(builder) {
  const baselineDirectory = process.argv.find(value => value.startsWith('--baseline-dir='))?.slice(15);
  if (!baselineDirectory) throw new Error('BASELINE_DIRECTORY_REQUIRED');
  const checkpoint = { Backup: path.resolve(baselineDirectory) };
  const source = path.join(checkpoint.Backup, 'src/importers/rsi.ts');
  const version = JSON.parse(fs.readFileSync(path.join(checkpoint.Backup, 'package.json'), 'utf8').replace(/^\uFEFF/, '')).version;
  if (version !== '0.3.7') throw new Error('BASELINE_CHECKPOINT_INVALID');
  baselineSource = { version, sourceSha256: createHash('sha256').update(fs.readFileSync(source)).digest('hex') };
  builder.onResolve({ filter: /\/src\/importers\/rsi$/ }, () => ({ path: source }));
} }] : [];
await build({ entryPoints: ['tests/window-lifecycle-harness.ts'], outfile: harness, bundle: true, platform: 'node', format: 'cjs',
  target: 'node24', external: ['electron'], nodePaths: [path.resolve('node_modules')], plugins });
const env = { ...process.env, TEMP: path.resolve('work/temp/tooling'), TMP: path.resolve('work/temp/tooling') };
delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
const child = spawn(require('electron'), [harness, '--test-root=' + folder, ...(baseline ? ['--baseline'] : []), '--disable-gpu'],
  { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
let stdout = '';
child.stdout.on('data', value => { stdout += value.toString(); });
let timedOut = false;
const timer = setTimeout(() => {
  timedOut = true;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  else child.kill('SIGKILL');
}, 75000);
child.once('error', () => { clearTimeout(timer); console.error('FAIL: ELECTRON_START_FAILED'); process.exitCode = 1; });
child.once('exit', code => {
  clearTimeout(timer);
  for (const line of stdout.split(/\r?\n/)) if (/^PASS: [A-Z0-9_]+$/.test(line)) console.log(line);
  const reportPath = path.join(folder, 'results.json');
  if (timedOut || !fs.existsSync(reportPath)) {
    console.error('FAIL: ' + (timedOut ? 'HARNESS_WATCHDOG_TIMEOUT' : 'HARNESS_REPORT_MISSING'));
    process.exitCode = 1; return;
  }
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  if (baseline) {
    const expectedFailure = code === 1 && report.status === 'FAIL' && report.expectedBaselineFailure === true &&
      report.phase === 'WAIT_OVER_FIVE_MINUTES_AND_SUCCESS_STAYS_OPEN' && report.failureCode === 'WAIT_OVER_FIVE_MINUTES_CONNECTION_TIMEOUT' &&
      report.evidence?.functionalError === 'CONNECTION_TIMEOUT' && report.evidence?.waitingPhaseReached === true &&
      report.evidence?.diagnosticTimeout === true && report.evidence?.simulatedClockAdvanceMs === 360000 && report.evidence?.navigationRequests === 1;
    fs.writeFileSync('work/temp/window-lifecycle-baseline-0.3.7.json', JSON.stringify({ expectedFailure, baselineSource, report: reportPath,
      failureCode: report.failureCode ?? 'EXPECTED_BASELINE_REGRESSION_NOT_REPRODUCED' }, null, 2));
    console.log((expectedFailure ? 'EXPECTED_BASELINE_FAIL: ' : 'FAIL: ') + (report.failureCode ?? 'EXPECTED_BASELINE_REGRESSION_NOT_REPRODUCED'));
    process.exitCode = expectedFailure ? 0 : 1;
  } else {
    process.exitCode = code === 0 && report.status === 'PASS' ? 0 : 1;
    if (process.exitCode) console.error('FAIL: ' + (report.failureCode ?? 'HARNESS_FAILED'));
  }
  console.log('REPORT: ' + reportPath);
});
