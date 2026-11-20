import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { InventoryStore } from './storage/database';
import { APP_NAME, APP_VERSION, UserError, type ImportCandidate, type Preview } from './domain/model';
import { giveawayShip } from './domain/giveaway';
import { MAX_FILE_BYTES, parseImport } from './importers/files';
import { RsiLogin } from './importers/rsi';
import { ConnectionDiagnostics } from './diagnostics/connection';
import { commandSchema } from './main/commands';
import { runtimePaths } from './main/paths';
import { DesktopLifecycle } from './main/desktop-lifecycle';
import { SessionVault } from './security/session-vault';
import { LastSeenStore } from './storage/last-seen';
import { GiveawayOriginsStore } from './storage/giveaway-origins';
import { BackgroundInventory } from './main/background-inventory';
import { InventoryRefresh } from './main/inventory-refresh';
import {PlannerDraftStore} from './planner/draft-store';
import {APP_USER_MODEL_ID,taskbarDetails} from './main/taskbar-details';
import {PlannerPriorityStore} from './planner/priority-store';
import {CcuExclusionStore} from './planner/exclusion-store';
import {ccuKeysIn} from './planner/exclusions';
import { UpgradeHistoryReader } from './importers/upgrade-history';
import { mayReadUpgradeHistory } from './main/upgrade-history-access';
import { MarketService } from './market/service';
import { TableWidthStore } from './main/table-widths';
import { LoanerService } from './loaners/service';
import {LoanerReviews} from './loaners/reviews';
import { publicClient, publicMarketReader, publicShopPriceReader } from './market/transport';
import { PricingService } from './pricing/service';
import { safeRsiShipUrl } from './market/ship-link';
import { openRsiUpgrades } from './market/upgrade-link';
import { openRsiHelp } from './main/rsi-help';
import { openHelpResource, readHelpDocument } from './main/help-resources';
import { RELEASES_API_URL, ReleaseUpdates } from './main/release-updates';
import {PaintService} from './paints/service';
import {publicPaintReader} from './paints/transport';
import {readPaintCatalogue} from './paints/source';
import {ReportService} from './export/service';
import {excelReport} from './export/excel';
import {pdfReport,closeReportWindows} from './export/pdf';
import {reportTarget} from './export/save';
import {FairNewsStore, fairInstallationTime} from './market/fair-news';

const dataArg = process.argv.find(x => x.startsWith('--data-dir='))?.slice('--data-dir='.length);
const paths = runtimePaths({ packaged: app.isPackaged, cwd: process.cwd(), localAppData: process.env.LOCALAPPDATA, override: dataArg });
const dataDir = paths.inventory;
for (const directory of [paths.inventory, paths.electron, paths.session, paths.crashes]) fs.mkdirSync(directory, { recursive: true });
app.setPath('userData', paths.electron);
app.setPath('sessionData', paths.session);
app.setPath('crashDumps', paths.crashes);
app.setName(APP_NAME);
app.setAppUserModelId(APP_USER_MODEL_ID);
const single = app.requestSingleInstanceLock();
if (!single) app.quit();
let shuttingDown = false;
let shutdownComplete = false;
const desktop = single ? new DesktopLifecycle({ name: APP_NAME, icon: path.join(__dirname, 'tray.ico'),
  closeToTray: () => pricing?.snapshot().settings.windowClose !== 'quit',
  isQuitting: () => shuttingDown, shutdownComplete: () => shutdownComplete }) : null;
