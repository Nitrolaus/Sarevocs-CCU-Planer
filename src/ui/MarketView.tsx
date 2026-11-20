import React, { useEffect, useMemo, useRef, useState } from 'react';
import { prepareChains } from '../planner/chain';
import type {ExportContext} from '../export/model';
import type { StoreCredit } from '../domain/store-credit';
import {usePlannerDrafts} from './usePlannerDrafts';
import {useCcuExclusions} from './useCcuExclusions';
import {withoutExcludedCcus} from '../planner/exclusions';
import {selectedStartBase} from '../planner/bases';
import {analyseReservations,blockedForTarget,conflictsForTarget,DEFAULT_PRIORITIES} from '../planner/reservations';
import { fleetScenarios, planFleetRoutes } from '../planner/fleet';
import { creditBudgetLimit, type CreditBudget } from '../planner/credit-budget';
import type { Command, BridgeResult } from '../main/commands';
import { matchingOffer, offersAreStale, type CatalogueShip, type MarketSnapshot, type TargetOffer } from '../market/model';
import { searchShips } from '../market/search';
import { estimateMinor, formatMinor, euroRateIsStale } from '../pricing/money';
import type { PricingSnapshot } from '../pricing/model';
import { useText } from './i18n';
import { vatLabel } from './vat-label';
import { ChainBuilder, type PlannerInventory } from './ChainBuilder';
import {ShipPlaceholder} from './ShipPlaceholder';
import { useShopPrices } from './useShopPrices';
import {FairNewsPanel, type FairOfferRequest} from './FairNewsPanel';
import { FinaleShoppingList } from './FinaleShoppingList';
import { FleetView } from './FleetView';
import { StartBasisComparison } from './StartBasisComparison';
import type { Buyback, BuybackObservation } from '../domain/model';
import './market.css';

async function request<T>(command: Command): Promise<T> {
  const result = await window.ccu.request(command) as BridgeResult<T>;
  if (!result.ok) throw new Error(result.error); return result.data;
}
const time = (value: string | null | undefined) => value ? new Intl.DateTimeFormat('de-DE', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Berlin' }).format(new Date(value)) : 'noch nicht geladen';
const money = (value: number | null | undefined) => value == null ? 'ungeprüft' : new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'USD' }).format(value / 100);
const changeLabel = { new: 'Neu', changed: 'Geändert', current: 'Beobachtet', missing: 'Nicht mehr beobachtet' } as const;

