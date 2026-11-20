import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { transformSync } from 'esbuild';
import { installerLockActive, type InstallerLockIo } from '../src/main/installer-lock';

const localAppData = 'C:\\Synthetic\\Local', installed = path.win32.join(localAppData, 'SarevocsCCUPlaner');
const exe = path.win32.join(installed, 'app-0.3.10', 'Sarevocs-CCU-Planer.exe');
const root = path.resolve('work/temp/installer-lock-tests', randomUUID());
const normal = () => ({ name: 'SarevocsCCUPlaner.install.lock', isFile: () => true, isSymbolicLink: () => false });
function fixture() {
  const calls: string[] = [];
  const io: InstallerLockIo = {
    directoryEntries: directory => { calls.push('directory:' + directory); return [normal()]; },
    openReadOnly: file => { calls.push('open:' + file); return 17; },
    close: fd => { calls.push('close:' + fd); },
  };
  return { calls, io, active: (file = exe) => installerLockActive(file, { localAppData, platform: 'win32', io }) };
}
const error = (code: string) => Object.assign(new Error('Synthetic lock error'), { code });

test('Ordnerwahl-Installation nutzt denselben stabilen Benutzermarker und bleibt bei aktiver Updatesperre geschlossen', () => {
  const { io, calls } = fixture();
  const custom = 'D:\\Meine Programme\\CCU Planer\\Sarevocs-CCU-Planer.exe';
  assert.equal(installerLockActive(custom, { localAppData, platform: 'win32', io, productMarker: folder => folder === path.win32.dirname(custom) }), false);
  assert.equal(calls[1], 'open:' + path.win32.join(localAppData, 'SarevocsCCUPlaner.install.lock'));
  io.openReadOnly = () => { throw error('EACCES'); };
  assert.equal(installerLockActive(custom, { localAppData, platform: 'win32', io, productMarker: () => true }), true);
  calls.length = 0;
  assert.equal(installerLockActive(custom, { localAppData, platform: 'win32', io, productMarker: () => false }), false);
  assert.deepEqual(calls, []);
});

test('Nur eigene installierte EXE im stabilen Root oder direkten app-semver-Ordner prüft den Marker', () => {
  for (const file of [exe, path.win32.join(installed, 'Sarevocs-CCU-Planer.exe'),
    path.win32.join(installed.toUpperCase(), 'APP-0.3.10-beta.1', 'SAREVOCS-CCU-PLANER.EXE')]) {
    const { active, calls } = fixture(); assert.equal(active(file), false);
    assert.equal(calls.length, 3); assert.ok(calls[1]!.endsWith('\\SarevocsCCUPlaner.install.lock')); assert.equal(calls[2], 'close:17');
  }
  for (const file of ['C:\\Codex\\portable\\Sarevocs-CCU-Planer.exe',
    path.win32.join(installed, 'app-0.3.10', 'electron.exe'),
    path.win32.join(installed, 'app-invalid', 'Sarevocs-CCU-Planer.exe'),
    path.win32.join(installed, 'app-0.3.10', 'nested', 'Sarevocs-CCU-Planer.exe'),
    path.win32.join(localAppData, 'AnotherProduct', 'app-0.3.10', 'Sarevocs-CCU-Planer.exe'),
    'Sarevocs-CCU-Planer.exe']) {
    const { active, calls } = fixture(); assert.equal(active(file), false); assert.deepEqual(calls, []);
  }
  const { io, calls } = fixture();
  assert.equal(installerLockActive(exe, { localAppData: '', platform: 'win32', io }), false);
  assert.equal(installerLockActive(exe, { localAppData, platform: 'linux', io }), false);
  assert.deepEqual(calls, []);
});