let mainWindow: BrowserWindow | null = null;
let store: InventoryStore;
let background: BackgroundInventory;
let inventoryRefresh: InventoryRefresh;
let plannerDrafts:PlannerDraftStore;
let plannerPriorities:PlannerPriorityStore;
let ccuExclusions:CcuExclusionStore;
let market: MarketService;
let paints:PaintService;
let loaners: LoanerService;
let loanerReviews:LoanerReviews;
let pricing: PricingService;
let selectedAccountId: string | null = null;
const lastSeen = new LastSeenStore(path.join(dataDir, 'LetzterStand'));
const giveawayOrigins = new GiveawayOriginsStore(path.join(dataDir, 'Giveaway-Herkunft'));
type InteractiveTask = { controller: AbortController; done: Promise<void>; finish: () => void; previous?: Promise<void> };
const interactive = new Map<string, InteractiveTask>();
const revokingSessions = new Map<string, Promise<void>>();
const sessionBusy = (id: string) => interactive.has(id) || revokingSessions.has(id);
let selectionEpoch = 0;
const reports=new ReportService();let reportSaving=false;
function beginInteractive(id: string): InteractiveTask {
  if (revokingSessions.has(id)) throw new UserError('Die gespeicherte RSI-Sitzung wird gerade gelöscht.');
  const previous = interactive.get(id); previous?.controller.abort();
  let finish = () => {};
  const done = new Promise<void>(resolve => { finish = resolve; });
  const task = { controller: new AbortController(), done, finish, previous: previous?.done };
  interactive.set(id, task); return task;
}
function ensureInteractive(id: string, task: InteractiveTask) {
  if (shuttingDown || task.controller.signal.aborted || interactive.get(id) !== task) throw new UserError('Verbindung beendet.');
}
async function prepareInteractive(id: string, task: InteractiveTask) {
  await task.previous;
  ensureInteractive(id, task);
  await upgradeHistory.close(id);
  ensureInteractive(id, task);
  await background.cancel(id);
  ensureInteractive(id, task);
}
function finishInteractive(id: string, task: InteractiveTask) {
  if (interactive.get(id) === task) interactive.delete(id);
  task.finish();
}
async function stopProfile(id: string) {
  const task = interactive.get(id); task?.controller.abort();
  await upgradeHistory.close(id);
  await background.cancel(id);
  await login.close(id);
  await task?.done;
}
const vault = new SessionVault(paths.vault, safeStorage, paths.session);
const login = new RsiLogin(vault, new ConnectionDiagnostics(path.join(paths.crashes, 'Verbindung'), APP_VERSION),
  path.join(__dirname, 'app.ico'), (id, identity) => lastSeen.canRemember(store.account(id), identity));