function ShipArtwork({ship,index,onOpen}:{ship?:CatalogueShip;index:number;onOpen:()=>void}) {
  const t=useText();
  return <button type="button" className="market-image-link" disabled={!ship?.storeUrl}
    aria-label={ship?t('RSI-Shop öffnen')+': '+ship.name:t('Noch kein Ziel gewählt')}
    title={t('Öffnet die offizielle Schiffseite im Standardbrowser.')} onClick={event=>{event.stopPropagation();onOpen();}}>
    <ShipPlaceholder index={index}/>
  </button>;
}
export function MarketView({ accountId, display: settingsDisplay, inventory = null, storeCredit, buybacks = [], buybackObservation, onExport, onExportContext, fleet = false, onOpenPlanner }: {
  accountId: string | null; display: PricingSnapshot; inventory?: PlannerInventory | null; storeCredit?: StoreCredit;
  buybacks?: readonly Buyback[]; buybackObservation?: BuybackObservation;
  onExport?:()=>void; onExportContext?:(context:ExportContext)=>void; fleet?: boolean; onOpenPlanner: () => void;
}) {
  const [snapshot, setSnapshot] = useState<MarketSnapshot>();
  const display = useMemo(() => ({ ...settingsDisplay, shopPrices: snapshot?.shopPrices }), [settingsDisplay, snapshot?.shopPrices]);
  const t = useText(), preferences = display.settings;
  const time = (value: string | null | undefined) => value ? new Intl.DateTimeFormat(preferences.language === 'de' ? 'de-DE' : 'en-US', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Berlin' }).format(new Date(value)) : '—';
  const original = (value: number | null | undefined) => value == null ? t('ungeprüft') : formatMinor(value, 'USD', preferences.language);
  const money = (value: number | null | undefined) => {
    if (value == null) return t('ungeprüft');
    const converted = estimateMinor(value, preferences, display.rate);
    return converted == null ? t('Euro-Kurs fehlt') : (preferences.currency === 'EUR' ? '≈ ' : '') + formatMinor(converted, preferences.currency, preferences.language);
  };
  const [queries, setQueries] = useState(['', '', '']);
  const [fairOffer, setFairOffer] = useState<FairOfferRequest | null>(null);
  const [filter, setFilter] = useState<'current' | 'historical'>('current');
  const [detail, setDetail] = useState<string | null>(null);
  const [targets, setTargets] = useState<(number | null)[]>([null, null, null]);
  const [targetsLoaded, setTargetsLoaded] = useState(false);
  const [savedBudget, setSavedBudget] = useState<{ accountId: string; value: CreditBudget | null; saving?: boolean; error?: 'read' | 'write' }>();
  const drafts=usePlannerDrafts(accountId,targets);
  const order=DEFAULT_PRIORITIES;
  const exclusions=useCcuExclusions(accountId);
  const [selected, setSelected] = useState(0), [saving, setSaving] = useState(false), [error, setError] = useState('');
  const generation = useRef(0);
  const activeBudget = savedBudget?.accountId === accountId ? savedBudget : undefined;
  const budgetReady = !!activeBudget && activeBudget.error !== 'read';
  const budgetMinor = budgetReady ? creditBudgetLimit(activeBudget.value, storeCredit) : 0;
  const budgetError = activeBudget?.error === 'read' ? 'Gespeichertes Budget ist nicht lesbar.'
    : activeBudget?.error === 'write' ? 'Budget konnte nicht gespeichert werden.' : '';
  const budgetCurrencyChanged = !!storeCredit && !!activeBudget?.value && activeBudget.value.currency !== storeCredit.currency;
  useEffect(() => {
    let active = true, timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      let pending = false;
      try { const data = await request<MarketSnapshot>({ action: 'market.status' }); if (active) { setSnapshot(previous => JSON.stringify(previous) === JSON.stringify(data) ? previous : data); pending = data.pending; } }
      catch { if (active) setError('Marktdaten konnten nicht gelesen werden.'); }
      if (active) timer = setTimeout(() => void poll(), pending ? 500 : 1500);
    };
    void poll(); return () => { active = false; clearTimeout(timer); };
  }, []);
  useEffect(() => {
    const epoch = ++generation.current; setTargets([null, null, null]); setQueries(['','','']); setSaving(false); setError(''); setSelected(0); setFairOffer(null);
    setTargetsLoaded(!accountId);
    setSavedBudget(undefined);
    if (accountId) {
      void request<(number | null)[]>({ action: 'market.targets', accountId })
        .then(ids => { if (generation.current === epoch) setTargets(ids); })
        .catch(() => { if (generation.current === epoch) setError('Gespeicherte Zielauswahl nicht lesbar.'); })
        .finally(() => { if (generation.current === epoch) setTargetsLoaded(true); });
      void request<CreditBudget | null>({ action: 'planner.creditBudget', accountId })
        .then(value => { if (generation.current === epoch) setSavedBudget({ accountId, value }); })
        .catch(() => { if (generation.current === epoch) setSavedBudget({ accountId, value: null, error: 'read' }); });
    }
    return () => { ++generation.current; };
  }, [accountId]);
  const ships = snapshot?.catalogue?.ships ?? [], offers = snapshot?.offers?.items ?? [];
  const stale = snapshot?.offers ? offersAreStale(snapshot) : false;
  const rows = offers.filter(o => (o.change === 'missing') === (filter === 'historical')).sort((a, b) => Number(b.warbond) - Number(a.warbond) || a.targetName.localeCompare(b.targetName, 'de'));
  const currentCount = offers.filter(o => o.change !== 'missing').length, historicalCount = offers.length - currentCount;
  const activeShip = ships.find(s => s.id === targets[selected]);
  const pool = useMemo(() => withoutExcludedCcus(prepareChains(inventory?.accountId === accountId ? inventory?.pledges ?? [] : [], ships, offers,
    !!snapshot && !offersAreStale(snapshot), inventory?.accountId === accountId ? inventory?.observation : undefined,snapshot?.values),exclusions.keys), [inventory, accountId, snapshot,exclusions.keys]);
  const reservationsReady=exclusions.ready&&!exclusions.saving&&targets.every(id=>id===null||!!drafts.entries[id]?.ready&&!drafts.entries[id]?.error&&!drafts.entries[id]?.saving);
  const goals = useMemo(() => targets.flatMap((id, slot) => {
    const ship = ships.find(item => item.id === id);
    return ship ? [{ slot, ship, draft: drafts.entries[ship.id]?.value }] : [];
  }), [targets, ships, drafts.entries]);
  const inputs = useMemo(() => ({ pool, ships, offers, current: !!snapshot && !offersAreStale(snapshot), display }), [pool, ships, offers, snapshot, display]);
  const planTargets = useMemo(() => reservationsReady ? planFleetRoutes(goals, inputs)
    : goals.map(({ slot, ship }) => ({ slot, ship, targetId: ship.id, name: ship.name, plan: null })), [goals, inputs, reservationsReady]);
  const plans = order.map(slot => planTargets.find(route => route.slot === slot)?.plan ?? null);
  const fleetComparison = useMemo(() => fleet && reservationsReady ? fleetScenarios(goals, planTargets, inputs)
    : { cases: [], assignments: [] }, [fleet, goals, planTargets, inputs, reservationsReady]);
  useShopPrices([...planTargets, ...fleetComparison.cases.flatMap(scenario => scenario.routes)].flatMap(route => route.plan?.steps ?? []));
  const reservations = useMemo(() => analyseReservations(planTargets, order), [planTargets, order]);
  const advisorInput=accountId&&inventory?.accountId===accountId?{pool,targets:targets.flatMap((id,slot)=>{const target=ships.find(s=>s.id===id),draft=id?drafts.entries[id]?.value:undefined;return target?[{slot,target,baseKey:draft?selectedStartBase(pool,draft)?.key??null:null,existing:plans[slot]??null,manual:draft?.mode==='manual'}]:[];}),offers,current:!!snapshot&&!offersAreStale(snapshot),display}:null;
  const advisors={input:advisorInput,signature:JSON.stringify([accountId,reservationsReady,advisorInput]),ready:reservationsReady&&!!advisorInput?.targets.length&&advisorInput.targets.every(t=>!!t.baseKey),conflicts:reservations.conflicts.length,pledges:inventory?.accountId===accountId?inventory.pledges:[],apply:drafts.applyBatch};
  const blocked=activeShip&&reservationsReady?blockedForTarget(reservations,activeShip.id):[];
  const chosenOffer = activeShip ? matchingOffer(activeShip, offers) : undefined;
  const detailOffer = offers.find(o => o.key === detail);
  async function saveTargets(ids: (number | null)[], index: number, afterSave?: () => void) {
    if (!accountId) return;
    const epoch = generation.current;
    setSaving(true); setError('');
    try { const saved = await request<(number | null)[]>({ action: 'market.targets', accountId, ids }); if (generation.current === epoch) { setTargets(saved); setSelected(index); afterSave?.(); } }
    catch { if (generation.current === epoch) setError('Ziel konnte nicht gespeichert werden. Bitte eine andere Katalogauswahl prüfen.'); }
    finally { if (generation.current === epoch) setSaving(false); }
  }
  function choose(index: number, value: string) {
    return saveTargets(targets.map((id, slot) => slot === index ? value ? Number(value) : null : id), index);
  }
  async function saveBudget(minor: number) {
    if (!accountId || !storeCredit || !budgetReady || activeBudget.saving) return;
    const epoch = generation.current;
    const budget = { minor, currency: storeCredit.currency };
    setSavedBudget({ accountId, value: budget, saving: true });
    try {
      const value = await request<CreditBudget>({ action: 'planner.creditBudget', accountId, budget });
      if (generation.current === epoch) setSavedBudget({ accountId, value });
    } catch {
      if (generation.current === epoch) setSavedBudget({ accountId, value: activeBudget.value, error: 'write' });
    }
  }
  if (fleet) {
    const hasTargets = targets.some(id => id !== null);
    const draftFailure = targets.some(id => id !== null && drafts.entries[id]?.error);
    return <FleetView key={accountId} comparison={fleetComparison} display={display} market={snapshot} balance={storeCredit}
      budgetMinor={budgetMinor} budgetReady={budgetReady}
      loading={!!accountId && (!targetsLoaded || hasTargets && !draftFailure && (!snapshot || !reservationsReady))}
      catalogueMissing={!!snapshot && goals.length < targets.filter(id => id !== null).length}
      error={error || budgetError || (draftFailure ? 'Gespeicherter Entwurf ist nicht lesbar.' : '')} saving={saving} onOpenPlanner={onOpenPlanner}
      onApply={(ids, index) => {
        if (saving) return;
        if (ids.every((id, slot) => id === targets[slot])) { setSelected(index); onOpenPlanner(); }
        else void saveTargets(ids, index, onOpenPlanner);
      }} />;
  }
  function offerRow(offer: TargetOffer) {
    return <article className="market-offer" key={offer.key}>
      <div><div className="market-offer-label"><span className={'badge ' + (offer.change === 'changed' || offer.change === 'missing' ? 'unknown' : '')}>{t(changeLabel[offer.change])}</span><span>{t(offer.warbond ? 'Warbond-Zielangebot' : 'Standard-Zielangebot')}</span></div>
        <strong>{offer.targetName}</strong><small>{t("Von→Nach-Schritt ungeprüft")}</small></div>
      <div className="market-price"><strong>{money(offer.warbond ? offer.warbondMinor : offer.regularMinor)}</strong><small>{original(offer.warbond ? offer.warbondMinor : offer.regularMinor)} · USD {preferences.language === 'de' ? 'netto' : 'net'}</small><small>{t(offer.warbond ? 'Warbond: nur Frischgeld' : 'Zahlungsart des CCUs ungeprüft')}</small></div>
      <button aria-expanded={detail === offer.key} aria-label={`Details zu ${offer.targetName}`} onClick={() => setDetail(detail === offer.key ? null : offer.key)}>{t("Details")}</button>
    </article>;
  }
  function card(ship: CatalogueShip | undefined, index: number) {
    const offer = ship ? matchingOffer(ship, offers) : undefined;
    const matches = searchShips(ships, queries[index] ?? '');
    const options = ship && !matches.some(s => s.id === ship.id) ? [ship, ...matches] : matches;
    const priority = index === 0 ? 'Ziel 1 · CCU-Vorrang'
      : index === 1 ? 'Ziel 2 · nach Ziel 1' : 'Ziel 3 · nach Ziel 1 und 2';
    return <article className={'market-target'+(index===selected?' selected':'')} key={index} tabIndex={0} aria-current={index===selected?'true':undefined}
      aria-label={t('Zielschiff') + ' ' + (index + 1) + ': ' + (ship?.name ?? t('Noch kein Ziel gewählt'))}
      onClick={() => setSelected(index)} onFocus={() => setSelected(index)} onKeyDown={event => {
        if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); setSelected(index); }
      }}>
      <ShipArtwork ship={ship} index={index} onOpen={()=>{if(ship)void request({action:'market.openShip',shipId:ship.id}).catch(()=>setError('RSI-Seite konnte nicht geöffnet werden.'));}}/>
      <div className="market-target-body"><span className="market-kicker">{ship ? ship.manufacturer : t('DEINE ZIELWAHL FOLGT')}</span>
        <h2>{ship?.name ?? (targets[index] ? t('Katalogzuordnung fehlt') : t('Zielschiff') + ' ' + (index + 1))}</h2>
        <div className="market-priority">
          <span className={index === 0 ? 'market-priority-label first' : 'market-priority-label'}>{t(priority)}</span>
          {index === selected && <span className="market-current-target">{t('In Bearbeitung')}</span>}
          {ship && reservationsReady && conflictsForTarget(reservations, ship.id).length > 0 &&
            <span className="badge unknown">{t('Ressourcenkonflikt')}</span>}
        </div>
        <label className="market-target-select">{t('Schiff suchen')}<input aria-label={t('Schiff suchen') + ' ' + (index + 1)} placeholder={t('Name, Hersteller oder Tippfehler …')} maxLength={160} value={queries[index]} disabled={!ships.length || saving} onChange={e => setQueries(q => q.map((v, i) => i === index ? e.target.value : v))} /></label>
        <label className="market-target-select">{t("Zielschiff auswählen")}<select aria-label={t('Zielschiff') + ' ' + (index + 1)} disabled={!accountId || !ships.length || saving} value={targets[index] ?? ''} onChange={e => void choose(index, e.target.value)}>
          <option value="">{t("Noch kein Ziel gewählt")}</option>{options.map(s => <option key={s.id} value={s.id} disabled={targets.some((id, i) => i !== index && id === s.id)}>{s.name} · {s.manufacturerCode}</option>)}</select></label>
        {queries[index] && <small role="status">{matches.length ? matches.length + ' ' + t('Treffer') : t('Keine passenden Treffer')}</small>}
        <div className="market-target-value"><span>{preferences.taxMode === 'gross' ? t('Zielwert') + ' ' + vatLabel(preferences.vatBasisPoints, preferences.language) : t('Zielwert vor Steuer')}</span><strong>{money(offer?.warbond ? offer.warbondMinor : offer?.regularMinor)}</strong></div>
        <small className="market-original">{original(offer?.warbond ? offer.warbondMinor : offer?.regularMinor)} · USD {preferences.language === 'de' ? 'netto' : 'net'}</small>
        <p>{t(offer ? offer.warbond ? 'Warbond-Zielangebot' : 'Standard-Zielangebot' : ship ? 'Kein eindeutig zugeordnetes Zielangebot' : 'Wähle später dein gewünschtes Schiff.')}</p>
        <span className="badge unknown">{plans[index] ? `${plans[index]!.ownedCount} ${t('Bestand')} · ${plans[index]!.gapCount} ${t('Lücken')}` : t('Kettenvorschau unten')}</span>
        <small>{plans[index] ? `${t('Selbst gewählte LTI-Basis')}: ${plans[index]!.base?.model.name??t('Basis wählen')}${'invalid'in plans[index]!&&plans[index]!.invalid?' · '+t('Prüfen'):''}` : t('LTI-Startbasis selbst wählen')}</small>
        <button className="market-shop-link" disabled={!ship?.storeUrl} title={t(ship?.storeUrl ? 'Öffnet die offizielle Schiffseite im Standardbrowser.' : 'Kein geprüfter RSI-Link verfügbar.')} onClick={() => { if (ship) void request({ action: 'market.openShip', shipId: ship.id }).catch(() => setError('RSI-Seite konnte nicht geöffnet werden.')); }}>{t('RSI-Shop ↗')}</button>
      </div>
    </article>;
  }
  return <div className="market-view">
    <div className="market-title"><div><div className="eyebrow">{t('Zielschiffe & Ketten')}</div><h1>{t('CCU-Planer')}</h1></div><span className="badge unknown">{t("CCU-Schritte ungeprüft")}</span>{onExport&&<button className="export-open" disabled={!accountId} onClick={onExport}>{t('Exportieren …')}</button>}</div>
    <FairNewsPanel news={snapshot?.fairNews} display={display} offers={offers} values={snapshot?.values} advisors={advisors} pending={!!snapshot?.pending} stale={!snapshot || offersAreStale(snapshot)}
      onCheck={offerKey => setFairOffer({ offerKey })}
      onSeen={async noticeId => { await request({ action: 'market.fairSeen', noticeId }); }} />
    <section className="market-targets" aria-label={t("Zielschiffkarten")}><p>{t(accountId ? 'Deine Auswahl bleibt lokal pro Profil. Es wird nichts gekauft oder angewendet.' : 'Lege ein lokales Profil an, um später eigene Ziele zu wählen.')} {t('Die Schiffskarte öffnet die offizielle RSI-Seite.')}</p>
      <div className="market-target-grid">{targets.map((id, index) => card(ships.find(s => s.id === id), index))}</div>
    </section>
    <ChainBuilder accountId={accountId} inventory={inventory} target={activeShip} market={snapshot} display={display} onShopError={setError} onExportContext={onExportContext}
      editor={drafts.editor(activeShip?.id)} blockedResources={blocked} reservationsReady={reservationsReady} exclusions={exclusions} advisors={advisors} fairOffer={fairOffer} />
    {activeShip && snapshot && <StartBasisComparison key={`${accountId}:${activeShip.id}`} target={activeShip} pool={pool}
      base={drafts.entries[activeShip.id]?.value ? selectedStartBase(pool,drafts.entries[activeShip.id]!.value!) : null}
      market={snapshot} display={display} blocked={blocked} entries={buybacks} observation={buybackObservation}
      ready={reservationsReady && budgetReady} balance={storeCredit} budgetMinor={budgetMinor} />}
    <FinaleShoppingList key={accountId} targets={planTargets} order={order} market={snapshot} display={display} balance={storeCredit} ready={reservationsReady}
      budgetMinor={budgetMinor} budgetEditable={budgetReady && !activeBudget.saving} budgetError={budgetError}
      budgetCurrencyChanged={budgetCurrencyChanged} onBudget={minor => void saveBudget(minor)} />
    <h2 className="market-offers-heading">{t('Angebote & Aktionen')}</h2>
    <section className="market-event"><div><div className="eyebrow">{t("AKTUELLE ANGEBOTSBEOBACHTUNGEN")}</div><h2>{t("Was ist neu für deine Ketten?")}</h2><p>{t("RSI-Schiffskatalog und öffentliche Open-Hangar-Angebote.")}</p></div><div role="status" className="market-update">{snapshot?.pending && <span className="market-spinner" aria-hidden="true" />}<span>{t(snapshot?.pending ? 'Wird aktualisiert …' : 'Automatisch prüfen')}<small>{t('beim Start und täglich um 17:05 Uhr (Berlin)')}</small></span></div></section>
    {error && <p role="alert" className="error">{t(error)}</p>}
    {snapshot?.errors.catalogue && <p role="alert" className="error">{t('Quellen & Schiffskatalog')}: {t(snapshot.errors.catalogue)}</p>}
    {(stale || snapshot?.errors.offers) && <p role="alert" className="error">{t('Angebotsstand veraltet oder nicht erreichbar. Keine aktuelle Kaufbarkeit bestätigt.')} {t(snapshot?.errors.offers ?? '')}</p>}
    <section className="panel market-offers" aria-label={t("Öffentliche Angebotsbeobachtungen")}>
      <div className="market-tabs"><div className="filters"><button aria-pressed={filter === 'current'} onClick={() => { setFilter('current'); setDetail(null); }}>{t('Aktuell')} ({currentCount})</button><button aria-pressed={filter === 'historical'} onClick={() => { setFilter('historical'); setDetail(null); }}>{t('Historisch')} ({historicalCount})</button></div><span>{offers.filter(o => o.change === 'new' || o.change === 'changed').length} {t('neu oder geändert')}</span></div>
      {rows.slice(0, 6).map(offerRow)}
      {rows.length > 6 && <details className="market-more"><summary>{t('Weitere')} {rows.length - 6} {t('Zielangebote')}</summary>{rows.slice(6).map(offerRow)}</details>}
      {!rows.length && <p className="empty">{t(snapshot?.pending ? 'Öffentliche Daten werden geladen …' : filter === 'historical' ? 'Noch keine historischen Beobachtungen.' : 'Noch kein gültiger Angebotsstand gespeichert.')}</p>}
      {detailOffer && <div className="market-detail" role="status"><strong>{detailOffer.name}</strong><p>{t('Regulärer Zielwert')}: {money(detailOffer.regularMinor)} ({original(detailOffer.regularMinor)}) · {t('Warbond-Zielwert')}: {money(detailOffer.warbondMinor)} ({original(detailOffer.warbondMinor)}) · {t('Originalwerte vor Steuer')}.</p><p>{t("Kein Ausgangsschiff und kein bestätigter Von→Nach-Kaufpreis. Angebotsende unbekannt.")}</p><p>{t('Letzte lokale Beobachtung')}: {time(detailOffer.lastSeenAt)} · Shop-ID {detailOffer.toShipId} · SKU {detailOffer.toSkuId}.</p></div>}
      <div className="hint">{t('Quelle')}: Open Hangar · {t('Datenstand')} {time(snapshot?.offers?.sourceAt)} · {t('zuletzt abgerufen')} {time(snapshot?.offers?.fetchedAt)}.<br />{t("Zielwerte sind keine CCU-Zahlbeträge. Historisch bedeutet „nicht mehr beobachtet“, nicht bestätigt beendet.")}</div>
    </section>
    <p className="hint market-fx-hint">{preferences.taxMode === 'gross' ? t(preferences.currency === 'EUR' ? 'Euro-Richtwert' : 'Zielwert') + ' ' + vatLabel(preferences.vatBasisPoints, preferences.language) : t(preferences.currency === 'EUR' ? 'Euro-Richtwert vor Steuer' : 'Zielwert · USD netto')} · {preferences.currency === 'EUR' ? display.rate ? 'EZB / ECB ' + display.rate.sourceDate + ': 1 EUR = ' + display.rate.usdPerEurMicros / 1000000 + ' USD' + (euroRateIsStale(display.rate) ? ' · ' + t('Kurs veraltet') : '') + (display.rateError ? ' · ' + t('Letzter gültiger Kurs') : '') : t('Euro-Kurs fehlt') : 'USD'} · {t('Kein bestätigter RSI-Euro-Shoppreis.')}</p>
    <details className="market-sources"><summary>{t('Quellen & Schiffskatalog')} ({ships.length})</summary><p>RSI Ship Matrix · {time(snapshot?.catalogue?.fetchedAt)}. {t('Varianten bleiben getrennt. Produktionsstatus und Katalogeintrag belegen keine Kaufbarkeit.')}</p><p>RSI Upgrade · {snapshot?.values?.items.length??0} {t('Schiffswerte')} · {time(snapshot?.values?.fetchedAt)} · USD {t('vor Steuer')}. {t('Standardwerte, keine bestätigten CCU-Kaufpreise.')}{snapshot?.valuesError&&<> {t(snapshot.valuesError)}</>}</p><p>Open Hangar · https://app.openhangar.space/data · {t('Datensammlung und Historie')} CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). {t('Felder ausgewählt und für die Anzeige normalisiert.')} {t('Quellenprüfung')} {time(snapshot?.offers?.checkedAt)}.</p>
      <div className="table-scroll"><table><thead><tr><th>{t("Schiff / Variante")}</th><th>{t("RSI-Matrix-ID")}</th><th>{t("Hersteller")}</th><th>{t("Status")}</th></tr></thead><tbody>{ships.map(s => <tr key={s.id}><td>{s.name}</td><td>{s.id}</td><td>{s.manufacturer}</td><td>{s.status}</td></tr>)}</tbody></table></div>
    </details>
  </div>;
}
