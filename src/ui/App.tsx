import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {ExportDialog} from './ExportDialog';
import type {ExportContext,ReportKind} from '../export/model';
import { createRoot } from 'react-dom/client';
import { APP_VERSION, type Account, type AccountInventory, type Insurance, type Pledge, type Preview } from '../domain/model';
import {hasInventoryReadIssue} from '../domain/inventory-issues';
import type { BridgeResult, Command } from '../main/commands';
import type { BackgroundSnapshot } from '../main/background-inventory';
import type { LastSeen } from '../storage/last-seen';
import type { UpgradeHistoryResult } from '../domain/upgrade-history';
import { HistoryTooltipCache, historyKey, upgradeHistoryTitle } from './upgrade-history';
import { gameAccessEvidence } from '../domain/game-access';
import {gameContentKind} from '../domain/game-content';
import {gameAccessAssignment,hasProtectedGameAccess} from '../domain/game-access-assignment';
import { gameAccessRowStatus, gameAccessTitle, hasGameAccess } from './game-access';
import { ccuInsuranceDisplay } from './ccu-insurance';
import { gameCopyLabel, gamePackageModelLabel, NPC_UNCONFIRMED_LABEL, npcEvidenceNote } from './game-packages';
import './app.css';
import './brand-layout.css';
import { MarketView } from './MarketView';
import { SettingsView } from './SettingsView';
import { HelpView } from './HelpView';
import { SupportButtons } from './SupportButtons';
import { MenuIcon } from './MenuIcon';
import { DEFAULT_DISPLAY_SETTINGS, type PricingSnapshot, type DisplaySettings } from '../pricing/model';
import { LanguageContext, translate, useText } from './i18n';
import { LoanerTable } from './LoanerTable';
import { BuybackTable } from './BuybackTable';
import {ShipValueTable} from './ShipValueTable';
import {PaintAdvisor} from './PaintAdvisor';
import {ProfileDialog} from './ProfileDialog';
import {StoreCreditBadge} from './StoreCreditBadge';
import {pledgeDateLabel,comparePledgeDates} from '../domain/pledge-date';
import type { LoanerSnapshot } from '../loaners/model';
declare global { interface Window { ccu: { request(command: Command): Promise<BridgeResult> } } }
type State = { accounts: Account[]; selectedAccountId: string | null; dataDir: string; version: string; packaged: boolean; electron: string; node: string };
type LoginSettings = { available: boolean; saved: boolean; stored: boolean; directory: string; sessionOpen: boolean; error: string | null };
const navigation = [
  ['inventory','Bestand'], ['market','CCU-Planer'], ['paints','Paint-Berater'],
  ['fleet','Flottenplan'], ['settings','Daten & Einstellungen'], ['help','Hilfe & Einstieg'],
] as const;
async function call<T>(command: Command): Promise<T> {
  const result = await window.ccu.request(command);
  if (!result.ok) throw new Error(result.error);
  return result.data as T;
}
function insuranceLabel(insurance: Insurance) {
  return insurance.kind === 'lti' ? 'LTI · belegt' : insurance.kind === 'months' ? `${insurance.months} Monate` : 'Unbekannt';
}
function sourceLabel(adapter: string) {
  return adapter === 'sarevocs-json/1' ? 'Eigener JSON-Import' : adapter === 'hangarlink-v2/1' ? 'HangarLink-Datei' : adapter === 'rsi-dom-probe/1' ? 'RSI-Hangarleser' : 'Unbekannte Quelle';
}
function moneyLabel(minor: number, currency: string) {
  const value = BigInt(minor); return `${value / 100n},${(value % 100n).toString().padStart(2, '0')} ${currency}`;
}
function unresolvedUpgrade(pledge: Pledge) { return pledge.sourceValues.upgradeState === 'unresolved'; }
function currentInventoryName(pledge: Pledge, shipFilter = false) {
  return pledge.ships.length && (shipFilter || !pledge.ccus.length && !unresolvedUpgrade(pledge))
    ? pledge.ships.map(ship => ship.modelName).join(', ') : pledge.name;
}
function GameAccessCrown() { const t = useText();
  return <svg role="img" aria-label={t("Spielkopie im Pledge")} viewBox="0 0 16 16" width="14" height="14"
    style={{ color: '#e0ba62', marginRight: 6, verticalAlign: '-2px', flexShrink: 0 }}>
    <path fill="currentColor" d="M1.5 4.5 5 7.5 8 2l3 5.5 3.5-3-1.3 7H2.8zM3 13h10v1.3H3z" />
  </svg>;
}
function observedLabel(value?: string) {
  if (!value) return null;
  const at = new Date(value); if (!Number.isFinite(at.getTime())) return null;
  return at.toDateString() === new Date().toDateString()
    ? `heute ${new Intl.DateTimeFormat('de-DE', { timeStyle: 'short' }).format(at)}`
    : new Intl.DateTimeFormat('de-DE', { dateStyle: 'short', timeStyle: 'short' }).format(at);
}
function App() {
  const [page, setPage] = useState<'inventory' | 'market' | 'fleet' | 'paints' | 'settings' | 'help'>('inventory');
  const [state, setState] = useState<State>();
  const [display, setDisplay] = useState<PricingSnapshot>({ settings: { ...DEFAULT_DISPLAY_SETTINGS }, configured: true, settingsError: false, rate: null, pending: false, rateError: false });
  const t = (text: string) => translate(display.settings.language, text);
  useEffect(() => { let active = true, first = true, timer: ReturnType<typeof setTimeout>;
    const poll = async () => { try { const data = await call<PricingSnapshot>({ action: 'pricing.status' }); if (active) { setDisplay(previous=>JSON.stringify(previous)===JSON.stringify(data)?previous:data); if (first && !data.configured) setPage('settings'); first = false; } } catch { /* A failed preferences read never starts RSI authentication. */ }
      if (active) timer = setTimeout(() => void poll(), 1500); };
    void poll(); return () => { active = false; clearTimeout(timer); };
  }, []);
  async function saveDisplay(settings: DisplaySettings) { const saved = await call<DisplaySettings>({ action: 'pricing.save', settings }); setDisplay(value => ({ ...value, settings: saved, configured: true, settingsError: false })); }
  useEffect(() => { document.documentElement.lang = display.settings.language; }, [display.settings.language]);
  const [accountId, setAccountId] = useState('');
  const [exportKind,setExportKind]=useState<ReportKind|null>(null),[exportContext,setExportContext]=useState<ExportContext>(null),[exportNotice,setExportNotice]=useState('');
  const receiveExportContext=useCallback((context:ExportContext)=>setExportContext(previous=>JSON.stringify(previous)===JSON.stringify(context)?previous:context),[]);
  useEffect(()=>{setExportKind(null);setExportContext(null);setExportNotice('');},[accountId]);
  const [inventory, setInventory] = useState<AccountInventory>();
  const [filter, setFilter] = useState('CCUs');
  const [loanerSnapshot, setLoanerSnapshot] = useState<LoanerSnapshot>({ data: null, pending: false, error: false });
  useEffect(() => {
    if (page !== 'inventory' || filter !== 'Loaner & Beiboote') return;
    let active = true, timer: ReturnType<typeof setTimeout>;
    const poll = async () => { try { const snapshot = await call<LoanerSnapshot>({ action: 'loaners.status' }); if (active) setLoanerSnapshot(snapshot); }
      catch { if (active) setLoanerSnapshot(s => ({ ...s, pending: false, error: true })); }
      if (active) timer = setTimeout(() => void poll(), 1500); };
    void poll(); return () => { active = false; clearTimeout(timer); };
  }, [page, filter]);
  const [lastSeen, setLastSeen] = useState<LastSeen | null>(null);
  const [backgroundStatus, setBackgroundStatus] = useState<BackgroundSnapshot['status']>('idle');
  const [backgroundPending, setBackgroundPending] = useState(false);
  const selectedAccount = useRef(''); const selectionEpoch = useRef(0);
  const backgroundEpoch = useRef(0); const knownRevision = useRef<string | undefined>(undefined);
  const historyTooltips = useRef(new HistoryTooltipCache());
  const [, redrawHistory] = useState(0);
  const statusRef = useRef<BackgroundSnapshot['status']>('idle'); const pendingRef = useRef(false);
  const [open, setOpen] = useState(false); const dialog = useRef<HTMLDialogElement>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [profileOpen,setProfileOpen]=useState(false);const profileIntent=useRef<'profile'|'import'>('profile');
  const [binding, setBinding] = useState(false); const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [message, setMessage] = useState('');
  const [loginProfile, setLoginProfile] = useState<Account | null>(null);
  const [loginSettings, setLoginSettings] = useState<LoginSettings>();
  const [remember, setRemember] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const loginCancelled = useRef(false);
  const loginDialog = useRef<HTMLDialogElement>(null);
  async function refresh() { const next = await call<State>({ action: 'state' }); setState(next); return next; }
  async function run(fn: () => Promise<void>) {
    setBusy(true); setError('');
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : 'Vorgang fehlgeschlagen.'); }
    finally { setBusy(false); }
  }
  const account = state?.accounts.find(a => a.id === accountId);
  function current(id: string, epoch: number) { return selectedAccount.current === id && selectionEpoch.current === epoch; }
  function connectionStatus(status: BackgroundSnapshot['status']) { statusRef.current = status; setBackgroundStatus(status); }
  function displayAccount(id: string) {
    if (selectedAccount.current === id) return;
    selectedAccount.current = id; selectionEpoch.current++; backgroundEpoch.current++; knownRevision.current = undefined;
    historyTooltips.current.activate(id);
    pendingRef.current = false; setBackgroundPending(false); connectionStatus('idle'); setLastSeen(null);
    setAccountId(id); setMessage(''); setError('');
  }
  async function selectAccount(id: string) {
    displayAccount(id); const epoch = selectionEpoch.current;
    if (id) try { await call({ action: 'account.select', accountId: id }); }
    catch (e) { if (current(id, epoch)) setError(e instanceof Error ? e.message : 'Profil konnte nicht ausgewählt werden.'); }
  }
  function applyBackground(snapshot: BackgroundSnapshot, id: string, epoch: number) {
    if (!current(id, epoch)) return;
    if (snapshot.view && snapshot.view.accountId !== id) { connectionStatus('unavailable'); return; }
    // Equal revisions deliberately omit view; never erase a still valid cached view in that case.
    if (snapshot.view !== undefined) setLastSeen(snapshot.view);
    historyTooltips.current.activate(id, snapshot.revision ?? undefined);
    knownRevision.current = snapshot.revision ?? undefined; connectionStatus(snapshot.status);
  }
  useEffect(() => {
    let active = true;
    void call<State>({ action: 'state' }).then(next => {
      if (!active) return;
      setState(next); if (selectionEpoch.current === 0) displayAccount(next.selectedAccountId ?? next.accounts[0]?.id ?? '');
    }).catch(e => { if (active) setError(e instanceof Error ? e.message : 'Programmzustand konnte nicht geladen werden.'); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    let active = true; const epoch = selectionEpoch.current;
    setInventory(undefined);
    if (accountId) void call<AccountInventory>({ action: 'inventory', accountId }).then(data => {
      if (active && current(accountId, epoch) && data.account.id === accountId) setInventory(data);
    }).catch(e => { if (active && current(accountId, epoch)) setError(e.message); });
    return () => { active = false; };
  }, [accountId]);
  useEffect(() => {
    if (!accountId || account?.mode !== 'real') return;
    let active = true; let timer: ReturnType<typeof setTimeout> | undefined;
    const epoch = selectionEpoch.current;
    async function poll() {
      const requestEpoch = backgroundEpoch.current;
      try {
        const snapshot = await call<BackgroundSnapshot>({ action: 'rsi.background', accountId,
          ...(knownRevision.current ? { knownRevision: knownRevision.current } : {}) });
        if (active && current(accountId, epoch) && requestEpoch === backgroundEpoch.current) applyBackground(snapshot, accountId, epoch);
      } catch {
        if (active && current(accountId, epoch) && requestEpoch === backgroundEpoch.current) connectionStatus('unavailable');
      } finally {
        if (active && current(accountId, epoch)) timer = setTimeout(() => void poll(), statusRef.current === 'connecting' || pendingRef.current ? 1000 : 3000);
      }
    }
    void poll();
    return () => { active = false; if (timer) clearTimeout(timer); };
  }, [accountId, account?.mode, backgroundPending]);
  useEffect(() => { if (open && !dialog.current?.open) dialog.current?.showModal(); if (!open) dialog.current?.close(); }, [open]);
  useEffect(() => { if (loginProfile && !loginDialog.current?.open) loginDialog.current?.showModal(); if (!loginProfile) loginDialog.current?.close(); }, [loginProfile]);
  const acceptedInventory = inventory?.account.id === accountId ? inventory : undefined;
  const latestAcceptedAt = acceptedInventory?.items.reduce((latest, item) => Math.max(latest, Date.parse(item.importedAt) || 0),
    Date.parse(acceptedInventory.account.lastComplete ?? '') || 0) ?? 0;
  const observed = account?.mode === 'real' && lastSeen?.accountId === accountId && Date.parse(lastSeen.observedAt) > latestAcceptedAt ? lastSeen : null;
  const liveBuybacks = account?.mode === 'real' && lastSeen?.accountId === accountId && lastSeen.document.buybackObservation
    && (!account.reference || (account.reference === lastSeen.document.account.reference && account.identityKind === lastSeen.document.account.identityKind)) ? lastSeen.document : null;
  const viewingBuybacks = page === 'inventory' && filter === 'Buy Back';
  async function loadUpgradeHistory(pledge: Pledge) {
    const key = historyKey(pledge, account, observed), epoch = selectionEpoch.current;
    if (!key || !current(key.accountId, epoch) || knownRevision.current !== key.revision) return;
    const ticket = historyTooltips.current.begin(key); if (!ticket) return;
    redrawHistory(value => value + 1);
    let result: UpgradeHistoryResult;
    try { result = await call<UpgradeHistoryResult>({ action: 'rsi.upgradeHistory', ...key }); }
    catch { result = { status: 'unavailable', steps: [], partial: false }; }
    if (!current(key.accountId, epoch) || knownRevision.current !== key.revision) return;
    if (historyTooltips.current.finish(ticket, result)) redrawHistory(value => value + 1);
  }
  const present = observed ? observed.document.pledges.map(pledge => ({ pledge, availability: 'present' as const,
    source: 'rsi-dom-probe/1', importedAt: observed.observedAt })) : acceptedInventory?.items.filter(x => x.availability === 'present') ?? [];
  const plannerInventory = useMemo(() => observed ? { accountId, pledges: observed.document.pledges,
    observation: { kind: 'rsi-hangar' as const, observedAt: observed.observedAt } }
    : acceptedInventory ? { accountId, pledges: acceptedInventory.items.filter(x => x.availability === 'present').map(x => x.pledge),
      observation: { kind: 'rsi-imports' as const, observations: Object.fromEntries(acceptedInventory.items
        .filter(x => x.availability === 'present' && x.source === 'rsi-dom-probe/1').map(x => [x.pledge.pledgeId, x.importedAt])) } } : null,
    [observed, acceptedInventory, accountId]);
  const lti = present.filter(x => x.pledge.insurance.kind === 'lti').flatMap(x => x.pledge.ships).length;
  const shipCount = present.reduce((count, x) => count + x.pledge.ships.length, 0);
  const ccus = present.reduce((count, x) => count + x.pledge.ccus.length + (unresolvedUpgrade(x.pledge) ? 1 : 0), 0);
  const unresolved = present.filter(x => hasInventoryReadIssue(x.pledge)).length;
  const visible = present.filter(x => filter === 'Alle Gegenstände' ||
    (filter === 'Spielpakete' && gameContentKind(x.pledge)==='package') ||
    (filter === 'Spielzugänge' && hasProtectedGameAccess(x.pledge,x.source)) ||
    (filter === 'Schiffe & Fahrzeuge' && x.pledge.ships.length > 0) ||
    (filter === 'CCUs' && (x.pledge.ccus.length > 0 || unresolvedUpgrade(x.pledge)))).sort((a,b)=>comparePledgeDates(a.pledge,b.pledge));
  const connectionBusy = backgroundPending || backgroundStatus === 'connecting';
  const stand = observedLabel(observed?.observedAt ?? (latestAcceptedAt ? new Date(latestAcceptedAt).toISOString() : undefined));
  const connectionText = !account ? 'Kein Kontoprofil' : account.mode === 'demo' ? 'Demobestand · lokal'
    : connectionBusy ? 'Wird aktualisiert …'
    : `${backgroundStatus === 'connected' ? 'Verbunden' : backgroundStatus === 'auth-required' ? 'Anmeldung nötig'
      : backgroundStatus === 'unavailable' ? 'Nicht erreichbar' : 'Lokal gespeichert'}${stand ? ` · Stand ${stand}` : ''}`;
  async function updateBackground(authorize = false, keepSession = true) {
    if (!account || account.mode !== 'real') return false;
    const id = account.id, epoch = selectionEpoch.current;
    backgroundEpoch.current++; pendingRef.current = true; setBackgroundPending(true); connectionStatus('connecting'); setError('');
    try {
      const snapshot = await call<BackgroundSnapshot>(authorize ? { action: 'rsi.authorize', accountId: id, remember: keepSession } : { action: 'rsi.refresh', accountId: id });
      if (current(id, epoch)) { backgroundEpoch.current++; applyBackground(snapshot, id, epoch); return true; }
      return false;
    } catch (e) {
      if (current(id, epoch)) { backgroundEpoch.current++; connectionStatus(authorize ? 'auth-required' : 'unavailable'); setError(e instanceof Error ? e.message : 'Verbindung konnte nicht aktualisiert werden.'); }
      return false;
    } finally {
      if (current(id, epoch)) { pendingRef.current = false; setBackgroundPending(false); }
    }
  }
  async function updatePlanner() {
    await run(async () => {
      await Promise.all([call({ action: 'market.refresh' }), account?.mode === 'real' ? updateBackground(false) : Promise.resolve()]);
    });
  }
  async function createProfile(name:string) {
    const created=await call<Account>({action:'account.create',name,mode:'real'});
    // Creation is committed at this point. A later selection failure must never offer creation again.
    setState(before=>before?{...before,accounts:[...before.accounts.filter(a=>a.id!==created.id),created]}:before);
    try{await call({action:'account.select',accountId:created.id});displayAccount(created.id);setState(before=>before?{...before,selectedAccountId:created.id}:before);setMessage(t('Profil angelegt. Du kannst jetzt verbinden oder eine Datei importieren.'));}
    catch{setError(t('Profil angelegt. Bitte oben auswählen; die Auswahl konnte nicht abgeschlossen werden.'));}
    return created.id;
  }
  function addProfile(intent:'profile'|'import'='profile'){profileIntent.current=intent;setError('');setProfileOpen(true);}
  async function chooseImport(id:string){const next=await call<Preview|null>({action:'import.choose',accountId:id});if(next)showPreview(next);}
  function showPreview(p: Preview | null) { if(!p)return;setPreview(p); setBinding(false); setReviewed(false); setOpen(true); }
  async function cancel() {
    if (preview) await call({ action: 'import.cancel', token: preview.token });
    setPreview(null); setOpen(false); setError('');
  }
  async function demo() {
    let selected = state?.accounts.find(a => a.mode === 'demo');
    if (!selected) selected = await call<Account>({ action: 'account.create', name: 'Demo – synthetischer Bestand', mode: 'demo' });
    await refresh(); await selectAccount(selected.id);
    showPreview(await call<Preview>({ action: 'import.demo', accountId: selected.id }));
  }
  async function commit() {
    if (!preview) return;
    const result = await call<{ repeated: boolean }>({ action: 'import.commit', accountId: preview.accountId, token: preview.token, bindingConfirmed: binding, reviewed: true });
    const data = await call<AccountInventory>({ action: 'inventory', accountId: preview.accountId });
    if (selectedAccount.current === preview.accountId) setInventory(data); await refresh();
    setPreview(null); setOpen(false); setMessage(result.repeated ? 'Diese Datei wurde bereits übernommen. Keine Duplikate angelegt.' : 'Geprüfter Bestand lokal übernommen.');
  }
  async function rsi() {
    if (!account) return;
    const id = account.id, epoch = selectionEpoch.current;
    loginCancelled.current = false;
    const settings = await call<LoginSettings>({ action: 'rsi.settings', accountId: id });
    if (current(id, epoch)) { setLoginSettings(settings); setLoginProfile(account); }
  }
  async function connect() {
    if (!loginProfile) return;
    loginCancelled.current = false; setConnecting(true);
    try {
      const connected = await updateBackground(true, remember);
      if (connected && !loginCancelled.current) setLoginProfile(null);
    } catch (e) { if (!loginCancelled.current) throw e; }
    finally { setConnecting(false); }
  }
  async function closeLogin() {
    if (connecting && loginProfile) {
      loginCancelled.current = true;
      await call({ action: 'rsi.close', accountId: loginProfile.id });
    }
    setLoginProfile(null); setError('');
  }
  const storeCredit = account?.mode === 'real' && observed?.accountId === accountId ? observed.document.storeCredit : undefined;
  return <LanguageContext.Provider value={display.settings.language}><>
    <aside>
      <div className="brand">
        <img src="app.png" alt="" />
        <span className="brand-title"><span className="brand-name">Sarevoc´s</span><br /><span className="brand-subtitle">CCU Planer</span></span>
        <p className="fan-notice">
          <strong>{t('Inoffizielles Fanprojekt für Star Citizen')}</strong>{' '}
          {t('Unabhängig von Cloud Imperium Games und Roberts Space Industries.')}
        </p>
      </div>
      <nav aria-label={t('Hauptbereiche')}>{navigation.map(([id,label])=>
        <button key={id} type="button" data-menu={id} className={page===id?'active':''} aria-current={page===id?'page':undefined}
          onClick={()=>{setPage(id);window.scrollTo(0,0);}}><MenuIcon page={id}/><span>{t(label)}</span></button>
      )}</nav>
      <footer>{t('Bestand & Angebote')} · v{state?.version ?? APP_VERSION}<br />● &nbsp; {t('Lokal gespeichert')}<br />{t('Lokale Kettenvorschau')}<SupportButtons /></footer>
    </aside>
    <main>{page !== 'help' && <section className="connection-line" aria-label={t("Profil und Verbindung")}>
      <div className="profile-control"><select aria-label={t("Lokales Kontoprofil")} value={accountId} disabled={busy} onChange={e => void selectAccount(e.target.value)}>
        {!state?.accounts.length && <option value="">{t("Noch kein Kontoprofil")}</option>}
        {state?.accounts.map(a => <option key={a.id} value={a.id}>{a.name}{a.mode === 'demo' ? ' · Demo' : ''}</option>)}</select></div>
      <div className="connection-profile-status">
        <div className={'connection-status ' + (connectionBusy ? 'pending' : backgroundStatus)} role="status"><span className="status-dot" aria-hidden="true" /><span>{t(connectionText)}</span></div>
        <button type="button" className="secondary add-profile" disabled={busy||!state} onClick={() => addProfile()}>{t('Benutzer anlegen')}</button>
      </div>
      <div className="connection-actions"><button className="primary" disabled={busy || (page === 'market' && connectionBusy) || (page === 'inventory' && (filter === 'Loaner & Beiboote' ? loanerSnapshot.pending : !account || account.mode !== 'real' || connectionBusy))}
        onClick={() => page === 'paints' ? void call({action:'paints.refresh'}).catch(()=>setError('Paint-Preise konnten nicht gelesen werden.')) : page === 'inventory' && filter === 'Loaner & Beiboote' ? void call<LoanerSnapshot>({ action: 'loaners.refresh' }).then(setLoanerSnapshot).catch(() => setLoanerSnapshot(s => ({ ...s, error: true }))) : page === 'market' ? void updatePlanner() : page !== 'inventory' ? void call({ action: 'market.refresh' }).catch(() => setError('Marktdaten konnten nicht aktualisiert werden.')) : void updateBackground(!viewingBuybacks && backgroundStatus === 'auth-required')}>{t(page === 'inventory' && !viewingBuybacks && filter !== 'Loaner & Beiboote' && backgroundStatus === 'auth-required' && !connectionBusy ? 'Anmelden' : 'Aktualisieren')}</button>
      </div>
    </section>}
      {page === 'help' && <HelpView />}
      {(page === 'market' || page === 'fleet') && <MarketView accountId={accountId || null} display={display} inventory={plannerInventory} storeCredit={storeCredit}
        buybacks={liveBuybacks?.buybacks ?? acceptedInventory?.buybacks ?? []} buybackObservation={liveBuybacks?.buybackObservation}
        fleet={page === 'fleet'} onOpenPlanner={() => { setPage('market'); window.scrollTo(0, 0); }}
        onExportContext={receiveExportContext} onExport={()=>setExportKind(exportContext?.accountId===accountId?'chain':'offers')}/>}
      {page==='paints'&&<PaintAdvisor rows={present} display={display}/>}
      {page === 'settings' && <SettingsView display={display} onSave={saveDisplay} dataDir={state?.dataDir ?? ''} />}
      {page === 'inventory' && <>
      <header>
        <div><div className="eyebrow">{t("DEIN HANGAR. DEINE ENTSCHEIDUNG.")}</div><h1>{t("Bestand")}</h1><p>{t("Schiffe, Fahrzeuge und CCUs pro Konto – mit nachvollziehbarer Herkunft.")}</p></div>
        <div className="inventory-header-actions">
          {account?.mode==='real'&&<StoreCreditBadge credit={storeCredit} language={display.settings.language}/>}
          <button className="export-open" disabled={!accountId} onClick={()=>setExportKind(
            filter==='CCUs'?'ccus':filter==='Spielpakete'?'packages':filter==='Spielzugänge'?'access':filter==='Buy Back'?'buyback':filter==='Loaner & Beiboote'?'loaners':'ships'
          )}>{t('Exportieren …')}</button>
        </div>
      </header>
      <div className={'notice ' + (account?.mode === 'demo' ? 'demo' : '')}>
        <b>{observed ? 'Zuletzt gelesener Bestand' : account?.mode === 'demo' ? 'DEMO · synthetischer Bestand' : account ? 'Lokaler Kontobestand' : 'Noch kein Bestand importiert'}</b>
        <span>{observed ? `${observed.document.account.identityKind === 'manual-reference' ? 'Zuordnung ungeprüft · ' : ''}noch nicht übernommen`
          : account?.identityStatus === 'manual-confirmed' ? 'Kontozuordnung manuell bestätigt · lokal übernommen' : 'Noch keine Kontozuordnung bestätigt'}</span></div>
      {error && !open && !loginProfile && <div role="alert" className="error">{error}</div>}
      {message && <p role="status" className="message">{message}</p>}
      <div className="stats"><div className="stat"><label>{t("Schiffe & Fahrzeuge")}</label><strong>{shipCount}</strong><small>{t('davon')} {lti} {t('mit LTI')}</small></div>
        <div className="stat"><label>{t("Erkannte CCUs")}</label><strong>{ccus}</strong><small>{t("Einzelne Exemplare · ungeprüfte bleiben erkennbar")}</small></div>
        <div className="stat"><label>{t("Noch zu prüfen")}</label><strong>{unresolved}</strong><small>{t("Lesefehler oder Zuordnungsprobleme")}</small></div></div>
      <section className="panel"><div className="panel-head"><div><h2>{t("Schiffe, Fahrzeuge & CCUs")}</h2><div className="filters" aria-label={t("Bestandsfilter")}>
        {['Alle Gegenstände', 'Schiffe & Fahrzeuge', 'CCUs', 'Spielpakete', 'Spielzugänge', 'Buy Back', 'Loaner & Beiboote'].map(f => <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>{t(f)}</button>)}</div></div>
        <div className="actions"><button className="secondary" disabled={busy||!state} onClick={() => accountId?void run(()=>chooseImport(accountId)):addProfile('import')}>{t("Datei importieren")}</button></div></div>
        {viewingBuybacks ? <BuybackTable entries={liveBuybacks?.buybacks ?? acceptedInventory?.buybacks ?? []} observation={liveBuybacks?.buybackObservation} display={display} balance={storeCredit} />
          : filter === 'Loaner & Beiboote' ? <LoanerTable accountId={accountId||null} pledges={present.map(x => x.pledge)} snapshot={loanerSnapshot} /> : <ShipValueTable key={accountId} accountId={accountId} rows={visible} emptyText={filter==='Spielzugänge'&&present.some(x=>gameAccessAssignment(x.pledge,x.source).state!=='observed')?t('RSI-Zugangsmarkierungen im gespeicherten Stand noch nicht erfasst. Bestand aktualisieren.'):undefined} display={display} demo={account?.mode==='demo'} view={filter==='Schiffe & Fahrzeuge'?'ships':filter==='CCUs'?'ccus':filter==='Spielpakete'?'packages':filter==='Spielzugänge'?'access':'all'} sourceLabel={sourceLabel} onHistory={p=>void loadUpgradeHistory(p)} crownFor={p=>hasGameAccess(gameAccessEvidence(p))?<GameAccessCrown/>:null} statusFor={p=>gameAccessRowStatus(p,gameAccessEvidence(p))} titleFor={p=>{const key=historyKey(p,account,observed);return gameAccessTitle(p,upgradeHistoryTitle(p,!!key,key?historyTooltips.current.get(key):undefined),gameAccessEvidence(p));}}/>}</section>
      <section className="panel import"><div><h2>{t("Erst prüfen, dann übernehmen")}</h2><p>{t("Die Importvorschau zeigt Umfang, Kontozuordnung und Änderungen. Ein unvollständiger Import entfernt keine vorhandenen Gegenstände.")}</p></div>
        <button disabled={busy} onClick={() => void run(demo)}>{t("Demo-Datei ansehen")}</button></section>
      <div className="bottom" id="data-location"><span>Letzter vollständiger Import: {account?.lastComplete ? new Intl.DateTimeFormat('de-DE', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Berlin' }).format(new Date(account.lastComplete)) : 'noch keiner'}<br />Datenordner: {state?.dataDir ?? 'wird geladen'}</span>
        <span><button className="text-button" disabled={busy || !account?.reference} onClick={() => void run(async () => { const r = await call<{ exported: boolean; backup: string } | null>({ action: 'export', accountId }); if (r) setMessage(`Inventar exportiert. Konsistente Datenbanksicherung: ${r.backup}`); })}>{t("Sicherung / Export")}</button>
          <button className="text-button" disabled={busy || !account || account.mode !== 'real'} onClick={() => void run(rsi)}>{t("Sitzung & Sicherheit")}</button>
          <button className="text-button" disabled title={t("Tuning-Werkstatt folgt; keine produktiven Einstellungen")}>{t("UI-Werkstatt")}</button></span></div>
      </>}
      {exportNotice&&<p role="status">{t(exportNotice)}</p>}
    </main>
    {exportKind&&accountId&&<ExportDialog accountId={accountId} initialKind={exportKind} chainContext={exportContext} onClose={()=>setExportKind(null)} onSaved={()=>setExportNotice('Export gespeichert.')}/>}
    <ProfileDialog open={profileOpen} onCreate={createProfile} onClose={()=>setProfileOpen(false)} onCreated={id=>{setProfileOpen(false);if(profileIntent.current==='import'&&selectedAccount.current===id)void run(()=>chooseImport(id));}}/>
    <dialog ref={dialog} aria-labelledby="import-title" onCancel={e => { e.preventDefault(); if (!busy) void run(cancel); }}>
      <div className="eyebrow">DATEIIMPORT{preview?.dataMode === 'demo' ? ' · DEMO-VORSCHAU' : ''}</div><h1 id="import-title">{t("Bestand vor der Übernahme prüfen")}</h1>
      <p>{t("Eigenes JSON v1 oder HangarLink v2. Noch keine Daten übernommen.")}</p>
      <label>{t("Lokales Kontoprofil")}<select value={accountId} disabled={!!preview || busy} onChange={e => void selectAccount(e.target.value)}>
        {!state?.accounts.length && <option value="">{t("Zuerst ein Profil anlegen")}</option>}
        {state?.accounts.map(a => <option key={a.id} value={a.id}>{a.name} · {a.mode === 'demo' ? 'Demo' : 'Echtdaten'}</option>)}</select></label>
      {error && open && <div role="alert" className="error">{error}</div>}
      {preview && <><div className={'notice ' + (preview.dataMode === 'demo' ? 'demo' : '')}><b>{preview.dataMode === 'demo' ? 'DEMO · synthetische Datei' : 'Echtdaten · Dateiimport'}</b><span>{sourceLabel(preview.adapter)}</span></div>
        <p><b>{preview.reference.startsWith('rsi-local:') ? 'Kontozuordnung: manuell zu diesem Profil' : `Kontoreferenz: ${preview.reference}`}</b><br />{preview.pledges.length} Pledges · {preview.pledges.flatMap(p => p.ccus).length} CCU-Exemplare · {preview.buybacks.length} Buybacks separat<br />
          Vollständigkeit: {preview.completeness === 'complete' ? 'laut Datei vollständig; nicht live bei RSI geprüft' : 'teilweise oder ungeprüft; fehlende Altbestände bleiben erhalten'}</p>
        <div className="stats changes">{([['Neu', preview.changes.added], ['Geändert', preview.changes.changed], ['Fehlend', preview.changes.missing], ['Unverändert', preview.changes.unchanged]] as const).map(([label, value]) => <div key={label} className="stat"><label>{t(label)}</label><strong>{value}</strong></div>)}</div>
        {preview.warnings.map((w, i) => <p className="warning" key={i}>{w}</p>)}
        <p className="warning">{preview.completeness === 'complete' ? 'Fehlende Pledges werden bei Übernahme als nicht mehr vorhanden markiert. Historische Snapshots bleiben erhalten.' : 'Dieser Import ergänzt den Bestand. Er bestätigt keinen vollständigen aktuellen Hangar.'}</p>
        <details><summary>Gegenstände in dieser Datei ({preview.pledges.length})</summary><ul>{preview.pledges.map(p => <li key={p.pledgeId}>{p.name} · {p.pledgeId} · {t(insuranceLabel(p.insurance))}</li>)}</ul></details>
        {preview.bindingRequired && <label className="check"><input type="checkbox" checked={binding} onChange={e => setBinding(e.target.checked)} /><span>{t("Ich bestätige, dass diese Kontoreferenz zu diesem lokalen Profil gehört. Die Zuordnung ist manuell bestätigt.")}</span></label>}
        <label className="check"><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} /><span>Vorschau und Änderungen geprüft; Bestand lokal übernehmen.</span></label></>}
      <div className="dialog-actions"><button disabled={busy} onClick={() => void run(cancel)}>{t("Abbrechen")}</button>
        <button disabled={busy || !accountId} onClick={() => void run(()=>chooseImport(accountId))}>{t("Datei auswählen")}</button>
        <button className="primary" disabled={busy || !preview || !reviewed || (!!preview.bindingRequired && !binding)} onClick={() => void run(commit)}>{t("Geprüften Import übernehmen")}</button></div>
      {busy && <p role="status" className="warning">{t("Vorgang wird bearbeitet …")}</p>}
    </dialog>
    <dialog className="login-short" ref={loginDialog} aria-labelledby="login-title" onCancel={e => { e.preventDefault(); if (!busy || connecting) void closeLogin().catch(() => setError('Verbindung konnte nicht beendet werden.')); }}>
      <div className="eyebrow">{t("KONTO & ANMELDUNG")}</div><h1 id="login-title">{t("RSI verbinden")}</h1>
      <p>{loginProfile?.name}</p>
      <p className="login-instruction" role="status">{connecting ? <>{t("Das RSI-Fenster bleibt geöffnet.")}<br />{t("Der Bestand wird im Hintergrund geprüft.")}</> : <>{t("Bei RSI anmelden.")}<br />{t("Das Fenster bleibt geöffnet.")}</>}</p>
      <label className="check"><input type="checkbox" checked={remember} disabled={busy} onChange={e => setRemember(e.target.checked)} /><span>{t("Angemeldet bleiben")}</span></label>
      <details><summary>{t("Sitzung & Sicherheit")}</summary>
        <p>{t("Passwort und MFA nur direkt bei RSI.")}<br />Windows-Schutz: {loginSettings?.available ? 'verfügbar' : 'nicht verfügbar'}<br />Gespeicherte Anmeldung: {loginSettings?.saved ? 'Anmeldecookies vorhanden · Gültigkeit bestimmt RSI' : 'keine'}</p>
        <p>{t("Ohne Häkchen wird die neue Sitzung nicht gespeichert. Bereits gespeicherte Sitzungen bleiben erhalten.")}</p>
        <div className="vault-path">{loginSettings?.directory}</div>
        <button className="delete" disabled={busy || !loginSettings?.stored} onClick={() => void run(async () => {
          if (!loginProfile) return;
          const result = await call<{ deleted: boolean }>({ action: 'rsi.delete', accountId: loginProfile.id });
          if (result.deleted) { historyTooltips.current.clear(); redrawHistory(value => value + 1); }
          setLoginSettings(await call<LoginSettings>({ action: 'rsi.settings', accountId: loginProfile.id }));
        })}>{t("Gespeicherte Sitzung löschen")}</button>
      </details>
      {error && loginProfile && <div role="alert" className="error">{error}</div>}
      {loginSettings?.error && <div role="alert" className="error">{loginSettings.error}</div>}
      {remember && loginSettings && !loginSettings.available && <div role="alert" className="error">{t("Windows-Schutz nicht verfügbar. Für eine flüchtige Anmeldung „Angemeldet bleiben“ abwählen.")}</div>}
      <div className="dialog-actions login-actions"><button disabled={busy && !connecting} onClick={() => void closeLogin().catch(() => setError('Verbindung konnte nicht beendet werden.'))}>{connecting ? 'RSI schließen' : 'Schließen'}</button>
        <button className="primary" disabled={busy || (remember && !loginSettings?.available)} onClick={() => void run(connect)}>{connecting ? 'Warte auf RSI …' : 'Verbinden'}</button></div>
      <div className="desktop-preview"><img src="app.png" alt="" /><div>Sarevoc´s CCU Planer<small>{t("Eigenes Logo · Desktop-Symbol beim Installieren")}</small></div></div>
    </dialog>
  </></LanguageContext.Provider>;
}
createRoot(document.getElementById('root')!).render(<App />);
