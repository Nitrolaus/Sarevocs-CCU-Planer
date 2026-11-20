import { build } from 'esbuild';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
const require = createRequire(import.meta.url), root = process.cwd();
const legacyBaseline = process.argv.includes('--legacy-baseline');
const readerSource = fs.readFileSync('src/importers/upgrade-history.ts', 'utf8');
const readerSourceSha256 = createHash('sha256').update(readerSource).digest('hex');
const transportSha256 = createHash('sha256').update(readerSource.slice(readerSource.indexOf('type Job ='))).digest('hex');
const folder = path.resolve('work/temp/history-reader', randomUUID()); fs.mkdirSync(folder, { recursive: true });
fs.mkdirSync(path.resolve('work/temp/tooling'), { recursive: true });
const harness = path.join(folder, 'harness.cjs');
await build({ entryPoints: ['tests/history-reader-harness.ts'], outfile: harness, bundle: true, platform: 'node', format: 'cjs',
  target: 'node24', external: ['electron'], plugins: [{ name: 'history-native-observer', setup(builder) {
    builder.onResolve({ filter: /^electron$/ }, args => args.importer.replaceAll('\\', '/').endsWith('/src/importers/upgrade-history.ts') ? { path: 'history-electron', namespace: 'test' } : undefined);
    builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: `
      const native = require('electron');
      export const session = { fromPartition(partition, options) {
        const isolated = native.session.fromPartition(partition, options);
        const fixture = globalThis.historyNative;
        fixture.sessions.push({ isolated, partition, options });
        if (partition.startsWith('upgrade-history-net-')) {
          const ready = fixture.prepare(isolated), fetch = isolated.fetch.bind(isolated);
          isolated.fetch = async (...args) => { await ready; try { const response=await fetch(...args); fixture.fetchStatus=response.status;
            fixture.responseFlags={ok:response.ok,redirected:response.redirected,urlMatches:response.url===args[0],urlEmpty:response.url==='',jsonType:/^application\\/json(?:;|$)/i.test(response.headers.get('content-type')||''),body:!!response.body};return response; }
            catch(error) { fixture.failureCode=String(error).match(/ERR_[A-Z_]+/)?.[0] || 'FETCH_ERROR'; throw error; } };
        }
        return isolated;
      } };
      export class BrowserWindow extends native.BrowserWindow {
        constructor(options) { super(options); globalThis.historyNative.windows.push({ win:this, options }); }
        show() { throw Error('HISTORY_UNEXPECTED_PRESENTATION'); }
        focus() { throw Error('HISTORY_UNEXPECTED_FOCUS'); }
        async loadURL(...args) { try { return await super.loadURL(...args); } catch(error) { globalThis.historyNative.failureCode=String(error).match(/ERR_[A-Z_]+/)?.[0] || 'PARSER_LOAD_ERROR'; throw error; } }
      }
    `, resolveDir: root }));
  } }] });
const env = { ...process.env, TEMP: path.resolve('work/temp/tooling'), TMP: path.resolve('work/temp/tooling') };
delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
const child = spawn(require('electron'), [harness, '--test-root=' + folder, ...(legacyBaseline ? ['--legacy-baseline'] : []), '--disable-gpu', '--disable-background-networking'],
  { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
let output = '';
child.stdout.on('data', bytes => { output += bytes.toString(); });
const timer = setTimeout(() => {
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  else child.kill();
}, 90000);
child.on('error', () => { clearTimeout(timer); process.exitCode = 1; console.error('FAIL: HISTORY_PROCESS'); });
child.on('exit', code => {
  clearTimeout(timer);
  for (const line of output.split(/\r?\n/)) if (/^PASS: [A-Z0-9_]+$/.test(line)) console.log(line);
  const file = path.join(folder, 'results.json');
  if (!fs.existsSync(file)) { console.error('FAIL: HISTORY_REPORT_MISSING'); process.exitCode = 1; }
  else { const report = JSON.parse(fs.readFileSync(file, 'utf8')); report.readerSourceSha256=readerSourceSha256; report.transportSha256=transportSha256;
    fs.writeFileSync(file,JSON.stringify(report,null,2));
    process.exitCode = code === 0 && report.status === (legacyBaseline ? 'BASELINE_REPRODUCED' : 'PASS') ? 0 : 1;
    if (!process.exitCode && legacyBaseline) console.log('BASELINE: LEGACY_UPGRADE_STEP_NOT_READ');
    if (process.exitCode) console.error('FAIL: ' + (report.phase || 'HISTORY_FAILED')); }
  console.log('REPORT:', file);
});
