import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { app } from 'electron';

declare const CCU_SESSION_ACL_SHA256: string;
const execute = promisify(execFile);

export async function protectSessionDirectory(directory: string, protectKeyState = false): Promise<void> {
  if (process.platform !== 'win32' || !path.isAbsolute(directory)) throw new Error('Windows-Verzeichnisschutz nicht verfügbar.');
  const digest = typeof CCU_SESSION_ACL_SHA256 === 'string' ? CCU_SESSION_ACL_SHA256 : undefined;
  // Standalone development harnesses use the just-built helper from the workspace.
  const executable = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'build', 'session-acl.exe')
    : path.join(digest ? __dirname : path.resolve('build'), 'session-acl.exe');
  const file = fs.lstatSync(executable);
  if (!file.isFile() || file.size > 2 * 1024 * 1024 || (app.isPackaged && !digest) ||
      (digest && createHash('sha256').update(fs.readFileSync(executable)).digest('hex') !== digest)) {
    throw new Error('Windows-Verzeichnisschutz nicht verfügbar.');
  }
  await execute(executable, [protectKeyState ? 'key-directory' : 'directory', directory],
    { windowsHide: true, timeout: 12000, maxBuffer: 1024 });
}
