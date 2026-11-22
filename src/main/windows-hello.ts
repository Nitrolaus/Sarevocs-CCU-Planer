import { app, type BrowserWindow } from 'electron';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

declare const CCU_HELLO_SHA256: string;

export type HelloConsent = 'verified' | 'cancelled' | 'unavailable';

export function requestHello(window: BrowserWindow, language: 'de' | 'en', signal: AbortSignal): Promise<HelloConsent> {
  if (process.platform !== 'win32' || signal.aborted || window.isDestroyed() || !window.isVisible() || window.isMinimized()) {
    return Promise.resolve('unavailable');
  }
  const executable = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'build', 'hello-consent.exe')
    : path.join(__dirname, 'hello-consent.exe');
  try {
    const file = fs.lstatSync(executable);
    if (!file.isFile() || file.size > 2 * 1024 * 1024 ||
        createHash('sha256').update(fs.readFileSync(executable)).digest('hex') !== CCU_HELLO_SHA256) {
      return Promise.resolve('unavailable');
    }
  } catch { return Promise.resolve('unavailable'); }
  const handle = window.getNativeWindowHandle();
  const hwnd = (handle.length === 8 ? handle.readBigUInt64LE() : BigInt(handle.readUInt32LE())).toString(16);
  return new Promise(resolve => {
    execFile(executable, [hwnd, String(process.pid), language], {
      windowsHide: true, timeout: 120_000, maxBuffer: 1024, signal,
    }, error => resolve(signal.aborted ? 'cancelled' : !error ? 'verified' : error.code === 1 ? 'cancelled' : 'unavailable'));
  });
}
