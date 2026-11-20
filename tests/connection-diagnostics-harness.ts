import { app, BrowserWindow, net as electronNet } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { RsiLogin } from '../src/importers/rsi';
import { SessionVault } from '../src/security/session-vault';
import { ConnectionDiagnostics } from '../src/diagnostics/connection';

const root = path.resolve(process.argv.find(x => x.startsWith('--test-root='))!.slice(12));
app.setPath('userData', path.join(root, 'runtime')); app.setPath('sessionData', path.join(root, 'memory')); app.setPath('crashDumps', path.join(root, 'crashes'));
const results: string[] = [], canary = 'SYNTHETIC_PRIVATE_VALUE_DO_NOT_LOG';
const diagnostics = new ConnectionDiagnostics(path.join(root, 'diagnostics'), '0.3.3');
const fixture = path.join(root, 'fixture.html'); fs.writeFileSync(fixture, `<h1>Local fixture</h1><input type="password" value="${canary}">`);
const read = () => JSON.parse(fs.readFileSync(diagnostics.file, 'utf8')).events as Array<Record<string, unknown>>;
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function remote(parent: BrowserWindow) {
  for (let i = 0; i < 150; i++) {
    const w = BrowserWindow.getAllWindows().find(w => w !== parent);
    if (w && !w.webContents.isLoadingMainFrame() && w.webContents.getURL() !== 'about:blank') return w;
    await wait(20);
  }
  throw new Error('Local test window missing');
}
app.whenReady().then(async () => {
  const original = BrowserWindow.prototype.loadURL;
  const parent = new BrowserWindow({ show: false, webPreferences: { sandbox: true, nodeIntegration: false } });
  let saveCount = 0, navigations = 0;
  const vault = { load: async () => [], save: async () => { saveCount++; return false; } } as unknown as SessionVault;
  const login = new RsiLogin(vault, diagnostics);
  const account = randomUUID();
  let server: http.Server | undefined;
  try {
    // Real Chromium failure against a closed loopback port. No connection to RSI.
    const reservation = net.createServer(); await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve));
    const port = (reservation.address() as net.AddressInfo).port; await new Promise<void>(resolve => reservation.close(() => resolve()));
    BrowserWindow.prototype.loadURL = function() { navigations++; return original.call(this, `https://127.0.0.1:${port}/?token=${canary}`); };
    await assert.rejects(() => login.connect(account, parent, false), /ERR_CONNECTION_REFUSED.*lokal gespeichert/);
    assert.ok(read().some(e => e.event === 'load-failed' && e.code === -102 && e.networkError === 'ERR_CONNECTION_REFUSED'));
    assert.equal(navigations, 1); assert.equal(BrowserWindow.getAllWindows().length, 2);
    const refusedWindow = BrowserWindow.getAllWindows().find(w => w !== parent)!;
    assert.ok(refusedWindow); assert.equal(refusedWindow.isDestroyed(), false);
    await login.close(account); assert.equal(refusedWindow.isDestroyed(), true);
    assert.equal(BrowserWindow.getAllWindows().length, 1);
    results.push('Real Chromium ERR_CONNECTION_REFUSED retains the window and diagnostic until explicit close; exactly one loopback navigation, no RSI.');
    const persisted = new ConnectionDiagnostics(path.join(root, 'diagnostics'), '0.3.3');
    assert.equal(persisted.record({ event: 'http-error', target: 'login', resource: 'xhr', httpStatus: 429 }), true);
    assert.ok(read().some(e => e.code === -102));
    results.push('Failure persists when the recorder is reopened after the RSI test window is destroyed.');

    BrowserWindow.prototype.loadURL = async function() { navigations++; await this.loadFile(fixture); };
    await login.open(account, parent, true); const child = await remote(parent);
    const beforeAbort = read().length;
    child.webContents.emit('did-fail-load', {}, -3, canary, 'https://example.invalid/' + canary, true);
    assert.equal(read().length, beforeAbort);
    child.webContents.emit('did-fail-load', {}, -102, canary, `https://example.invalid/${canary}?password=${canary}`, false);
    assert.notEqual(login.status(account).state, 'error');
    assert.ok(read().some(e => e.resource === 'subFrame' && e.code === -102));
    results.push('Normal cancellation is ignored; failing child frame is captured without treating the main page as failed.');

    // Exercise the actual registered HTTP callback with untrusted metadata, without requests.
    const handlers: Array<(details: Electron.OnCompletedListenerDetails) => void> = [];
    await login.close(account);
    BrowserWindow.prototype.loadURL = async function() { await this.loadFile(fixture); };
    // Capture the method registration before the next isolated session is created.
    const { session } = await import('electron');
    const originalPartition = session.fromPartition.bind(session);
    session.fromPartition = (partition, options) => {
      const isolated = originalPartition(partition, options);
      const register = isolated.webRequest.onCompleted.bind(isolated.webRequest);
      isolated.webRequest.onCompleted = ((...args: unknown[]) => {
        const handler = args.at(-1); if (typeof handler === 'function') handlers.push(handler as (d: Electron.OnCompletedListenerDetails) => void);
        return (register as (...a: unknown[]) => void)(...args);
      }) as typeof isolated.webRequest.onCompleted;
      return isolated;
    };
    try { await login.open(account, parent, false); } finally { session.fromPartition = originalPartition; }
    const httpChild = await remote(parent);
    assert.equal(handlers.length, 1);
    for (const statusCode of [403, 429]) handlers[0]!({ statusCode, url: `https://robertsspaceindustries.com/en/connect?token=${canary}`, resourceType: 'xhr',
      responseHeaders: { 'Set-Cookie': [canary] }, statusLine: canary, uploadData: [{ bytes: Buffer.from(canary) }] } as unknown as Electron.OnCompletedListenerDetails);
    assert.ok(read().some(e => e.httpStatus === 403)); assert.ok(read().some(e => e.httpStatus === 429));
    results.push('Registered HTTP observer retains 403/429 and discards URL parameters, response headers and body metadata.');

    let received = 0; server = http.createServer((_request, response) => { received++; response.end('local'); });
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
    const httpPort = (server.address() as net.AddressInfo).port;
    const blocked = await new Promise<string>(resolve => {
      const request = electronNet.request({ url: `http://127.0.0.1:${httpPort}/?token=${canary}`, session: httpChild.webContents.session });
      request.on('error', e => resolve(e.message)); request.end();
    });
    assert.match(blocked, /ERR_BLOCKED_BY_CLIENT/); assert.equal(received, 0);
    assert.ok(read().some(e => e.event === 'request-blocked' && e.reason === 'insecure-transport'));
    results.push('Existing HTTPS-only request guard still blocks a real request before transmission; diagnostic cause retained.');
    await new Promise<void>(resolve => server!.close(() => resolve())); server = undefined;
    let prevented = false;
    httpChild.webContents.emit('will-redirect', { preventDefault: () => { prevented = true; } }, `https://example.invalid/${canary}?token=${canary}`, false, false);
    assert.equal(prevented, true); assert.equal(login.status(account).state, 'restricted');
    assert.ok(read().some(e => e.event === 'navigation-blocked' && e.target === 'external' && e.resource === 'subFrame'));
    await login.close(account);
    assert.equal(saveCount, 0);
    results.push('Blocked redirect records only a category; unverified windows never replace the saved session.');
    const bytes = fs.readFileSync(diagnostics.file, 'utf8');
    assert.equal(bytes.includes(canary), false); assert.equal(bytes.includes(account), false); assert.equal(bytes.includes('127.0.0.1'), false);
    assert.equal(bytes.includes('https://'), false); assert.equal(bytes.includes('Set-Cookie'), false);
    results.push('Persisted diagnostic file contains no synthetic password/token/cookie, account ID, IP address or full URL.');

    const failing = new RsiLogin(vault, { record: () => { throw new Error(canary); } });
    try {
      const failed = failing.connect(account, parent, false).then(() => null, error => error);
      const failureWindow = await remote(parent);
      failureWindow.webContents.emit('did-fail-load', {}, -102, canary, 'https://example.invalid/' + canary, true);
      assert.match((await failed)?.message ?? '', /ERR_CONNECTION_REFUSED.*nicht lokal gespeichert/);
      assert.equal(failureWindow.isDestroyed(), false); assert.equal(BrowserWindow.getAllWindows().length, 2);
      await failing.close(account); assert.equal(failureWindow.isDestroyed(), true);
      assert.equal(BrowserWindow.getAllWindows().length, 1);
    } finally { await failing.shutdown(); }
    results.push('Unavailable diagnostic storage is reported truthfully without throwing raw errors or blocking cleanup.');
  } finally {
    BrowserWindow.prototype.loadURL = original;
    await login.shutdown();
    if (server?.listening) await new Promise<void>(resolve => server!.close(() => resolve()));
    parent.destroy();
  }
  fs.writeFileSync(path.join(root, 'results.json'), JSON.stringify({ status: 'PASS', data: 'synthetic-only and loopback-only', results }, null, 2));
  console.log('PASS: ' + results.join('\nPASS: ')); console.log('REPORT: ' + path.join(root, 'results.json')); app.quit();
}).catch(error => {
  fs.writeFileSync(path.join(root, 'results.json'), JSON.stringify({ status: 'FAIL', results, error: error.message }, null, 2));
  console.error(error.message); app.exit(1);
});
