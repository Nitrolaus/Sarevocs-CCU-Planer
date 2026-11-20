import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
const require = createRequire(import.meta.url), baseline = process.argv.includes('--baseline');
const folder = path.resolve('work/temp/hangar-transition', randomUUID()); fs.mkdirSync(folder, { recursive: true });
const harness = path.join(folder, 'harness.cjs');
const plugins = baseline ? [{ name: 'baseline-login', setup(b) {
  const baselineDirectory = process.argv.find(value => value.startsWith('--baseline-dir='))?.slice(15);
  if (!baselineDirectory) throw new Error('BASELINE_DIRECTORY_REQUIRED');
  const checkpoint = { Backup: path.resolve(baselineDirectory) };
  b.onResolve({ filter: /src\/importers\/rsi$/ }, () => ({ path: path.join(checkpoint.Backup, 'src/importers/rsi.ts') }));
} }] : [];
await build({ entryPoints: ['tests/hangar-transition-harness.ts'], outfile: harness, bundle: true, platform: 'node', format: 'cjs', target: 'node24', external: ['electron'], nodePaths: [path.resolve('node_modules')], plugins });
const env = { ...process.env, TEMP: path.resolve('work/temp/tooling'), TMP: path.resolve('work/temp/tooling') };
delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
const child = spawn(require('electron'), [harness, '--test-root=' + folder, '--disable-gpu'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr);
const timer = setTimeout(() => { child.kill(); process.exitCode = 1; }, 45000);
child.once('exit', code => {
  clearTimeout(timer); process.exitCode = code ?? 1;
  if (baseline && fs.existsSync(path.join(folder, 'results.json'))) {
    const report = JSON.parse(fs.readFileSync(path.join(folder, 'results.json'), 'utf8'));
    if (report.status === 'FAIL' && report.error.includes('Post-login URL must hand off') && report.error.includes('RSI-Verbindung nicht möglich')) {
      fs.writeFileSync('work/temp/hangar-transition-baseline-0.3.6.json', JSON.stringify({ expectedFailure: true, report: path.join(folder, 'results.json'), baselineVersion: '0.3.5', error: report.error }, null, 2));
    }
  }
});
