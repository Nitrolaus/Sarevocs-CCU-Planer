import fs from 'node:fs';
import path from 'node:path';

type LockEntry = { name: string; isFile(): boolean; isSymbolicLink(): boolean };
export type InstallerLockIo = {
  directoryEntries(directory: string): readonly LockEntry[];
  openReadOnly(file: string): number;
  close(fd: number): void;
};
type LockOptions = { localAppData?: string; platform?: NodeJS.Platform; io?: InstallerLockIo; productMarker?: (directory: string) => boolean };
const markerName = 'SarevocsCCUPlaner.install.lock';
const ownExecutable = 'sarevocs-ccu-planer.exe';
const appVersion = /^app-\d+\.\d+\.\d+(?:-[0-9a-z]+(?:[.-][0-9a-z]+)*)?(?:\+[0-9a-z]+(?:[.-][0-9a-z]+)*)?$/i;
const nativeIo: InstallerLockIo = {
  directoryEntries: directory => fs.readdirSync(directory, { withFileTypes: true }),
  openReadOnly: file => fs.openSync(file, 'r'),
  close: fd => fs.closeSync(fd),
};
function absent(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT';
}

/** Probe only the installed product's marker. A stale, readable marker is not an active installer. */
export function installerLockActive(execPath: string, options: LockOptions = {}): boolean {
  if ((options.platform ?? process.platform) !== 'win32') return false;
  const local = options.localAppData ?? process.env.LOCALAPPDATA;
  if (!local || !path.win32.isAbsolute(local) || !path.win32.isAbsolute(execPath)) return false;
  const executable = path.win32.resolve(execPath);
  if (path.win32.basename(executable).toLowerCase() !== ownExecutable) return false;
  const root = path.win32.resolve(local, 'SarevocsCCUPlaner');
  const directory = path.win32.dirname(executable);
  const same = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();
  if (!same(directory, root) && !(appVersion.test(path.win32.basename(directory)) && same(path.win32.dirname(directory), root))) {
    // Custom flat installs carry a tiny product marker, never a user-data path or registry value.
    const marker = options.productMarker ?? (folder => {
      try { const file = path.win32.join(folder, 'install-product.txt'), stat = fs.lstatSync(file);
        return stat.isFile() && !stat.isSymbolicLink() && stat.size <= 100 && fs.readFileSync(file, 'utf8').trim() === 'SarevocsCCUPlaner/1';
      } catch { return false; }
    });
    if (!marker(directory)) return false;
  }

  const io = options.io ?? nativeIo;
  try {
    // Windows directory enumeration exposes FILE_ATTRIBUTE_REPARSE_POINT for every tag.
    // lstat alone can treat an unfamiliar reparse tag as a regular file; never open such a marker.
    const markerDirectory = path.win32.dirname(root);
    const entry = io.directoryEntries(markerDirectory).find(value => value.name.toLowerCase() === markerName.toLowerCase());
    if (!entry) return false;
    if (entry.isSymbolicLink() || !entry.isFile()) return true;
    const fd = io.openReadOnly(path.win32.join(markerDirectory, entry.name));
    io.close(fd);
    return false;
  } catch (error) {
    // FileShare.None normally maps to EACCES/EPERM/EBUSY. Unknown failures also fail closed.
    return !absent(error);
  }
}
