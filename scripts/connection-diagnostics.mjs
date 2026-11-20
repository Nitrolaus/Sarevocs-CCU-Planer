import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
const require = createRequire(import.meta.url);
const folder = path.resolve('work/temp/connection-diagnostics', randomUUID()); fs.mkdirSync(folder, { recursive: true });
const harness = path.join(folder, 'harness.cjs');
await build({ entryPoints: ['tests/connection-diagnostics-harness.ts'], outfile: harness, bundle: true, platform: 'node', format: 'cjs', target: 'node24', external: ['electron'] });
const env = { ...process.env, TEMP: path.resolve('work/temp/tooling'), TMP: path.resolve('work/temp/tooling') };
delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
const child = spawn(require('electron'), [harness, '--test-root=' + folder, '--disable-gpu'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.pipe(process.stdout);
let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk; });
const timer = setTimeout(() => { child.kill(); process.exitCode = 1; }, 40000);
child.once('exit', code => {
  clearTimeout(timer);
  if (stderr.includes('SYNTHETIC_PRIVATE_VALUE_DO_NOT_LOG')) {
    console.error('FAIL: Browser warning leaked synthetic URL data.'); process.exitCode = 1;
  } else {
    process.stderr.write(stderr); process.exitCode = code ?? 1;
    if (code === 0) {
      const resultFile = path.join(folder, 'results.json');
      const report = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
      report.results.push('Electron navigation warning contains no synthetic private URL data.');
      fs.writeFileSync(resultFile, JSON.stringify(report, null, 2));
      console.log('PASS: Electron navigation warning contains no synthetic private URL data.');
    }
  }
});
