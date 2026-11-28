import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
const require = createRequire(import.meta.url), root = process.cwd();
const folder = path.resolve('work/temp/session-roundtrip', randomUUID()); fs.mkdirSync(folder, { recursive: true });
const harness = path.join(folder, 'harness.cjs');
await build({ entryPoints: ['tests/session-roundtrip-harness.ts'], outfile: harness, bundle: true, platform: 'node', format: 'cjs', target: 'node24', external: ['electron'] });
const env = { ...process.env, TEMP: path.resolve('work/temp/tooling'), TMP: path.resolve('work/temp/tooling') };
delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
async function run(testCase, phase, runtime = 'runtime', allowDecryptFailure = false) {
  const data = path.join(folder, testCase); fs.mkdirSync(data, { recursive: true });
  await new Promise((resolve, reject) => {
    const child = spawn(require('electron'), [harness, '--test-root=' + data, '--phase=' + phase, '--case=' + testCase, '--runtime=' + runtime, '--disable-gpu', '--disable-background-networking'], { cwd: root, env, windowsHide: true, stdio: 'ignore' });
    const timer = setTimeout(() => { child.kill(); reject(new Error('Synthetic session roundtrip timed out')); }, 20000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); code === 0 || allowDecryptFailure ? resolve() : reject(new Error('Synthetic session process failed: ' + code)); });
  });
  return JSON.parse(fs.readFileSync(path.join(data, phase + '.json'), 'utf8'));
}
const results = [];
try {
  if (process.argv.includes('--key-scope-only')) {
    const write = await run('key-scope', 'write');
    const read = await run('key-scope', 'read', 'other-runtime', true);
    fs.writeFileSync(path.join(folder, 'results.json'), JSON.stringify({ data: 'synthetic-only', experiment: 'different userData directory, unchanged sessionData directory', write, read }, null, 2));
    console.log('OTHER-PROFILE:', read.status); console.log('REPORT:', path.join(folder, 'results.json'));
    process.exit(0);
  }
  for (const testCase of ['secure-only', 'nonsecure-auth', 'duplicate-handle']) {
    const write = await run(testCase, 'write');
    const read = await run(testCase, 'read');
    results.push({ case: testCase, write, read });
    console.log(`${read.status}: ${testCase}: stored ${write.storedCount}/3, restored ${read.beforeClose.count}/3, auth present ${read.beforeClose.authPresent}`);
  }
  const status = results.every(r => r.read.status === 'PASS') ? 'PASS' : 'FAIL';
  fs.writeFileSync(path.join(folder, 'results.json'), JSON.stringify({ status, data: 'synthetic-only', results }, null, 2));
  console.log('REPORT:', path.join(folder, 'results.json')); process.exitCode = status === 'PASS' ? 0 : 1;
} catch (error) {
  fs.writeFileSync(path.join(folder, 'results.json'), JSON.stringify({ status: 'ERROR', data: 'synthetic-only', results, error: error.message }, null, 2));
  console.error(error.message); console.log('REPORT:', path.join(folder, 'results.json')); process.exitCode = 1;
}
