const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const root = path.resolve(__dirname, '..');
const data = path.join(root, 'work', 'temp', 'preview-runtime');
fs.mkdirSync(data, { recursive: true });
app.setPath('userData', data);
app.setPath('sessionData', path.join(data, 'session'));
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  try {
    const w = new BrowserWindow({ width: 1440, height: 1160, useContentSize: true, show: false,
      webPreferences: { offscreen: true, nodeIntegration: false, contextIsolation: true, sandbox: true, partition: 'preview' } });
    await w.loadFile(path.join(root, 'work', 'temp', 'ui-preview.html'));
    await w.webContents.executeJavaScript('document.fonts.ready.then(() => true)');
    fs.writeFileSync(path.join(root, 'work', 'temp', 'ui-preview.png'), (await w.webContents.capturePage()).toPNG());
    await w.webContents.executeJavaScript(`document.querySelector('#import-preview').showModal(); true`);
    fs.writeFileSync(path.join(root, 'work', 'temp', 'ui-import-preview.png'), (await w.webContents.capturePage()).toPNG());
    w.destroy();
    app.quit();
  } catch (error) { console.error(error.message); app.exit(1); }
});
