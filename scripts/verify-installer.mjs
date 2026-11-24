import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { listPackage, extractFile } from '@electron/asar';
import { applicationEntries } from './packaged-app-files.mjs';
const root = process.cwd(), pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const selectable = JSON.parse(fs.readFileSync('work/temp/selectable-installer-artifacts.json', 'utf8'));
const innerSetup = path.resolve(selectable.innerSetup);
const bootstrapper = JSON.parse(fs.readFileSync('work/temp/bootstrapper-artifacts.json', 'utf8'));
assert.equal(bootstrapper.version, pkg.version);
assert.equal(path.resolve(bootstrapper.innerSetup), innerSetup);
const setup = path.resolve(bootstrapper.setup);
const stage = path.resolve('work/temp/installer-verification', randomUUID()); fs.mkdirSync(stage, { recursive: true });
const tool = path.resolve('node_modules/electron-winstaller/vendor/7z.exe');
const env = { ...process.env, TEMP: path.resolve('work/temp/tooling'), TMP: path.resolve('work/temp/tooling') };
delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
function seven(args) { return execFileSync(tool, args, { env, windowsHide: true, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 }); }
const digest = (file, alg = 'sha256') => createHash(alg).update(fs.readFileSync(file)).digest('hex');
const results = [];
try {
  assert.equal(digest(innerSetup), bootstrapper.innerSHA);
  const payloadSetup = path.join(stage, 'inner-setup.exe');
  const extraction = spawnSync(setup, ['--extract-payload=' + payloadSetup], { env, windowsHide: true, timeout: 20000, stdio: 'ignore' });
  assert.equal(extraction.status, 0, 'Native bootstrapper extraction failed');
  assert.equal(digest(payloadSetup), bootstrapper.innerSHA, 'Embedded setup differs from original NSIS artifact');
  assert.equal(bootstrapper.locationSourceSHA, digest('installer/InstallLocation.cs'));
  assert.equal(bootstrapper.windowSourceSHA, digest('installer/SetupWindow.cs'));
  assert.equal(bootstrapper.displaySourceSHA, digest('installer/DisplaySetup.cs'));
  assert.equal(bootstrapper.selectableSourceSHA, digest('installer/SelectableSetup.cs'));
  assert.equal(bootstrapper.transactionSourceSHA, digest('installer/InstallTransaction.cs'));
  assert.equal(bootstrapper.sourceSHA, digest('installer/SetupBootstrapper.cs'));
  results.push('Nativer Installerstarter enthaelt die SHA-256-gepruefte Nutzlast und aktuelle Ordnerwahl; Extraktion installiert nichts.');
  seven(['t', payloadSetup]); seven(['x', '-y', '-o' + path.join(stage, 'setup-payload'), payloadSetup]);
  const app = path.join(stage, 'setup-payload');
  const exe = path.join(app, 'Sarevocs-CCU-Planer.exe'); assert.ok(fs.existsSync(exe));
  const manifest = JSON.parse(fs.readFileSync(path.join(app, 'install-files.json'), 'utf8'));
  assert.equal(manifest.product, 'SarevocsCCUPlaner'); assert.equal(manifest.version, pkg.version);
  for (const entry of manifest.files) { assert.equal(digest(path.join(app, entry.file)), entry.sha256); assert.equal(digest(path.join(selectable.application, entry.file)), entry.sha256); }
  assert.equal(digest(path.join(app, 'SetupGuard.exe')), digest(selectable.guard));
  const script = fs.readFileSync(path.join(selectable.stage, 'installer.nsi'), 'utf8');
  assert.equal(digest(path.join(selectable.stage, 'installer.nsi')), selectable.nsiSHA);
  assert.match(script, /SetupGuard\.exe" --validate-stage/);
  assert.doesNotMatch(script, /^\s*WriteReg/m);
  const uninstallerInit = script.match(/Function un\.PrepareUninstall\r?\n([\s\S]+?)FunctionEnd/)[1];
  assert.match(uninstallerInit, /File \/oname=SetupGuard\.exe/);
  assert.doesNotMatch(uninstallerInit, /CopyFiles|\$INSTDIR\\SetupGuard\.exe/i);
  assert.doesNotMatch(script, /Function un\.onInit\b/);
  assert.match(script, /Section "Uninstall"\s+SetShellVarContext current\s+Call un\.PrepareUninstall\s+ReadRegStr/);
  assert.match(script, /--remove-shortcuts "\$INSTDIR"/);
  assert.doesNotMatch(script, /Delete "[^"\n]*\.lnk"/i);
  results.push('Jede Programmdatei aus der Setup-EXE stimmt bytegenau mit dem getesteten Paket ueberein.');
  const listing = seven(['l', '-slt', payloadSetup]);
  assert.equal(/^Path = .*([\\/](?:Anmeldung|LetzterStand)[\\/]|\.session\.enc$|inventory\.sqlite$)/im.test(listing), false);
  const asar = path.join(app, 'resources/app.asar');
  const appFiles = listPackage(asar);
  const helper = path.join(app, 'resources/app.asar.unpacked/build/hello-consent.exe');
  assert.equal(digest(helper), digest(path.resolve('build/hello-consent.exe')));
  assert.ok(extractFile(asar, path.normalize('build/main.cjs')).includes(digest(helper)), 'Windows Hello helper digest missing from main app');
  const aclHelper = path.join(app, 'resources/app.asar.unpacked/build/session-acl.exe');
  assert.equal(digest(aclHelper), digest(path.resolve('build/session-acl.exe')));
  assert.ok(extractFile(asar, path.normalize('build/main.cjs')).includes(digest(aclHelper)), 'Session ACL helper digest missing from main app');
  results.push('Nativer Windows-Hello-Helfer stimmt mit der im Programm hinterlegten SHA-256-Prüfsumme überein.');
  assert.equal(appFiles.some(file => /(?:^|[\\/])(?:Anmeldung|LetzterStand|FluechtigeSitzungen|Laufzeit|Diagnose)(?:[\\/]|$)|\.session\.enc$|(?:^|[\\/])(?:inventory\.sqlite|rsi-verbindung\.json|Local State)$/.test(file)), false);
  for (const file of ['build/main.cjs', 'build/preload.cjs', 'build/bootstrap.cjs', 'build/renderer/app.js', 'build/renderer/planner-worker.js', 'build/renderer/advisor-worker.js']) {
    const bundled = extractFile(asar, path.normalize(file));
    assert.equal(createHash('sha256').update(bundled).digest('hex'), digest(path.resolve(file)), 'Installer bundle differs from current build: ' + file);
  }
  results.push('Installerpaket entpackbar; keine Inventardatenbank oder gespeicherten Anmeldungen im Paket.');
  const emitted = appFiles.map(file => file.replaceAll('\\', '/').replace(/^\//, ''))
    .filter(file => file !== 'package.json' && file !== 'node_modules' && !file.startsWith('node_modules/'));
  assert.deepEqual(emitted.sort(), [...applicationEntries].sort());
  for (const file of emitted.filter(file => /\.(?:cjs|css|html|js|md|txt|json)$/.test(file))) {
    const content = extractFile(asar, path.normalize(file)).toString('utf8');
    assert.doesNotMatch(content, /(?:support\.open|\/artwork\/)/i, file);
    const koFiLinks = content.match(/https?:\/\/(?:www\.)?ko-fi\.com\/[^\s"'<>]+/gi) ?? [];
    assert.deepEqual(koFiLinks, file === 'build/main.cjs' ? ['https://ko-fi.com/sarevoc'] : [], file);
    const payPalLinks = content.match(/https?:\/\/(?:www\.)?paypal\.com\/[^\s"'<>]+/gi) ?? [];
    assert.equal(payPalLinks.length, Number(file === 'build/main.cjs'), file);
    if (payPalLinks.length) assert.ok(/^https:\/\/www\.paypal\.com\/ncp\/payment\/[A-Z0-9]{10,20}$/.test(payPalLinks[0]), file);
  }
  assert.deepEqual(extractFile(asar, path.normalize('build/renderer/kofi-logo.png')), fs.readFileSync('assets/kofi-logo.png'));
  assert.deepEqual(extractFile(asar, path.normalize('build/demo-inventory.json')), fs.readFileSync('tests/fixtures/demo-inventory.json'));
  assert.deepEqual(extractFile(asar, path.normalize('build/LICENSE')), fs.readFileSync('LICENSE'));
  results.push('Die Alpha-Nutzlast enthält ausschließlich erwartete Anwendungsdateien und synthetische Demodaten. Ko-fi und PayPal sind feste Ziele im Hauptprozess. Keine CAD-Bilder.');
  const eventData = path.join(stage, 'event-must-not-create-data');
  const event = spawnSync(exe, ['--squirrel-obsolete', '--data-dir=' + eventData], { env, windowsHide: true, timeout: 15000, stdio: 'ignore' });
  assert.equal(event.status, 0); assert.equal(fs.existsSync(eventData), false);
  results.push('Verpackter Installerereignis-Start beendet sich vor Datenanlage und Appfenster.');
  const smoke = spawnSync(process.execPath, ['scripts/package-smoke.mjs'], { env: { ...env, CCU_TEST_EXE: exe }, windowsHide: true, encoding: 'utf8', timeout: 45000, maxBuffer: 1024 * 1024 });
  if (smoke.status !== 0) throw new Error('Starttest des aus der Setup-EXE entpackten Programms fehlgeschlagen: ' + smoke.stderr);
  console.log(smoke.stdout.trim()); results.push('Tatsaechliche Installer-Nutzlast mit SQLite-Import, Neustart und sicheren Fuses gestartet.');
  const report = { status: 'PASS', setup, setupSha256: digest(setup), version: pkg.version, installed: false, extractedExe: exe, extractedAsar: asar, results };
  fs.writeFileSync(path.join(stage, 'results.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync('work/temp/verified-installer.json', JSON.stringify({ ...report, report: path.join(stage, 'results.json') }, null, 2));
  console.log('PASS:', results.join('\nPASS: ')); console.log('REPORT:', path.join(stage, 'results.json'));
} catch (error) { fs.writeFileSync(path.join(stage, 'results.json'), JSON.stringify({ status: 'FAIL', results, error: error.message }, null, 2)); throw error; }
