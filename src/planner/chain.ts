import type { Insurance, Pledge } from '../domain/model';
import { matchingOffer, type CatalogueShip, type TargetOffer } from '../market/model';
import { observedStandaloneCcu, ccuObservationTime, type ChainObservation } from './observation';
import {catalogueIdentity,nominalValue,type ShipValues} from '../market/ship-values';
import { purchasePriceReader } from './shopping-list';
import { warbondBridgeModels } from './warbond-tier';
import { estimatePlanningMinor, euroRateIsStale } from '../pricing/money';
import type { PricingSnapshot } from '../pricing/model';
import type { ShopAmount } from '../market/shop-prices';

export type ChainModel = { key: string; name: string; catalogueConfirmed: boolean; nominalUsd: number | null };
export type ChainBase = { key: string; pledgeId: string; childId: string; model: ChainModel; pledgeName: string;
  insurance: Insurance; protected: boolean; released: boolean; multiShip: boolean; identityConfirmed: boolean };
export type OwnedCcu = { key: string; pledgeId: string; instanceId: string; from: ChainModel; to: ChainModel;
  warbond: boolean; applicabilityConfirmed: boolean; protected: boolean; observedAt?: string };
export type ChainStep = { key: string; kind: 'owned' | 'purchase' | 'missing' | 'conflict'; from: ChainModel; to: ChainModel; ccu?: OwnedCcu;
  anchorIndex?:number; validity?:'unverified'|'invalid'; referenceKey?:string;
  /** Hypothetical observed purchase, used only by the purchase advisor; never owned stock. */
  purchaseQuote?:{key:string;usdMinor:number} };
export type ChainPool = { bases: ChainBase[]; ccus: OwnedCcu[]; ignored: number; limited: boolean; values?:ShipValues|null;
  marketModels?: readonly ChainModel[] };
export type ChainPlan = { base: ChainBase; target: CatalogueShip; steps: ChainStep[]; ownedCount: number;
  gapCount: number; additionalMinor: 0 | null; applicabilityConfirmed: boolean };
const nameKey = (name: string) => name.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
const key = (pledge: string, child: string) => JSON.stringify([pledge, child]);

/** Exact observed model names only. Search suggestions never establish planner identity. */
export function prepareChains(pledges: readonly Pledge[], catalogue: readonly CatalogueShip[], offers: readonly TargetOffer[], currentOffers: boolean, observation?: ChainObservation,values?:ShipValues|null): ChainPool {
  const names = new Map<string, CatalogueShip[]>(), models = new Map<string, ChainModel>();
  for (const ship of catalogue) { const k = nameKey(ship.name); names.set(k, [...(names.get(k) ?? []), ship]); }
  function model(name: string): ChainModel | null {
    const normalized = nameKey(name), matches = names.get(normalized) ?? [];
    if (!normalized || matches.length > 1) return null;
    const ship = catalogueIdentity(name,catalogue), k = ship ? 'matrix:' + ship.id : 'observed:' + normalized;
    if (!models.has(k)) {
      models.set(k, { key: k, name: ship?.name ?? name.trim(), catalogueConfirmed: !!ship, nominalUsd: ship?nominalValue(ship,offers,currentOffers,values):null });
    }
    return models.get(k)!;
  }
  const baseCounts = new Map<string, number>(), ccuCounts = new Map<string, number>();
  for (const p of pledges) {
    for (const s of p.ships) { const k = key(p.pledgeId, s.childId); baseCounts.set(k, (baseCounts.get(k) ?? 0) + 1); }
    for (const c of p.ccus) { const k = key(p.pledgeId, c.instanceId); ccuCounts.set(k, (ccuCounts.get(k) ?? 0) + 1); }
  }
  const bases: ChainBase[] = [], ccus: OwnedCcu[] = []; let ignored = 0;
  for (const p of pledges) {
    for (const s of p.ships) {
      if (s.role === 'loaner' || s.role === 'included' || baseCounts.get(key(p.pledgeId, s.childId)) !== 1) { ignored++; continue; }
      const m = model(s.modelName); if (!m) { ignored++; continue; }
      bases.push({ key: key(p.pledgeId, s.childId), pledgeId: p.pledgeId, childId: s.childId, model: m,
        pledgeName: p.name, insurance: p.insurance, protected: p.protected, released: p.baseReleased && !p.protected,
        multiShip: p.ships.length > 1, identityConfirmed: s.identity === 'confirmed' && s.role === 'upgradeable' && m.catalogueConfirmed });
    }
    for (const c of p.ccus) {
      const observed = observedStandaloneCcu(p, observation);
      if ((c.status !== 'unused' && !observed) || c.applicability === 'rejected' || ccuCounts.get(key(p.pledgeId, c.instanceId)) !== 1) { ignored++; continue; }
      const from = model(c.from), to = model(c.to);
      // A historical owned CCU must not be discarded just because today's ship values are equal or reversed.
      if (!from || !to || from.key === to.key) { ignored++; continue; }
      ccus.push({ key: key(p.pledgeId, c.instanceId), pledgeId: p.pledgeId, instanceId: c.instanceId, from, to,
        warbond: /\bwarbond\b/i.test(p.name), applicabilityConfirmed: c.applicability === 'confirmed' && from.catalogueConfirmed && to.catalogueConfirmed,
        protected: p.protected, ...(observed ? { observedAt: ccuObservationTime(p, observation)! } : {}) });
    }
  }
  bases.sort((a, b) => a.model.name.localeCompare(b.model.name) || a.key.localeCompare(b.key));
  ccus.sort((a, b) => a.from.name.localeCompare(b.from.name) || a.to.name.localeCompare(b.to.name) || a.key.localeCompare(b.key));
  const marketModels = warbondBridgeModels(catalogue, offers, values, currentOffers);
  const modelCount = new Set([...models.keys(), ...marketModels.map(model => model.key)]).size;
  return { bases, ccus, ignored, limited: ccus.length > 500 || bases.length > 300 || modelCount > 1200, values, marketModels };
}

