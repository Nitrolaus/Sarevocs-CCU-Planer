import fs from 'node:fs';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import { InventoryStore } from '../src/storage/database';
import { LastSeenStore } from '../src/storage/last-seen';
import { parseImport } from '../src/importers/files';
import type { Account, ImportCandidate } from '../src/domain/model';
import { demoDocument } from './fixtures';

/** Test-only module aliased over importers/rsi while bundling the actual main entry point. */
export type AutomaticSeed = { accounts: Account[]; revisions: Record<string, string> };
type Gate<T> = { promise: Promise<T>; resolve(value: T): void; reject(reason: unknown): void; settled: boolean };
type Call = { accountId: string; gate: Gate<unknown>; signal?: AbortSignal; aborted: boolean };
function gate<T>(): Gate<T> {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject, settled: false };
}
function settle<T>(value: Gate<T>, result: T, reject = false) {
  if (value.settled) return;
  value.settled = true;
  if (reject) value.reject(result); else value.resolve(result);
}
function cancelled() { return Object.assign(new Error('Synthetic cancellation'), { code: 'cancelled' }); }
function candidate(account: Account, marker: string): ImportCandidate {
  const document = demoDocument();
  document.dataMode = 'real';
  document.account = { reference: `rsi-local:${account.id}`, identityKind: 'manual-reference' };
  document.scope = { kind: 'partial', exportComplete: false, expectedPledges: null, pagesExpected: null, pagesRead: 1 };
  document.pledges.forEach((pledge, index) => { pledge.name = `${marker} PLEDGE ${index}`; });
  const result = parseImport(JSON.stringify(document)); result.adapter = 'rsi-dom-probe/1';
  return result;
}

export async function seedAutomaticStart(dataRoot: string, wasmFile: string): Promise<AutomaticSeed> {
  const data = path.join(dataRoot, 'Daten');
  const store = await InventoryStore.open(path.join(data, 'inventory.sqlite'), fs.readFileSync(wasmFile));
  try {
    const accounts = [store.createAccount('SYNTHETIC PROFILE A', 'real'), store.createAccount('SYNTHETIC PROFILE B', 'real')];
    const cache = new LastSeenStore(path.join(data, 'LetzterStand')), revisions: Record<string, string> = {};
    accounts.forEach((account, index) => {
      revisions[account.id] = cache.save(account, candidate(account, index === 0 ? 'SYNTHETIC_CACHED_A' : 'SYNTHETIC_CACHED_B')).revision;
    });
    cache.select(accounts[0]!.id);
    return { accounts, revisions };
  } finally { store.close(); }
}

export class AutomaticControl {
  readonly resumeCalls: Call[] = [];
  readonly connectCalls: Call[] = [];
  readonly closeCalls: Call[] = [];
  private closePlans: string[] = [];
  remoteLoads = 0;
  shutdowns = 0;
  constructor(readonly seed: AutomaticSeed) {}
  account(id: string) {
    const value = this.seed.accounts.find(account => account.id === id);
    if (!value) throw new Error('Unknown synthetic profile'); return value;
  }
  nextCloseGate(id: string) { this.account(id); this.closePlans.push(id); }
  resume(id: string) {
    this.account(id); const value = gate<unknown>();
    this.resumeCalls.push({ accountId: id, gate: value, aborted: false });
    return value.promise as Promise<ImportCandidate | null>;
  }
  connect(id: string, signal?: AbortSignal) {
    this.account(id); const value = gate<unknown>();
    const call: Call = { accountId: id, gate: value, signal, aborted: signal?.aborted ?? false };
    signal?.addEventListener('abort', () => { call.aborted = true; }, { once: true });
    this.connectCalls.push(call);
    // Intentionally return even after signal.abort: the real main authorizer must reject late providers too.
    return value.promise as Promise<ImportCandidate>;
  }
  private cancelResumes(id: string) {
    for (const call of this.resumeCalls) if (call.accountId === id) settle(call.gate, cancelled(), true);
  }
  close(id: string) {
    this.account(id);
    // Real RsiLogin shares its cleanup task. Repeated close calls must wait for that same gate.
    const existing = [...this.closeCalls].reverse().find(call => call.accountId === id && !call.gate.settled);
    if (existing) {
      this.closeCalls.push({ accountId: id, gate: existing.gate, aborted: false });
      return existing.gate.promise.then(() => { this.cancelResumes(id); });
    }
    const value = gate<unknown>();
    this.closeCalls.push({ accountId: id, gate: value, aborted: false });
    const index = this.closePlans.indexOf(id);
    if (index < 0) { this.cancelResumes(id); settle(value, undefined); }
    else this.closePlans.splice(index, 1);
    return value.promise.then(() => { this.cancelResumes(id); });
  }
  releaseClose(index: number) {
    const call = this.closeCalls[index]; if (!call) throw new Error('Unknown synthetic close');
    this.cancelResumes(call.accountId); settle(call.gate, undefined);
  }
  releaseResume(index: number, marker: string | null) {
    const call = this.resumeCalls[index]; if (!call) throw new Error('Unknown synthetic resume');
    settle(call.gate, marker === null ? null : candidate(this.account(call.accountId), marker));
  }
  releaseConnect(index: number, marker: string) {
    const call = this.connectCalls[index]; if (!call) throw new Error('Unknown synthetic connect');
    settle(call.gate, candidate(this.account(call.accountId), marker));
  }
  releaseAll() {
    this.closePlans.length = 0;
    this.resumeCalls.forEach(call => settle(call.gate, cancelled(), true));
    this.connectCalls.forEach(call => settle(call.gate, cancelled(), true));
    this.closeCalls.forEach(call => settle(call.gate, undefined));
  }
  snapshot() {
    const calls = (values: Call[]) => values.map(call => ({ accountId: call.accountId, settled: call.gate.settled, aborted: call.aborted }));
    return { resume: calls(this.resumeCalls), connect: calls(this.connectCalls), close: calls(this.closeCalls), remoteLoads: this.remoteLoads, shutdowns: this.shutdowns };
  }
}

declare global { var ccuAutomaticStart: AutomaticControl; }
export function installAutomaticFixture(seed: AutomaticSeed) { globalThis.ccuAutomaticStart = new AutomaticControl(seed); }
export class RsiLogin {
  constructor(..._ignored: unknown[]) { if (!globalThis.ccuAutomaticStart) throw new Error('Synthetic fixture must be installed before main'); }
  resume(id: string, _parent: BrowserWindow) { return globalThis.ccuAutomaticStart.resume(id); }
  connect(id: string, _parent: BrowserWindow, _remember: boolean, options: { hideHangar?: boolean; signal?: AbortSignal } = {}) {
    return globalThis.ccuAutomaticStart.connect(id, options.signal);
  }
  close(id: string) { return globalThis.ccuAutomaticStart.close(id); }
  async settings(id: string) { globalThis.ccuAutomaticStart.account(id); return { available: true, saved: true, stored: true, directory: 'SYNTHETIC_ONLY', sessionOpen: false, error: null }; }
  status() { return { state: 'closed', message: 'Synthetic-only provider' }; }
  async open() { throw new Error('Manual open is outside this regression'); }
  async probe() { throw new Error('Manual probe is outside this regression'); }
  async remove(id: string) { await this.close(id); }
  async shutdown() { globalThis.ccuAutomaticStart.shutdowns++; globalThis.ccuAutomaticStart.releaseAll(); return true; }
}
