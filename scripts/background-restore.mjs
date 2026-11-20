import { build } from 'esbuild';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
const require = createRequire(import.meta.url), root = process.cwd();
const folder = path.resolve('work/temp/background-restore', randomUUID()); fs.mkdirSync(folder, { recursive: true });
const harness = path.join(folder, 'harness.cjs');
// Preserve real native windows/Chromium, while forcing all test windows hidden.
// Record the options and display calls requested by the unchanged RSI source.
await build({ entryPoints: ['tests/background-restore-harness.ts'], outfile: harness, bundle: true,
  platform: 'node', format: 'cjs', target: 'node24', external: ['electron'], plugins: [{ name: 'hidden-native-test-windows', setup(builder) {
    builder.onResolve({ filter: /^electron$/ }, args => args.importer.replaceAll('\\', '/').endsWith('/src/importers/rsi.ts') ? { path: 'native-window-fixture', namespace: 'test' } : undefined);
    builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: `
      const native = require('electron');
      export const session = native.session;
      export class BrowserWindow extends native.BrowserWindow {
        constructor(options) { super({ ...options, show: false }); globalThis.ccuRestoreNative.created.push({ show: options.show, win: this }); }
        show() { globalThis.ccuRestoreNative.actions.push({ id: this.id, action: 'show' }); }
        focus() { globalThis.ccuRestoreNative.actions.push({ id: this.id, action: 'focus' }); }
        restore() { globalThis.ccuRestoreNative.actions.push({ id: this.id, action: 'restore' }); }
        hide() { globalThis.ccuRestoreNative.actions.push({ id: this.id, action: 'hide' }); return super.hide(); }
      }`, resolveDir: root }));
  } }] });
const env = { ...process.env, TEMP: path.resolve('work/temp/tooling'), TMP: path.resolve('work/temp/tooling') };
delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
const child = spawn(require('electron'), [harness, '--test-root=' + folder, '--data-dir=' + path.join(folder, 'data'), '--disable-gpu', '--disable-background-networking'], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
let output = '';
child.stdout.on('data', data => { output += data; });
const timeout = setTimeout(() => {
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  else child.kill();
}, 75000);
child.on('error', error => { clearTimeout(timeout); console.error(error.message); process.exitCode = 1; });
child.on('exit', code => {
  clearTimeout(timeout);
  for (const line of output.split(/\r?\n/)) if (/^PASS: [A-Z0-9_]+$/.test(line)) console.log(line);
  const report = path.join(folder, 'results.json');
  if (!fs.existsSync(report)) { console.error('FAIL: BACKGROUND_REPORT_MISSING'); process.exitCode = 1; }
  else { const result = JSON.parse(fs.readFileSync(report, 'utf8')); process.exitCode = code === 0 && result.status === 'PASS' ? 0 : 1; if (process.exitCode) console.error('FAIL: ' + result.error); }
  console.log('REPORT:', report);
});
