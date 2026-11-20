const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'); const path = require('node:path');
const root = path.resolve(__dirname, '..'); const data = path.join(root, 'work/temp/security-preview-runtime');
fs.mkdirSync(data, { recursive: true }); app.setPath('userData', data); app.setPath('sessionData', path.join(data, 'session'));
app.setPath('crashDumps', path.join(data, 'crashes')); app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  try {
    const w = new BrowserWindow({ width: 1100, height: 960, useContentSize: true, show: false,
      webPreferences: { offscreen: true, nodeIntegration: false, contextIsolation: true, sandbox: true, partition: 'security-preview' } });
    await w.loadFile(path.join(root, 'work/temp/security-preview.html'));
    await w.webContents.executeJavaScript('document.fonts.ready.then(() => true)');
    await new Promise(resolve => setTimeout(resolve, 250));
    fs.writeFileSync(path.join(root, 'work/temp/security-preview.png'), (await w.webContents.capturePage()).toPNG());
    w.destroy(); app.quit();
  } catch (error) { console.error(error.message); app.exit(1); }
});
