import type { Account, ImportCandidate } from '../domain/model';
import { LastSeenStore, type LastSeen } from '../storage/last-seen';
import type { HangarRefreshProgress } from '../importers/hangar-read';
import type { ObservedConciergeRank } from '../domain/concierge';
import type { SessionSaveResult } from '../importers/rsi';
import type { UpgradeHistoryResult } from '../domain/upgrade-history';

export type BackgroundStatus = 'idle' | 'connecting' | 'connected' | 'auth-required' | 'unavailable';
export type BackgroundSnapshot = { status: BackgroundStatus; revision: string | null; changed: boolean; view?: LastSeen | null; progress?: HangarRefreshProgress };
export type AuthorizationSnapshot = BackgroundSnapshot & { sessionSave: SessionSaveResult };
type StoredState = { status: BackgroundStatus; view: LastSeen | null; conciergeRank?: ObservedConciergeRank };

/** Each result belongs to a profile and generation. This class never stages or commits an import. */
export class BackgroundInventory {
  private states = new Map<string, StoredState>();
  private epochs = new Map<string, number>();
  private jobs = new Map<string, Promise<void>>();
  private stopping = false;
  constructor(private cache: LastSeenStore, private account: (id: string) => Account,
    private restore: (id: string) => Promise<ImportCandidate | null>, private close: (id: string) => Promise<unknown>) {}
  private state(id: string): StoredState {
    const account = this.account(id);
    let state = this.states.get(id);
    if (!state) {
      let view: LastSeen | null = null;
      try { view = account.mode === 'real' ? this.cache.load(account) : null; } catch { /* A cache failure never prevents startup or accepted inventory access. */ }
      state = { status: 'idle', view }; this.states.set(id, state);
    }
    if (state.view) {
      try { this.cache.assertIdentity(account, state.view); }
      catch { state.view = null; state.status = 'unavailable'; state.conciergeRank = undefined; }
    }
    return state;
  }
  snapshot(id: string, knownRevision?: string): BackgroundSnapshot {
    const state = this.state(id), revision = state.view?.revision ?? null;
    const changed = revision !== (knownRevision ?? null);
    return { status: state.status, revision, changed, ...(changed ? { view: state.view } : {}) };
  }
  conciergeRank(id: string): ObservedConciergeRank | undefined {
    const state = this.state(id);
    return state.status === 'connected' ? state.conciergeRank : undefined;
  }
  rememberAppliedPurchases(id: string, revision: string, pledgeId: string, result: UpgradeHistoryResult): void {
    const state = this.state(id);
    if (state.view?.revision !== revision) return;
    try { state.view = this.cache.rememberAppliedPurchases(this.account(id), state.view, pledgeId, result); }
    catch { /* The verified response still goes to the active table if local caching fails. */ }
  }
  observe(id: string, candidate: ImportCandidate, conciergeRank?: ObservedConciergeRank): LastSeen {
    // Manual publishers must first await cancel(), as the main-process authorizer does.
    if (this.jobs.has(id)) throw new Error('Background read still active');
    return this.publish(id, candidate, conciergeRank);
  }
  private publish(id: string, candidate: ImportCandidate, conciergeRank?: ObservedConciergeRank): LastSeen {
    if (this.stopping) throw new Error('Background stopped');
    const state = this.state(id);
    const view = this.cache.save(this.account(id), candidate, state.view);
    state.view = view; state.status = 'connected'; state.conciergeRank = conciergeRank;
    return view;
  }
  refresh(id: string): Promise<void> {
    if (this.stopping || this.account(id).mode !== 'real') return Promise.resolve();
    const existing = this.jobs.get(id); if (existing) return existing;
    const state = this.state(id), epoch = (this.epochs.get(id) ?? 0) + 1;
    this.epochs.set(id, epoch); state.status = 'connecting'; state.conciergeRank = undefined;
    const current = () => !this.stopping && this.epochs.get(id) === epoch;
    const job = (async () => {
      try {
        // Register the job before even a synchronous provider failure can settle it.
        await Promise.resolve();
        if (!current()) return;
        const candidate = await this.restore(id);
        if (!current()) return;
        if (candidate) this.publish(id, candidate); else state.status = 'auth-required';
      } catch (error) {
        if (!current()) return;
        const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
        state.status = code === 'auth-required' ? 'auth-required' : code === 'cancelled' ? 'idle' : 'unavailable';
      } finally {
        if (this.epochs.get(id) === epoch) this.jobs.delete(id);
      }
    })();
    this.jobs.set(id, job);
    return job;
  }
  async cancel(id: string): Promise<void> {
    const state = this.states.get(id);
    if (state) state.conciergeRank = undefined;
    const job = this.jobs.get(id); if (!job) return;
    this.epochs.set(id, (this.epochs.get(id) ?? 0) + 1);
    this.state(id).status = 'idle';
    try { await this.close(id); } finally { await job; if (this.jobs.get(id) === job) this.jobs.delete(id); }
  }
  async shutdown() {
    this.stopping = true;
    await Promise.allSettled([...this.jobs.keys()].map(id => this.cancel(id)));
  }
}