// Read-only capsule load: a tooltip never saves, refreshes, or opens authentication.
const upgradeHistory = new UpgradeHistoryReader(id => vault.load(id, false));
const pending = new Map<string, { accountId: string; candidate: ImportCandidate; expires: number }>();
const uiFile = path.join(__dirname, 'renderer/index.html');
const uiUrl = pathToFileURL(uiFile).href;
function stage(accountId: string, candidate: ImportCandidate): Preview {
  for (const [key, p] of pending) if (p.expires < Date.now() || p.accountId === accountId) pending.delete(key);
  if (pending.size > 8) throw new UserError('Zu viele offene Vorschauen. Andere Vorschauen schließen.');
  const preview = store.preview(accountId, candidate); const token = randomUUID();
  pending.set(token, { accountId, candidate, expires: Date.now() + 15 * 60 * 1000 });
  return { ...preview, token };
}
async function start() {
  if (!single) return;
  desktop!.initialize();
  // Protect the actual Local State directory before any window; inventory remains usable if protection fails.
  await vault.prepare().catch(() => {});
  store = await InventoryStore.open(path.join(dataDir, 'inventory.sqlite'), fs.readFileSync(path.join(__dirname, 'sql-wasm.wasm')));
  const publicReader = publicMarketReader();
  const readReleases = publicClient(1024 * 1024);
  const releases = new ReleaseUpdates(APP_VERSION, signal => readReleases(RELEASES_API_URL, signal, false));
  app.once('before-quit', () => releases.close());
  const marketDirectory = path.join(dataDir, 'Marktdaten');
  const installedAt = fairInstallationTime(app.isPackaged ? process.execPath : null, Date.now());
  market = new MarketService(marketDirectory, publicReader, undefined, new FairNewsStore(marketDirectory, installedAt), publicShopPriceReader());
  const paintReader=publicPaintReader();paints=new PaintService(path.join(dataDir,'Marktdaten'),signal=>readPaintCatalogue(signal,paintReader));
  loaners = new LoanerService(path.join(dataDir, 'Marktdaten'), publicReader);
  loanerReviews=new LoanerReviews(path.join(dataDir,'Loanerbewertungen'));
  plannerDrafts=new PlannerDraftStore(path.join(dataDir,'Planungen'));
  plannerPriorities=new PlannerPriorityStore(path.join(dataDir,'Planungen'));
  ccuExclusions=new CcuExclusionStore(path.join(dataDir,'Planungen'));
  pricing = new PricingService(path.join(dataDir, 'Anzeige'), signal => publicReader('fx', signal));
  const tableWidths=new TableWidthStore(path.join(dataDir,'Anzeige'));
  mainWindow = new BrowserWindow({ width: 1440, height: 1000, minWidth: 1024, minHeight: 700, title: APP_NAME, show: false,
    icon: path.join(__dirname, 'app.ico'),
    backgroundColor: '#111820', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true,
      sandbox: true, webSecurity: true, webviewTag: false, spellcheck: false, partition: 'local-ui-' + randomUUID() } });
  const win = mainWindow;
  if(process.platform==='win32'&&app.isPackaged)win.setAppDetails(taskbarDetails(process.execPath,APP_NAME));
  selectedAccountId = lastSeen.selected(store.accounts());
  background = new BackgroundInventory(lastSeen, id => store.account(id), id => login.resume(id, win), id => login.close(id));
  inventoryRefresh = new InventoryRefresh(id => background.refresh(id), () => shuttingDown ? null : selectedAccountId, sessionBusy);
  desktop!.attachWindow(win);
  win.on('closed', () => { mainWindow = null; });
  win.webContents.session.setPermissionCheckHandler(() => false);
  win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.on('will-attach-webview', event => event.preventDefault());
  ipcMain.handle('ccu:command', async (event, raw: unknown) => {
    try {
      if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame || event.senderFrame.url !== uiUrl) {
        throw new UserError('Aufruf aus nicht zugelassener Oberfläche abgewiesen.');
      }
      const validation = commandSchema.safeParse(raw);
      if (!validation.success) throw new UserError('Ungültiger Anwendungsaufruf.');
      const cmd = validation.data;
      if (shuttingDown) throw new UserError('Programm wird beendet.');
      let data: unknown;
      switch (cmd.action) {
        case 'report.preview':
        case 'report.selection':{
          if(selectedAccountId!==cmd.accountId)throw new UserError('Exportprofil ist nicht mehr ausgewählt.');
          const kinds=cmd.action==='report.selection'?cmd.kinds:[cmd.kind],hasChain=kinds.includes('chain'),hasLoaners=kinds.includes('loaners');
          const targets=hasChain?market.targets(cmd.accountId):[],drafts=new Map(targets.flatMap(id=>{const d=id?plannerDrafts.load(cmd.accountId,id):null;return id&&d?[[id,d] as const]:[];}));
          const input={chain:hasChain?cmd.chain:undefined,inventory:store.inventory(cmd.accountId),observed:background.snapshot(cmd.accountId).view??null,
            market:market.snapshot(),display:pricing.snapshot(),excluded:hasChain?ccuExclusions.load(cmd.accountId):[],targets,drafts,loaners:hasLoaners?loaners.snapshot().data:null};
          data=cmd.action==='report.preview'?reports.preview({...input,kind:cmd.kind}):
            await reports.selection(input,cmd.kinds,hasLoaners?loanerReviews.snapshot(cmd.accountId):undefined,cmd.filters);break;
        }
        case 'report.save':{
          if(reportSaving)throw new UserError('Ein Export wird bereits gespeichert.');
          if(selectedAccountId!==cmd.accountId)throw new UserError('Exportprofil ist nicht mehr ausgewählt.');
          const document=reports.get(cmd.accountId,cmd.token),epoch=selectionEpoch;reportSaving=true;
          try{
            const target=await dialog.showSaveDialog(win,{title:document.language==='en'?'Save export':'Export speichern',
              defaultPath:`Sarevocs-CCU-${(document.sections?.length??0)>1?'Auswahl':document.kind}-${document.createdAt.slice(0,10)}.${cmd.format}`,
              filters:[{name:cmd.format==='xlsx'?'Excel':'PDF',extensions:[cmd.format]}],properties:['showOverwriteConfirmation']});
            if(target.canceled||!target.filePath){data={exported:false};break;}
            const save=reportTarget(target.filePath,cmd.format);
            const buffer=cmd.format==='xlsx'?await excelReport(document):await pdfReport(document);
            if(shuttingDown||selectedAccountId!==cmd.accountId||selectionEpoch!==epoch)throw new UserError('Profil wurde gewechselt oder Programm beendet. Export abgebrochen.');
            save(buffer);reports.remove(cmd.token);data={exported:true};
          }finally{reportSaving=false;}break;
        }
        case 'market.status': data = market.snapshot(); break;
        case 'market.fairSeen': market.markFairNoticeSeen(cmd.noticeId); data = market.snapshot(); break;
        case 'paints.status':data=paints.snapshot();break;
        case 'paints.refresh':void paints.refresh();data=paints.snapshot();break;
        case 'planner.draft':store.account(cmd.accountId);data=cmd.draft?plannerDrafts.save(cmd.accountId,cmd.targetId,cmd.draft):plannerDrafts.load(cmd.accountId,cmd.targetId);break;
        case 'planner.batch':store.account(cmd.accountId);data=plannerDrafts.saveBatch(cmd.accountId,cmd.entries);break;
        case 'planner.priorities':store.account(cmd.accountId);data=cmd.order?plannerPriorities.save(cmd.accountId,cmd.order):plannerPriorities.load(cmd.accountId);break;
        case 'planner.creditBudget': store.account(cmd.accountId); data = market.creditBudget(cmd.accountId, cmd.budget); break;
        case 'planner.exclusions':store.account(cmd.accountId);data=ccuExclusions.load(cmd.accountId);break;
        case 'planner.exclude':{
          store.account(cmd.accountId);
          const accepted=store.inventory(cmd.accountId).items.filter(item=>item.availability==='present').map(item=>item.pledge);
          const observed=background.snapshot(cmd.accountId).view?.document.pledges??[];
          data=ccuExclusions.toggle(cmd.accountId,cmd.ccuKey,cmd.excluded,ccuKeysIn([...accepted,...observed]));break;
        }
        case 'loaners.status': data = loaners.snapshot(); break;
        case 'loaners.refresh': void loaners.refresh(); data = loaners.snapshot(); break;
        case 'loaners.reviews':store.account(cmd.accountId);data=loanerReviews.snapshot(cmd.accountId);break;
        case 'loaners.review':{
          store.account(cmd.accountId);
          try{data=loanerReviews.set(cmd.accountId,cmd.key,cmd.state);}catch{throw new UserError('Loaner-Bestätigung konnte nicht gespeichert werden. Vorherige Angaben bleiben erhalten.');}break;
        }
        case 'inventory.giveaways': {
          if (selectedAccountId !== cmd.accountId) throw new UserError('Das Bestandsprofil wurde gewechselt.');
          store.account(cmd.accountId);
          const edit = cmd.edit;
          if (edit) {
            const inventory = store.inventory(cmd.accountId);
            const observed = background.snapshot(cmd.accountId).view;
            const acceptedAt = inventory.items.reduce((latest, item) => Math.max(latest, Date.parse(item.importedAt) || 0),
              Date.parse(inventory.account.lastComplete ?? '') || 0);
            const pledges = observed && Date.parse(observed.observedAt) > acceptedAt ? observed.document.pledges :
              inventory.items.filter(item => item.availability === 'present').map(item => item.pledge);
            const pledge = pledges.find(item => item.pledgeId === edit.pledgeId);
            if (!pledge || !giveawayShip(pledge)) throw new UserError('Dieses Exemplar ist im ausgewählten Bestand nicht als Giveaway erkannt.');
          }
          try { data = edit ? giveawayOrigins.save(cmd.accountId, edit) : giveawayOrigins.snapshot(cmd.accountId); }
          catch { throw new UserError('Giveaway-Herkunft konnte lokal nicht gelesen oder gespeichert werden.'); }
          break;
        }
        case 'market.openUpgrades': data = await openRsiUpgrades(url => shell.openExternal(url)); break;
        case 'help.openRsi': data = await openRsiHelp(cmd.topic, url => shell.openExternal(url)); break;
        case 'help.openResource': data = await openHelpResource(cmd.resource, url => shell.openExternal(url)); break;
        case 'help.readDocument': data = await readHelpDocument(cmd.document, __dirname); break;
        case 'help.checkUpdate': data = await releases.check(); break;
        case 'help.openUpdate': {
          data = await releases.open(cmd.tag, url => shell.openExternal(url));
          if (!data) throw new UserError('Diese Release-Version ist zurzeit nicht verfügbar.');
          break;
        }
        case 'pricing.status': data = pricing.snapshot(); break;
        case 'table.widths': data=tableWidths.get(cmd.table,cmd.widths);break;
        case 'pricing.save': data = pricing.save(cmd.settings); break;
        case 'market.openShip': {
          const observed = market.snapshot().catalogue?.ships.find(ship => ship.id === cmd.shipId)?.storeUrl;
          const target = safeRsiShipUrl(observed);
          if (!target) throw new UserError('Für dieses Schiff ist kein geprüfter RSI-Link verfügbar.');
          await shell.openExternal(target); data = { opened: true }; break;
        }
        case 'market.refresh': void market.refresh(); void pricing.refresh(); void loaners.refresh(); data = market.snapshot(); break;
        case 'market.shopPrices': void market.checkShopPrices(cmd.pairs); data = null; break;
        case 'market.targets': {
          store.account(cmd.accountId);
          data = cmd.ids ? market.setTargets(cmd.accountId, cmd.ids) : market.targets(cmd.accountId); break;
        }
        case 'state': data = { accounts: store.accounts(), selectedAccountId, dataDir, version: APP_VERSION, packaged: app.isPackaged,
          electron: process.versions.electron, node: process.versions.node }; break;
        case 'account.create': data = store.createAccount(cmd.name, cmd.mode); break;
        case 'account.select': {
          const account = store.account(cmd.accountId);
          const previous = selectedAccountId;
          lastSeen.select(account.id); selectedAccountId = account.id;
          const epoch = ++selectionEpoch;
          if (previous && previous !== account.id) interactive.get(previous)?.controller.abort();
          void (async () => {
            if (previous && previous !== account.id) await stopProfile(previous);
            if (shuttingDown || epoch !== selectionEpoch || selectedAccountId !== account.id) return;
            if (previous !== account.id) await stopProfile(account.id);
            if (!shuttingDown && epoch === selectionEpoch && selectedAccountId === account.id && !sessionBusy(account.id)) await background.refresh(account.id);
          })().catch(() => {});
          data = { selectedAccountId }; break;
        }
        case 'rsi.background': store.account(cmd.accountId); data = background.snapshot(cmd.accountId, cmd.knownRevision); break;
        case 'rsi.refresh': store.account(cmd.accountId); if (!shuttingDown && !sessionBusy(cmd.accountId)) void background.refresh(cmd.accountId); data = background.snapshot(cmd.accountId); break;
        case 'rsi.upgradeHistory': {
          const permitted = () => !shuttingDown && !sessionBusy(cmd.accountId) &&
            mayReadUpgradeHistory(selectedAccountId, store.inventory(cmd.accountId), background.snapshot(cmd.accountId).view, cmd);
          if (!permitted()) { data = { status: 'unavailable', steps: [], partial: false }; break; }
          const epoch = selectionEpoch;
          const result = await upgradeHistory.read(cmd.accountId, Number(cmd.pledgeId), cmd.revision);
          data = epoch === selectionEpoch && permitted() ? result : { status: 'cancelled', steps: [], partial: false };
          break;
        }
        case 'inventory': data = store.inventory(cmd.accountId); break;
        case 'import.choose': {
          store.account(cmd.accountId);
          const selected = await dialog.showOpenDialog(win, { title: 'Hangar-JSON zur Vorschau auswählen', filters: [{ name: 'JSON-Dateien', extensions: ['json'] }], properties: ['openFile'] });
          if (selected.canceled || !selected.filePaths[0]) { data = null; break; }
          const selectedFile = selected.filePaths[0]; const fd = fs.openSync(selectedFile, 'r');
          try {
            const size = fs.fstatSync(fd).size;
            if (size > MAX_FILE_BYTES || size < 2) throw new UserError('Dateigröße ungültig. Maximal 20 MiB JSON.');
            // Fixed-size read also bounds a file growing after fstat.
            const buffer = Buffer.alloc(size); const count = fs.readSync(fd, buffer, 0, size, 0);
            if (count !== size || fs.fstatSync(fd).size !== size) throw new UserError('Datei wurde während des Lesens geändert.');
            data = stage(cmd.accountId, parseImport(buffer));
          } finally { fs.closeSync(fd); }
          break;
        }
        case 'import.demo': data = stage(cmd.accountId, parseImport(fs.readFileSync(path.join(__dirname, 'demo-inventory.json')))); break;
        case 'import.commit': {
          const p = pending.get(cmd.token);
          if (!p || p.accountId !== cmd.accountId || p.expires < Date.now()) throw new UserError('Vorschau abgelaufen oder gehört zu einem anderen Profil. Datei erneut prüfen.');
          data = store.commit(cmd.accountId, p.candidate, cmd.bindingConfirmed); pending.delete(cmd.token); break;
        }
        case 'import.cancel': pending.delete(cmd.token); data = null; break;
        case 'rsi.open': {
          if (store.account(cmd.accountId).mode !== 'real') throw new UserError('RSI-Anmeldung nur für ein Echtdaten-Profil öffnen.');
          const task = beginInteractive(cmd.accountId);
          const marker = { cancelled: false, done: task.done, finish: () => {} };
          const abort = () => { marker.cancelled = true; };
          task.controller.signal.addEventListener('abort', abort, { once: true });
          try {
            await prepareInteractive(cmd.accountId, task);
            data = await login.open(cmd.accountId, win, cmd.remember, false, marker);
            ensureInteractive(cmd.accountId, task);
          } finally { task.controller.signal.removeEventListener('abort', abort); finishInteractive(cmd.accountId, task); }
          break;
        }
        case 'rsi.connect': {
          if (store.account(cmd.accountId).mode !== 'real') throw new UserError('RSI-Verbindung nur für ein Echtdaten-Profil öffnen.');
          const task = beginInteractive(cmd.accountId);
          try {
            await prepareInteractive(cmd.accountId, task);
            const candidate = await login.connect(cmd.accountId, win, cmd.remember, { signal: task.controller.signal });
            ensureInteractive(cmd.accountId, task);
            data = stage(cmd.accountId, candidate);
            if (win.isVisible() && !win.isMinimized()) win.focus();
          } finally { finishInteractive(cmd.accountId, task); }
          break;
        }
        case 'rsi.authorize': {
          if (store.account(cmd.accountId).mode !== 'real') throw new UserError('RSI-Anmeldung nur für ein Echtdaten-Profil öffnen.');
          const task = beginInteractive(cmd.accountId);
          try {
            await prepareInteractive(cmd.accountId, task);
            const candidate = await login.connect(cmd.accountId, win, cmd.remember, { hideHangar: true, signal: task.controller.signal });
            ensureInteractive(cmd.accountId, task);
            background.observe(cmd.accountId, candidate);
          } finally { try { await login.close(cmd.accountId); } finally { finishInteractive(cmd.accountId, task); } }
          data = background.snapshot(cmd.accountId);
          if (win.isVisible() && !win.isMinimized()) win.focus();
          break;
        }
        case 'rsi.status': store.account(cmd.accountId); data = login.status(cmd.accountId); break;
        case 'rsi.probe': {
          store.account(cmd.accountId);
          if (revokingSessions.has(cmd.accountId)) throw new UserError('Die gespeicherte RSI-Sitzung wird gerade gelöscht.');
          data = stage(cmd.accountId, await login.probe(cmd.accountId)); break;
        }
        case 'rsi.close': store.account(cmd.accountId); await stopProfile(cmd.accountId); data = null; break;
        case 'rsi.settings': store.account(cmd.accountId); data = await login.settings(cmd.accountId); break;
        case 'rsi.delete': {
          const account = store.account(cmd.accountId);
          const answer = await dialog.showMessageBox(win, { type: 'question', buttons: ['Abbrechen', 'Gespeicherte Sitzung löschen'],
            defaultId: 0, cancelId: 0, title: 'RSI-Sitzung löschen', message: `Gespeicherte Anmeldung für „${account.name}“ löschen?`,
            detail: 'Das RSI-Fenster wird geschlossen. Beim nächsten Öffnen ist eine neue Anmeldung erforderlich. Inventar und Sicherungen bleiben erhalten.' });
          if (answer.response === 1) {
            let revocation = revokingSessions.get(cmd.accountId);
            if (!revocation) {
              revocation = Promise.resolve().then(async () => {
                await stopProfile(cmd.accountId);
                await login.remove(cmd.accountId);
              }).finally(() => revokingSessions.delete(cmd.accountId));
              revokingSessions.set(cmd.accountId, revocation);
            }
            await revocation;
          }
          data = { deleted: answer.response === 1 }; break;
        }
        case 'export': {
          const document = store.export(cmd.accountId);
          const target = await dialog.showSaveDialog(win, { title: 'Inventar exportieren – enthält Konto- und Bestandsdaten, keine Sitzungen',
            defaultPath: 'Sarevocs-CCU-Inventar.json', filters: [{ name: 'Inventar JSON', extensions: ['json'] }] });
          if (target.canceled || !target.filePath) { data = null; break; }
          const backup = store.backup(); fs.writeFileSync(target.filePath, JSON.stringify(document, null, 2) + '\n', { flag: 'wx' });
          data = { exported: true, backup }; break;
        }
      }
      return { ok: true, data };
    } catch (error) {
      return { ok: false, error: error instanceof UserError ? error.message : 'Vorgang fehlgeschlagen. Daten wurden nicht stillschweigend ersetzt. Datei, Schreibrechte und freien Speicher prüfen.' };
    }
  });
  await win.loadFile(uiFile);
  desktop!.ready();
  market.start();
  loaners.start();
  pricing.start();
  inventoryRefresh.start();
}
app.whenReady().then(start).catch(() => {
  desktop?.destroy(); store?.close();
  dialog.showErrorBox(APP_NAME, 'Lokale Datenbank oder Programmdateien konnten nicht geöffnet werden. Keine automatische Neuinitialisierung.'); app.exit(1);
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', event => {
  if (!single || shutdownComplete) return;
  event.preventDefault();
  if (shuttingDown) return;
  shuttingDown = true; pending.clear();reports.clear();closeReportWindows();
  inventoryRefresh?.close();
  market?.close();
  paints?.close();
  loaners?.close();
  pricing?.close();
  for (const task of interactive.values()) task.controller.abort();
  const finishing = [...interactive.values()].map(task => task.done).concat([...revokingSessions.values()]);
  void Promise.all([background?.shutdown(), login.shutdown(), Promise.allSettled(finishing), upgradeHistory.shutdown()]).then(([, ok]) => {
    if (!ok) dialog.showErrorBox(APP_NAME, 'Mindestens eine Sitzung konnte nicht sicher gespeichert werden. Es gab keine Klartext-Ersatzspeicherung. Eine erneute RSI-Anmeldung kann erforderlich sein.');
  }).finally(() => { shutdownComplete = true; app.quit(); });
});
app.on('will-quit', () => { try { store?.close(); } finally { desktop?.destroy(); } });
