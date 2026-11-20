import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const baselineArg = process.argv.find(x => x.startsWith('--baseline-dir='))?.slice(15);
const baseline = baselineArg !== undefined;
const source = baseline ? path.join(path.resolve(baselineArg), 'src/importers/rsi-page.ts') : path.resolve('src/importers/rsi-page.ts');
const sourceVersion = JSON.parse(fs.readFileSync(baseline ? path.join(path.resolve(baselineArg), 'package.json') : 'package.json', 'utf8').replace(/^\uFEFF/, '')).version;
if (baseline && sourceVersion !== '0.3.10') throw new Error('BASELINE_VERSION_MISMATCH');
const root = path.resolve('work/temp/pagination-regression', randomUUID());
fs.mkdirSync(root, { recursive: true });
const harness = path.join(root, 'harness.cjs');
await build({ entryPoints: ['tests/pagination-regression-harness.ts'], outfile: harness, bundle: true, platform: 'node', format: 'cjs', target: 'node24', external: ['electron'],
  plugins: baseline ? [{ name: 'baseline-reader', setup(builder) { builder.onResolve({ filter: /\/src\/importers\/rsi-page$/ }, () => ({ path: source })); } }] : [] });
const require = createRequire(import.meta.url);
const env = { ...process.env, TEMP: root, TMP: root };
delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
const child = spawn(require('electron'), [harness, '--test-root=' + root, ...(baseline ? ['--baseline'] : []), '--disable-gpu'],
  { cwd: process.cwd(), env, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
child.stdout.on('data', b => { for (const line of b.toString().split(/\r?\n/)) if (/^PASS: [A-Z_]+$/.test(line)) console.log(line); });
child.once('error', () => { console.error('FAIL: ELECTRON_START_FAILED'); process.exitCode = 1; });
child.once('exit', code => {
  const file = path.join(root, 'results.json');
  if (!fs.existsSync(file)) { console.error('FAIL: REPORT_MISSING'); process.exitCode = 1; return; }
  const report = JSON.parse(fs.readFileSync(file, 'utf8'));
  Object.assign(report, { sourceVersion, sourceSha256: createHash('sha256').update(fs.readFileSync(source)).digest('hex') });
  fs.writeFileSync(file, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ exitCode: code, report: file, status: report.status, phase: report.phase, fixedFailure: report.fixedFailure }));
  process.exitCode = code === 0 && report.status === 'PASS' ? 0 : 1;
});
