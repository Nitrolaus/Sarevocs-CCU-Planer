import { build } from 'esbuild';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url), root = process.cwd(), baseline = process.argv.includes('--baseline'), ccuBaseline = process.argv.includes('--ccu-baseline');
const largeHangar = process.argv.includes('--large-hangar');
if (baseline && ccuBaseline) throw new Error('BASELINE_MODES_EXCLUSIVE');
const folder = path.resolve('work/temp/hangar-reader', randomUUID());
fs.mkdirSync(folder, { recursive: true }); fs.mkdirSync(path.resolve('work/temp/tooling'), { recursive: true });
let baselineSource;
const plugins = baseline || ccuBaseline ? [{ name: 'baseline-rsi', setup(builder) {
  const baselineDirectory = process.argv.find(value => value.startsWith('--baseline-dir='))?.slice(15);
  if (!baselineDirectory) throw new Error('BASELINE_DIRECTORY_REQUIRED');
  const checkpoint = { Backup: path.resolve(baselineDirectory) };
  const source = path.join(checkpoint.Backup, 'src/importers/rsi.ts');
  const version = JSON.parse(fs.readFileSync(path.join(checkpoint.Backup, 'package.json'), 'utf8').replace(/^\uFEFF/, '')).version;
  if (version !== (ccuBaseline ? '0.3.9' : '0.3.8')) throw new Error('BASELINE_CHECKPOINT_INVALID');
  baselineSource = { version, sourceSha256: createHash('sha256').update(fs.readFileSync(source)).digest('hex'),
    ...(ccuBaseline ? { readerSha256: createHash('sha256').update(fs.readFileSync(path.join(checkpoint.Backup, 'src/importers/rsi-page.ts'))).digest('hex'),
      parserSha256: createHash('sha256').update(fs.readFileSync(path.join(checkpoint.Backup, 'src/importers/files.ts'))).digest('hex') } : {}) };
  builder.onResolve({ filter: /\/src\/importers\/rsi$/ }, () => ({ path: source }));
} }] : [];
const harness = path.join(folder, 'harness.cjs');
await build({ entryPoints: ['tests/hangar-reader-harness.ts'], outfile: harness, bundle: true, platform: 'node', format: 'cjs', target: 'node24',
  external: ['electron'], nodePaths: [path.resolve('node_modules')], plugins });
const env = { ...process.env, TEMP: path.resolve('work/temp/tooling'), TMP: path.resolve('work/temp/tooling') };
delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
const child = spawn(require('electron'), [harness, '--test-root=' + folder, ...(baseline ? ['--baseline'] : []), ...(ccuBaseline ? ['--ccu-baseline'] : []), ...(largeHangar ? ['--large-hangar'] : []), '--disable-gpu'],
  { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
let stdout = '', timedOut = false;
child.stdout.on('data', bytes => { stdout += bytes.toString(); });
const timer = setTimeout(() => {
  timedOut = true;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  else child.kill('SIGKILL');
}, largeHangar ? 180000 : 75000);
child.once('error', () => { clearTimeout(timer); console.error('FAIL: ELECTRON_START_FAILED'); process.exitCode = 1; });
child.once('exit', code => {
  clearTimeout(timer);
  for (const line of stdout.split(/\r?\n/)) if (/^PASS: [A-Z0-9_]+$/.test(line)) console.log(line);
  const reportPath = path.join(folder, 'results.json');
  if (timedOut || !fs.existsSync(reportPath)) {
    console.error('FAIL: ' + (timedOut ? 'HARNESS_WATCHDOG_TIMEOUT' : 'HARNESS_REPORT_MISSING')); process.exitCode = 1; return;
  }
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  if (baseline || ccuBaseline) {
    const expectedFailure = code === 1 && report.status === 'FAIL' && report.expectedBaselineFailure === true && (ccuBaseline ?
      report.phase === 'MULTICOMPONENT_CCU_BASELINE' && report.failureCode === 'MULTICOMPONENT_CCU_REJECTED_AS_UPGRADE_FIELDS' &&
      report.evidence?.validPledge === true && report.evidence?.sourceItems === 1 && report.evidence?.targetItems === 4 &&
      report.evidence?.rawReason === 'upgrade-fields' && report.evidence?.connectionStatus === 'upgrade-fields' :
      report.phase === 'READINESS_WITHOUT_LEGACY_HANDLE_10_AND_2' && report.failureCode === 'LEGACY_HANDLE_REQUIREMENT_RETURNS_WAITING' &&
      report.evidence?.legacyHandleAbsent === true && report.evidence?.legacyControlReady === true &&
      JSON.stringify(report.evidence?.validDirectPledgeCounts) === '[10,2]' && JSON.stringify(report.evidence?.connectionStatuses) === '["waiting","waiting"]');
    fs.writeFileSync(ccuBaseline ? 'work/temp/hangar-reader-ccu-baseline-0.3.9.json' : 'work/temp/hangar-reader-baseline-0.3.8.json', JSON.stringify({ expectedFailure, baselineSource, report: reportPath,
      failureCode: report.failureCode ?? 'EXPECTED_BASELINE_REGRESSION_NOT_REPRODUCED' }, null, 2));
    console.log((expectedFailure ? 'EXPECTED_BASELINE_FAIL: ' : 'FAIL: ') + (report.failureCode ?? 'EXPECTED_BASELINE_REGRESSION_NOT_REPRODUCED'));
    process.exitCode = expectedFailure ? 0 : 1;
  } else {
    process.exitCode = code === 0 && report.status === 'PASS' ? 0 : 1;
    if (process.exitCode) console.error('FAIL: ' + (report.failureCode ?? 'HARNESS_FAILED'));
  }
  console.log('REPORT: ' + reportPath);
});
