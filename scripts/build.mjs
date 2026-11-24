import { build } from 'esbuild';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { applicationEntries } from './packaged-app-files.mjs';
import { buildWindowsHelpers } from './build-windows-hello.mjs';
fs.mkdirSync('build/renderer/fonts', { recursive: true });
fs.mkdirSync('work/temp', { recursive: true });
buildWindowsHelpers();
const helloSha256 = createHash('sha256').update(fs.readFileSync('build/hello-consent.exe')).digest('hex');
const sessionAclSha256 = createHash('sha256').update(fs.readFileSync('build/session-acl.exe')).digest('hex');
await Promise.all([
  build({ entryPoints: ['src/ui/planner-worker.ts'], outfile: 'build/renderer/planner-worker.js', bundle: true, platform: 'browser', format: 'esm', target: 'chrome156', minify: true }),
  build({ entryPoints: ['src/ui/advisor-worker.ts'], outfile: 'build/renderer/advisor-worker.js', bundle: true, platform: 'browser', format: 'esm', target: 'chrome156', minify: true }),
  build({ entryPoints: ['src/bootstrap.ts'], outfile: 'build/bootstrap.cjs', bundle: true, platform: 'node', format: 'cjs', target: 'node24', external: ['electron', './main.cjs'] }),
  build({ entryPoints: ['src/main.ts'], outfile: 'build/main.cjs', bundle: true, platform: 'node', format: 'cjs', target: 'node24', external: ['electron', 'sql.js','exceljs'],
    define: { CCU_HELLO_SHA256: JSON.stringify(helloSha256), CCU_SESSION_ACL_SHA256: JSON.stringify(sessionAclSha256) } }),
  build({ entryPoints: ['src/preload.ts'], outfile: 'build/preload.cjs', bundle: true, platform: 'node', format: 'cjs', target: 'node24', external: ['electron'] }),
  build({ entryPoints: ['src/ui/App.tsx'], outfile: 'build/renderer/app.js', bundle: true, platform: 'browser', target: 'chrome156', minify: true, define: { 'process.env.NODE_ENV': '"production"' } }),
]);
for (const [from, to] of [ ['src/ui/index.html', 'build/renderer/index.html'],
  ['assets/app.png', 'build/renderer/app.png'], ['assets/app.ico', 'build/app.ico'], ['assets/tray.ico', 'build/tray.ico'],
  ['assets/kofi-logo.png', 'build/renderer/kofi-logo.png'],
  ['assets/brand.css', 'build/renderer/brand.css'], ['assets/fonts/Orbitron.ttf', 'build/renderer/fonts/Orbitron.ttf'], ['assets/fonts/OFL.txt', 'build/renderer/fonts/OFL.txt'],
  ['node_modules/sql.js/dist/sql-wasm.wasm', 'build/sql-wasm.wasm'], ['tests/fixtures/demo-inventory.json', 'build/demo-inventory.json'] ]) fs.copyFileSync(from, to);
for (const source of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'docs/public/NUTZUNGSBEDINGUNGEN.txt', 'docs/public/DATENSCHUTZ.md']) {
  fs.copyFileSync(source, 'build/' + source.split('/').at(-1));
}
const built = ['build', ...fs.readdirSync('build', { recursive: true }).map(file => 'build/' + file.replaceAll('\\', '/'))];
assert.deepEqual(built.sort(), [...applicationEntries].sort(), 'Build-Verzeichnis enthält unerwartete Dateien.');
console.log('Build: main, sandboxed preload, lokale React-Oberfläche, SQLite-WASM und Windows-Hello-Helfer.');