type Score = [number, number, number];
const compare = (a: Score, b: Score) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/** Suggestions use owned CCUs and purchase steps with a price estimate from current offer data. */
export function buildChain(pool: ChainPool, target: CatalogueShip, offers: readonly TargetOffer[], currentOffers: boolean,
  baseKey?: string, display?: PricingSnapshot): ChainPlan | null {
  if (pool.limited) return null;
  const now = Date.now();
  const priceFor = purchasePriceReader(offers, pool.values, currentOffers, now, display?.shopPrices);
  const rate = display?.rate && !euroRateIsStale(display.rate, now) ? display.rate : null;
  const settings = display?.settings;
  const amounts = new Map<number, number>();
  function rankingAmount(usdMinor: number, shop?: ShopAmount) {
    if (!settings || settings.currency === 'EUR' && !rate) return usdMinor;
    if (shop) return estimatePlanningMinor(usdMinor, settings, rate, shop)!;
    let amount = amounts.get(usdMinor);
    if (amount === undefined) {
      amount = estimatePlanningMinor(usdMinor, settings, rate)!;
      amounts.set(usdMinor, amount);
    }
    return amount;
  }
  const targetModel: ChainModel = { key: 'matrix:' + target.id, name: target.name, catalogueConfirmed: true,
    nominalUsd: nominalValue(target,offers,currentOffers,pool.values) };
  const nodes = new Map<string, ChainModel>([[targetModel.key, targetModel]]), incoming = new Map<string, ChainStep[]>();
  for (const b of pool.bases) nodes.set(b.model.key, b.model);
  for (const c of pool.ccus) {
    nodes.set(c.from.key, c.from); nodes.set(c.to.key, c.to);
    const step: ChainStep = { key: c.key, kind: 'owned', from: c.from, to: c.to, ccu: c };
    incoming.set(c.to.key, [...(incoming.get(c.to.key) ?? []), step]);
  }
  for (const model of pool.marketModels ?? []) {
    if (!nodes.has(model.key)) nodes.set(model.key, model);
  }
  // Target data is authoritative for this catalogue ID; never substitute an observed lookalike.
  nodes.set(targetModel.key, targetModel);
  const distance = new Map<string, Score>([[targetModel.key, [0, 0, 0]]]), next = new Map<string, ChainStep>(), settled = new Set<string>();
  function relax(step: ChainStep, score: Score) {
    if (settled.has(step.from.key)) return;
    const purchase = step.kind === 'purchase' ? priceFor(step) : null;
    if (purchase?.kind === 'open') return;
    const delta = purchase ? rankingAmount(purchase.usdMinor, purchase.shop) : 0;
    const candidate: Score = [score[0] + delta, score[1] + Number(step.kind === 'purchase'), score[2] + 1];
    if (!distance.has(step.from.key) || compare(candidate, distance.get(step.from.key)!) < 0) {
      distance.set(step.from.key, candidate); next.set(step.from.key, step);
    }
  }
  // Reverse Dijkstra: nonnegative weights and settled vertices prevent cycles and duplicate use.
  while (true) {
    let selected: string | undefined;
    for (const [id, score] of distance) if (!settled.has(id) && (selected === undefined || compare(score, distance.get(selected)!) < 0)) selected = id;
    if (selected === undefined) break;
    settled.add(selected); const to = nodes.get(selected)!, score = distance.get(selected)!;
    for (const step of incoming.get(selected) ?? []) relax(step, score);
    if (to.nominalUsd !== null) for (const from of nodes.values()) {
      if (from.nominalUsd !== null && from.nominalUsd < to.nominalUsd) relax({ key: 'gap:' + JSON.stringify([from.key, to.key]), kind: 'purchase', from, to }, score);
    }
  }
  const choices = pool.bases.filter(b => !baseKey || b.key === baseKey).flatMap(base => {
    const score = distance.get(base.model.key);
    const baseValue = base.model.nominalUsd === null ? Number.MAX_SAFE_INTEGER : rankingAmount(base.model.nominalUsd);
    return score ? [{ base, score, baseValue }] : [];
  });
  choices.sort((a, b) => Number(b.base.model.key === targetModel.key) - Number(a.base.model.key === targetModel.key)
    || Number(b.base.insurance.kind === 'lti') - Number(a.base.insurance.kind === 'lti')
    || Number(b.score[1] === 0) - Number(a.score[1] === 0)
    // Include the base's nominal value so a costlier base does not win by proximity alone.
    || (a.score[0] + a.baseValue) - (b.score[0] + b.baseValue)
    || a.baseValue - b.baseValue
    || compare(a.score, b.score) || a.base.key.localeCompare(b.base.key));
  const choice = choices[0]; if (!choice) return null;
  const steps: ChainStep[] = [], visited = new Set<string>(); let cursor = choice.base.model.key;
  while (cursor !== targetModel.key) {
    if (visited.has(cursor) || steps.length >= nodes.size) return null;
    visited.add(cursor); const step = next.get(cursor); if (!step) return null;
    steps.push(step); cursor = step.to.key;
  }
  const gapCount = steps.filter(s => s.kind === 'purchase').length;
  return { base: choice.base, target, steps, ownedCount: steps.length - gapCount, gapCount, additionalMinor: gapCount ? null : 0,
    applicabilityConfirmed: choice.base.identityConfirmed && steps.every(s => s.kind === 'owned' && s.ccu!.applicabilityConfirmed) };
}
