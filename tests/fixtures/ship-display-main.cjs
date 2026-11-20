const { app, BrowserWindow, ipcMain, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const folder = __dirname;
const runtime = process.argv.find(v => v.startsWith('--fixture-runtime=')).slice(18);
for (const part of ['', 'session', 'logs', 'crashes', 'tmp']) fs.mkdirSync(path.join(runtime, part), { recursive: true });
app.setName('Sarevocs Synthetic Ship Display');
app.setPath('userData', runtime); app.setPath('sessionData', path.join(runtime, 'session'));
app.setPath('logs', path.join(runtime, 'logs')); app.setPath('crashDumps', path.join(runtime, 'crashes')); app.setPath('temp', path.join(runtime, 'tmp'));
app.disableHardwareAcceleration();
const fixture = globalThis.fixture = JSON.parse(fs.readFileSync(path.join(folder, 'fixture.json'), 'utf8'));
fixture.commands = []; fixture.useObserved = false;
const copy = value => JSON.parse(JSON.stringify(value));
ipcMain.handle('fixture:command', async (_event, command) => {
  fixture.commands.push(copy(command));
  if (command.action === 'state') return { ok: true, data: copy(fixture.state) };
  if (command.action === 'inventory') return { ok: true, data: copy(fixture.inventory) };
  if (command.action === 'rsi.background') {
    const view = fixture.useObserved ? fixture.observed : null;
    const revision = view?.revision ?? null;
    const changed = revision !== (command.knownRevision ?? null);
    return { ok: true, data: { status: 'connected', revision, changed, ...(changed ? { view: copy(view) } : {}) } };
  }
  return { ok: false, error: 'UNEXPECTED_SYNTHETIC_COMMAND' };
});
app.whenReady().then(async () => {
  const isolated = session.fromPartition('synthetic-ship-display');
  globalThis.blockedRequests = 0;
  isolated.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (_details, callback) => {
    globalThis.blockedRequests++; callback({ cancel: true });
  });
  const win = new BrowserWindow({ width: 1440, height: 1200, useContentSize: true, show: false,
    webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false,
      session: isolated, preload: path.join(folder, 'fixture-preload.cjs') } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  await win.loadFile(path.join(folder, 'index.html'));
});
app.on('window-all-closed', () => app.quit());
