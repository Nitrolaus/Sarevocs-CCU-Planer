const { app, BrowserWindow, ipcMain, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const folder = __dirname, runtime = path.join(folder, 'runtime');
for (const part of ['', 'session', 'logs', 'crashes', 'tmp']) fs.mkdirSync(path.join(runtime, part), { recursive: true });
app.setName('Sarevocs Synthetic Upgrade Tooltip');
app.setPath('userData', runtime); app.setPath('sessionData', path.join(runtime, 'session'));
app.setPath('logs', path.join(runtime, 'logs')); app.setPath('crashDumps', path.join(runtime, 'crashes')); app.setPath('temp', path.join(runtime, 'tmp'));
app.disableHardwareAcceleration();
const fixture = globalThis.fixture = JSON.parse(fs.readFileSync(path.join(folder, 'fixture.json'), 'utf8'));
fixture.commands = []; fixture.pending = []; fixture.sessionSaved = true;
const copy = value => JSON.parse(JSON.stringify(value));
const same = (a, b) => a.accountId === b.accountId && a.pledgeId === b.pledgeId && a.revision === b.revision;
globalThis.resolveHistory = (key, result) => {
  const pending = fixture.pending.find(p => !p.done && same(p.command, key));
  if (!pending) throw new Error('NO_SYNTHETIC_HISTORY_PENDING');
  pending.done = true; pending.resolve({ ok: true, data: copy(result) });
};
ipcMain.handle('fixture:command', async (_event, command) => {
  fixture.commands.push(copy(command));
  if(command.action==='planner.batch'){
    if(fixture.batchFailure)return {ok:false,error:'SYNTHETIC_BATCH_FAILURE'};
    if(!fixture.state.accounts.some(a=>a.id===command.accountId))return {ok:false,error:'SYNTHETIC_PROFILE_MISSING'};
    fixture.drafts??={};const empty={mode:'auto',initialized:false,baseKey:'',anchors:[]};
    if(command.entries.some(r=>JSON.stringify(fixture.drafts[command.accountId+':'+r.targetId]??empty)!==JSON.stringify(r.expected)))return {ok:false,error:'SYNTHETIC_STALE_PREVIEW'};
    for(const r of command.entries)fixture.drafts[command.accountId+':'+r.targetId]=copy(r.draft);
    return {ok:true,data:copy(command.entries.map(({targetId,draft})=>({targetId,draft})))};
  }
  if(command.action==='planner.exclusions')return {ok:true,data:copy(fixture.excludedCcus?.[command.accountId]??[])};
  if(command.action==='planner.exclude'){
    if(fixture.exclusionSaveFailure)return {ok:false,error:'SYNTHETIC_EXCLUSION_SAVE_FAILURE'};
    fixture.excludedCcus??={};const keys=new Set(fixture.excludedCcus[command.accountId]??[]);
    if(command.excluded)keys.add(command.ccuKey);else keys.delete(command.ccuKey);
    fixture.excludedCcus[command.accountId]=[...keys].sort();
    return {ok:true,data:copy(fixture.excludedCcus[command.accountId])};
  }
  if(command.action==='planner.priorities'){
    if(!fixture.state.accounts.some(a=>a.id===command.accountId))return {ok:false,error:'SYNTHETIC_PROFILE_MISSING'};
    fixture.priorities??={};if(command.order)fixture.priorities[command.accountId]=copy(command.order);return {ok:true,data:copy(fixture.priorities[command.accountId]??[0,1,2])};
  }
  if(command.action==='planner.draft'){
    if(!fixture.state.accounts.some(a=>a.id===command.accountId))return {ok:false,error:'SYNTHETIC_PROFILE_MISSING'};
    fixture.planDrafts??={};const key=command.accountId+':'+command.targetId;
    if(command.draft)fixture.planDrafts[key]=copy(command.draft);return {ok:true,data:copy(fixture.planDrafts[key]??null)};
  }
  if (command.action === 'state') return { ok: true, data: copy(fixture.state) };
  if (command.action === 'market.status' && fixture.market) return { ok: true, data: copy(fixture.market) };
  if (command.action === 'pricing.status' && fixture.pricing) return { ok: true, data: copy(fixture.pricing) };
  if (command.action === 'inventory') return { ok: true, data: copy(fixture.inventories[command.accountId]) };
  if (command.action === 'account.select') { fixture.state.selectedAccountId = command.accountId; return { ok: true, data: { selectedAccountId: command.accountId } }; }
  if (command.action === 'rsi.background') {
    const view = fixture.views[command.accountId], revision = view?.revision ?? null;
    const changed = revision !== (command.knownRevision ?? null);
    return { ok: true, data: { status: 'connected', revision, changed, ...(changed ? { view: copy(view) } : {}) } };
  }
  if (command.action === 'rsi.upgradeHistory') {
    if (!fixture.sessionSaved) return { ok: true, data: { status: 'auth-required', steps: [], partial: false } };
    return new Promise(resolve => fixture.pending.push({ command: copy(command), resolve, done: false }));
  }
  if (command.action === 'rsi.settings') return { ok: true, data: { available: true, saved: fixture.sessionSaved, stored: fixture.sessionSaved,
    directory: 'Synthetischer Testordner', sessionOpen: false, error: null } };
  if (command.action === 'rsi.delete') { fixture.sessionSaved = false; return { ok: true, data: { deleted: true } }; }
  return { ok: false, error: 'UNEXPECTED_SYNTHETIC_COMMAND' };
});
app.whenReady().then(async () => {
  const isolated = session.fromPartition('synthetic-upgrade-history');
  globalThis.blockedRequests = 0;
  isolated.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (_details, callback) => { globalThis.blockedRequests++; callback({ cancel: true }); });
  const win = new BrowserWindow({ width: 1440, height: 1200, useContentSize: true, show: false,
    webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false,
      session: isolated, preload: path.join(folder, 'fixture-preload.cjs') } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  await win.loadFile(path.join(folder, 'index.html'));
});
app.on('window-all-closed', () => app.quit());