test('Kein Marker und ENOENT erlauben Start ohne Öffnen einer anderen Datei', () => {
  for (const entries of [[], [{ ...normal(), name: 'unrelated-file' }]]) {
    const { active, io, calls } = fixture(); io.directoryEntries = () => entries;
    assert.equal(active(), false); assert.deepEqual(calls, []);
  }
  for (const stage of ['directory', 'open'] as const) {
    const { active, io, calls } = fixture();
    if (stage === 'directory') io.directoryEntries = () => { throw error('ENOENT'); };
    else io.openReadOnly = () => { throw error('ENOENT'); };
    assert.equal(active(), false); assert.equal(calls.some(call => call.startsWith('close:')), false);
  }
});

test('Readable stale Marker wird nur read-only geöffnet und sofort geschlossen', () => {
  const { active, calls } = fixture(); assert.equal(active(), false);
  assert.deepEqual(calls, ['directory:' + localAppData, 'open:' + path.win32.join(localAppData, 'SarevocsCCUPlaner.install.lock'), 'close:17']);
});

test('Share-Verweigerung und unbekannte Probe-Fehler blockieren normalen Start', () => {
  for (const code of ['EACCES', 'EPERM', 'EBUSY', 'EIO']) {
    for (const stage of ['directory', 'open', 'close'] as const) {
      const { active, io } = fixture();
      if (stage === 'directory') io.directoryEntries = () => { throw error(code); };
      else if (stage === 'open') io.openReadOnly = () => { throw error(code); };
      else io.close = () => { throw error(code); };
      assert.equal(active(), true);
    }
  }
});

test('Reparse-/Symlink-Marker und fremder Dateityp werden fail-closed ohne open behandelt', () => {
  for (const entry of [{ ...normal(), isSymbolicLink: () => true }, { ...normal(), isFile: () => false }]) {
    const { active, io, calls } = fixture(); io.directoryEntries = () => [entry];
    assert.equal(active(), true); assert.deepEqual(calls, []);
  }
});

test('Echter ungesperrter Marker bleibt unverändert; fremde EXE berücksichtigt ihn nicht', () => {
  const local = path.join(root, randomUUID(), 'Local'), directory = path.join(local, 'SarevocsCCUPlaner');
  fs.mkdirSync(directory, { recursive: true });
  const marker = path.join(local, 'SarevocsCCUPlaner.install.lock'), bytes = Buffer.from('SYNTHETIC_UNUSED_MARKER_CONTENT');
  fs.writeFileSync(marker, bytes);
  assert.equal(installerLockActive(path.join(directory, 'app-0.3.10', 'Sarevocs-CCU-Planer.exe'), { localAppData: local }), false);
  assert.equal(installerLockActive(path.join(directory, 'app-0.3.10', 'electron.exe'), { localAppData: local }), false);
  assert.deepEqual(fs.readFileSync(marker), bytes);
});

test('Echter Windows-Junction-Marker wird vor jedem Öffnen fail-closed erkannt', { skip: process.platform !== 'win32' }, () => {
  const local = path.join(root, randomUUID(), 'Local'), directory = path.join(local, 'SarevocsCCUPlaner');
  const target = path.join(root, randomUUID(), 'synthetic-target');
  fs.mkdirSync(directory, { recursive: true }); fs.mkdirSync(target, { recursive: true });
  fs.symlinkSync(target, path.join(local, 'SarevocsCCUPlaner.install.lock'), 'junction');
  let opened = false;
  const io: InstallerLockIo = {
    directoryEntries: folder => fs.readdirSync(folder, { withFileTypes: true }),
    openReadOnly: () => { opened = true; throw new Error('Synthetic unexpected junction open'); }, close: () => {},
  };
  assert.equal(installerLockActive(path.join(directory, 'app-0.3.10', 'Sarevocs-CCU-Planer.exe'), { localAppData: local, io }), true);
  assert.equal(opened, false);
});

