import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installerEvent, shortcutCommand } from '../src/main/installer-events';
import { runtimePaths } from '../src/main/paths';
import { officialCookie } from '../src/security/session-vault';
test('Installerereignisse verwalten Startmenue und Desktop in einer erwarteten Installation', () => {
  const exe = 'C:\\Users\\Fixture\\AppData\\Local\\SarevocsCCUPlaner\\app-0.2.0\\Sarevocs-CCU-Planer.exe';
  const create = shortcutCommand('--squirrel-install', exe)!;
  assert.deepEqual(create.args, ['--createShortcut', 'Sarevocs-CCU-Planer.exe', '--shortcut-locations=StartMenu,Desktop']);
  assert.ok(create.executable.endsWith('SarevocsCCUPlaner\\Update.exe'));
  assert.equal(shortcutCommand('--squirrel-obsolete', exe), null);
  assert.equal(shortcutCommand('--squirrel-uninstall', exe)!.args[0], '--removeShortcut');
  assert.equal(shortcutCommand('--squirrel-updated', exe)!.args[2], '--shortcut-locations=StartMenu,Desktop');
  assert.equal(shortcutCommand('--squirrel-uninstall', exe)!.args[2], '--shortcut-locations=StartMenu,Desktop');
  assert.equal(installerEvent(['app.exe', '--squirrel-firstrun']), null);
  assert.throws(() => shortcutCommand('--squirrel-install', 'C:\\Codex\\random\\Sarevocs-CCU-Planer.exe'));
});
test('Installierte App verwendet benutzerspezifische Daten und getrennte Anmeldung ohne Codex-Zwang', () => {
  const p = runtimePaths({ packaged: true, cwd: 'C:\\Dummy', localAppData: 'C:\\Users\\Fixture\\AppData\\Local' });
  assert.equal(p.inventory, 'C:\\Users\\Fixture\\AppData\\Local\\SarevocsCCUPlaner-Daten\\Daten');
  assert.equal(p.vault, 'C:\\Users\\Fixture\\AppData\\Local\\SarevocsCCUPlaner-Daten\\Anmeldung');
  assert.equal(p.root.startsWith('C:\\Users\\Fixture\\AppData\\Local\\SarevocsCCUPlaner\\'), false);
  assert.notEqual(p.session, p.vault); assert.notEqual(p.electron, p.inventory);
  const isolated = runtimePaths({ packaged: true, cwd: 'C:\\Dummy', localAppData: undefined, override: 'C:\\Codex\\test' });
  assert.equal(isolated.root, 'C:\\Codex\\test');
  assert.throws(() => runtimePaths({ packaged: true, cwd: 'C:\\Dummy', localAppData: undefined }));
  assert.throws(() => runtimePaths({ packaged: false, cwd: 'C:\\Dummy', localAppData: undefined, override: 'relative' }));
});
test('Sitzungsspeicher akzeptiert nur sichere, nicht abgelaufene RSI-Cookies mit erwarteten Domains', () => {
  const good = { domain: '.robertsspaceindustries.com', path: '/', secure: true };
  assert.equal(officialCookie(good), true);
  for (const c of [{ ...good, secure: false }, { ...good, domain: 'robertsspaceindustries.com.evil.test' },
    { ...good, expirationDate: 1 }, { ...good, path: '/\r\n' }, { ...good, domain: undefined }]) assert.equal(officialCookie(c), false);
});
