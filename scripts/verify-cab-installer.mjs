import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { extractFile } from '@electron/asar';

const [setupArg, logArg, ...extra] = process.argv.slice(2);
if (!setupArg || !logArg || extra.length) {
  throw new Error('Usage: node scripts/verify-cab-installer.mjs <setup.exe> <build-log.json>');
}
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const setup = path.resolve(setupArg);
const log = JSON.parse(fs.readFileSync(logArg, 'utf8'));
assert.equal(log.kind, 'cab', 'Expected CAB build metadata');
assert.equal(hash(setup), log.setupSHA, 'Executable differs from the explicit build log');
assert.equal(log.version, JSON.parse(fs.readFileSync('package.json', 'utf8')).version);

const output = path.resolve('work/temp/cab-verification', randomUUID());
fs.mkdirSync(output, { recursive: true });
const env = { ...process.env, TEMP: output, TMP: output };
const run = (command, args) => execFileSync(command, args, { env, windowsHide: true, timeout: 120_000, encoding: 'utf8' });
run('pwsh', ['-NoProfile', '-File', path.resolve('scripts/read-cab-resources.ps1'), '-Setup', setup, '-Output', output]);
assert.equal(hash(setup), log.setupSHA, 'Executable changed during verification');
const cabinet = path.join(output, 'payload.cab');
assert.equal(hash(cabinet), log.innerSHA, 'Embedded CAB differs from the compiled CAB');

const manifest = new Map();
for (const line of fs.readFileSync(path.join(output, 'product-files.txt'), 'utf8').split(/\r?\n/)) {
  const fields = line.match(/^([-A-Za-z0-9._/]+)\t([0-9]+)\t([a-f0-9]{64})$/);
  assert.ok(fields, 'Invalid embedded manifest row');
  const [, file, length, sha256] = fields;
  assert.ok(file.split('/').every(part => part && !part.endsWith('.') &&
    !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)), 'Invalid CAB file path');
  const key = file.toLowerCase();
  assert.ok(!manifest.has(key), 'Duplicate embedded manifest path');
  const size = Number(length);
  assert.ok(Number.isSafeInteger(size) && size <= 1024 ** 3, 'Invalid manifest size');
  manifest.set(key, { file, size, sha256 });
}
assert.ok([...manifest.values()].reduce((total, entry) => total + entry.size, 0) <= 1024 ** 3, 'CAB content is too large');
for (const required of ['setupguard.exe', 'uninstall.exe', 'install-files.json', 'install-product.txt', 'resources/app.asar']) {
  assert.ok(manifest.has(required), 'Missing CAB file: ' + required);
}

const require = createRequire(import.meta.url);
const seven = process.env.CCU_7ZIP || path.join(path.dirname(require.resolve('electron-winstaller/package.json')), 'vendor', '7z.exe');
const listed = new Map();
const listing = run(seven, ['l', '-slt', '-ba', '--', cabinet]);
for (const block of listing.trim().split(/(?:\r?\n){2,}/)) {
  const file = block.match(/^Path = (.+)\r?$/m)?.[1]?.replaceAll('\\', '/');
  const size = block.match(/^Size = (\d+)\r?$/m)?.[1];
  assert.ok(file && size, 'Invalid CAB file listing');
  const key = file.toLowerCase();
  const expected = manifest.get(key);
  assert.ok(expected && expected.file === file && expected.size === Number(size) && !listed.has(key), 'Unexpected CAB entry: ' + file);
  listed.set(key, file);
}
assert.equal(listed.size, manifest.size, 'Missing CAB entries');
const extracted = path.join(output, 'payload');
run(seven, ['x', '-y', '-o' + extracted, '--', cabinet]);
for (const { file, size, sha256 } of manifest.values()) {
  const extractedFile = path.join(extracted, file);
  const stat = fs.lstatSync(extractedFile);
  assert.ok(stat.isFile() && stat.size === size, 'Invalid extracted file: ' + file);
  assert.equal(hash(extractedFile), sha256, 'Extracted file differs: ' + file);
}
const asar = path.join(extracted, 'resources', 'app.asar');
assert.equal(JSON.parse(extractFile(asar, 'package.json').toString()).version, log.version);
const aclHelper = path.join(extracted, 'resources', 'app.asar.unpacked', 'build', 'session-acl.exe');
assert.ok(manifest.has('resources/app.asar.unpacked/build/session-acl.exe'), 'Missing packaged session ACL helper');
assert.equal(hash(aclHelper), hash('build/session-acl.exe'));
assert.ok(extractFile(asar, 'build/main.cjs').includes(hash(aclHelper)), 'Session ACL helper digest missing from main app');
const report = { status: 'PASS', kind: 'cab', version: log.version, setupSha256: log.setupSHA, cabinetSha256: log.innerSHA,
  verifiedFiles: manifest.size, installerExecuted: false };
fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, report: path.join(output, 'results.json') }));