test('Echte Windows-Dateisperre FileShare.None blockiert bis zum Schließen ohne Markeränderung', { timeout: 12000, skip: process.platform !== 'win32' }, async () => {
  const local = path.join(root, randomUUID(), 'Local'), directory = path.join(local, 'SarevocsCCUPlaner');
  // FullInstall can replace the entire product root while this stable sibling remains locked.
  fs.mkdirSync(local, { recursive: true });
  const marker = path.join(local, 'SarevocsCCUPlaner.install.lock'); fs.writeFileSync(marker, 'SYNTHETIC_LOCK_MARKER');
  const bytes = fs.readFileSync(marker);
  const script = "$ErrorActionPreference='Stop'; $file=[IO.File]::Open($env:CCU_SYNTHETIC_LOCK,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None); try { [Console]::WriteLine('LOCK_READY'); [Console]::Out.Flush(); [Console]::ReadLine() | Out-Null } finally { $file.Dispose() }";
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'], env: { ...process.env, CCU_SYNTHETIC_LOCK: marker },
  });
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  const exited = new Promise<number | null>((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
  try {
    await new Promise<void>((resolve, reject) => {
      let text = '';
      watchdog = setTimeout(() => reject(new Error('SYNTHETIC_LOCK_START_TIMEOUT')), 7000);
      child.once('error', () => reject(new Error('SYNTHETIC_LOCK_START_FAILED')));
      child.once('exit', () => reject(new Error('SYNTHETIC_LOCK_CLOSED_BEFORE_READY')));
      child.stdout!.on('data', data => { text += data.toString(); if (text.includes('LOCK_READY')) resolve(); });
    });
    clearTimeout(watchdog);
    const executable = path.join(directory, 'app-0.3.10', 'Sarevocs-CCU-Planer.exe');
    assert.equal(installerLockActive(executable, { localAppData: local }), true);
    child.stdin!.end('\n'); assert.equal(await exited, 0);
    assert.equal(installerLockActive(executable, { localAppData: local }), false);
    assert.deepEqual(fs.readFileSync(marker), bytes);
  } finally { clearTimeout(watchdog); if (child.exitCode === null) child.kill(); await exited; }
});

const bootstrapCode = transformSync(fs.readFileSync(path.resolve('src/bootstrap.ts'), 'utf8'), { loader: 'ts', format: 'cjs', target: 'node24' }).code;
async function bootstrap(handled: boolean, locked: boolean, installerFailure = false, event?: string) {
  const calls: string[] = [];
  const argv = ['synthetic.exe', ...(event ? [event] : [])];
  vm.runInNewContext(bootstrapCode, { process: { argv, execPath: exe },
    require(name: string) {
      if (name === 'electron') return { app: { exit: (code: number) => calls.push('exit:' + code) } };
      if (name === './main/installer-events') return { handleInstallerEvent: async (args: string[], executable: string) => {
        assert.equal(args, argv); assert.equal(executable, exe);
        calls.push('installer'); if (installerFailure) throw new Error('Synthetic installer failure'); return handled;
      } };
      if (name === './main/installer-lock') return { installerLockActive: () => { calls.push('lock'); return locked; } };
      if (name === './main.cjs') { calls.push('main'); return {}; }
      throw new Error('Synthetic unexpected bootstrap import');
    },
  });
  await new Promise<void>(resolve => setImmediate(resolve)); return calls;
}
test('Bootstrap behandelt Installerereignis zuerst und überspringt dabei aktive Lock-Prüfung', async () => {
  for (const event of ['--squirrel-install', '--squirrel-updated', '--squirrel-uninstall', '--squirrel-obsolete']) {
    assert.deepEqual(await bootstrap(true, true, false, event), ['installer', 'exit:0']);
  }
  assert.deepEqual(await bootstrap(true, true), ['installer', 'exit:0']);
  assert.deepEqual(await bootstrap(true, false), ['installer', 'exit:0']);
  assert.deepEqual(await bootstrap(false, true), ['installer', 'lock', 'exit:0']);
  assert.deepEqual(await bootstrap(false, false), ['installer', 'lock', 'main']);
  assert.deepEqual(await bootstrap(false, true, true), ['installer', 'exit:1']);
});
