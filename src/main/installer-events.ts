import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const events = new Set(['--squirrel-install', '--squirrel-updated', '--squirrel-uninstall', '--squirrel-obsolete']);
export function installerEvent(argv: string[]) { return argv.find(x => events.has(x)) ?? null; }
export function shortcutCommand(event: string, executable: string) {
  if (event === '--squirrel-obsolete') return null;
  if (!events.has(event)) throw new Error('Unbekanntes Installationsereignis.');
  if (!/^app-\d+\.\d+\.\d+(?:[-.].*)?$/.test(path.basename(path.dirname(executable))) || path.basename(executable) !== 'Sarevocs-CCU-Planer.exe') {
    throw new Error('Installationsereignis außerhalb einer erwarteten Squirrel-Installation.');
  }
  return { executable: path.resolve(path.dirname(executable), '..', 'Update.exe'),
    args: [event === '--squirrel-uninstall' ? '--removeShortcut' : '--createShortcut', path.basename(executable), '--shortcut-locations=StartMenu,Desktop'] };
}
export async function handleInstallerEvent(argv: string[], executable: string): Promise<boolean> {
  const event = installerEvent(argv); if (!event) return false;
  const command = shortcutCommand(event, executable); if (!command) return true;
  if (!fs.existsSync(command.executable)) throw new Error('Installationshelfer fehlt.');
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command.executable, command.args, { windowsHide: true, stdio: 'ignore' });
    const timer = setTimeout(() => { child.kill(); reject(new Error('Installationshelfer hat nicht rechtzeitig geantwortet.')); }, 12000);
    child.once('error', () => { clearTimeout(timer); reject(new Error('Installationshelfer konnte nicht gestartet werden.')); });
    child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('Installationshelfer meldet einen Fehler.')); });
  });
  return true;
}
