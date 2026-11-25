import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { documentSchema, rsiPurchaseSchema, UserError, type Account, type ImportCandidate, type Pledge, type RsiPurchase } from '../domain/model';
import { verifiedUpgradePurchasesSchema, type UpgradeHistoryResult } from '../domain/upgrade-history';

const uuid = z.uuid();
const lastSeenSchema = z.object({ schemaVersion: z.literal(1), accountId: uuid, revision: uuid,
  observedAt: z.iso.datetime({ offset: true }), document: documentSchema }).strict();
export type LastSeen = z.infer<typeof lastSeenSchema> & { appliedPurchaseHistories?: Record<string, UpgradeHistoryResult> };
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_APPLIED_PURCHASE_HISTORIES = 512;
const appliedPurchaseEntry = z.object({
  pledgeId: z.string().regex(/^[1-9]\d{0,15}$/), basis: z.string().max(9000), history: verifiedUpgradePurchasesSchema,
}).strict();
const appliedPurchasesSchema = z.object({ accountId: uuid, reference: z.string().min(1).max(160),
  entries: z.array(appliedPurchaseEntry).max(MAX_APPLIED_PURCHASE_HISTORIES) }).strict();

function purchaseBasis(pledge: Pledge): string | undefined {
  if (pledge.ships.length !== 1 || pledge.ccus.length || pledge.sourceValues.upgradeState === 'unresolved') return;
  const ship = pledge.ships[0]!;
  return JSON.stringify([pledge.name, pledge.sourceValues.date ?? null, ship.childId, ship.modelName]);
}

/** A last observed view is a cache, not an accepted inventory import or account-identity proof. */
export class LastSeenStore {
  constructor(readonly directory: string) {}
  private file(id: string) { return path.join(this.directory, uuid.parse(id) + '.json'); }
  private read(file: string): unknown {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BYTES) throw new UserError('Letzter Stand konnte nicht sicher gelesen werden.');
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  private write(file: string, value: unknown) {
    const bytes = Buffer.from(JSON.stringify(value));
    if (bytes.length > MAX_BYTES) throw new UserError('Letzter Stand ist zu gross.');
    fs.mkdirSync(this.directory, { recursive: true });
    if (fs.lstatSync(this.directory).isSymbolicLink()) throw new UserError('Unzulaessiger Cacheordner.');
    const temp = file + '.' + randomUUID() + '.pending';
    const fd = fs.openSync(temp, 'wx');
    try {
      try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(temp, file);
    } catch (error) {
      try { fs.unlinkSync(temp); } catch { /* Preserve the write error. */ }
      throw error;
    }
  }
  private checkIdentity(account: Account, view: LastSeen, previous?: LastSeen | null) {
    if (account.mode !== 'real' || view.accountId !== account.id || view.document.dataMode !== 'real') throw new UserError('Bestand gehoert nicht zu diesem Profil.');
    const incoming = view.document.account;
    if (incoming.identityKind === 'manual-reference' && incoming.reference !== `rsi-local:${account.id}`) throw new UserError('Manuelle Kontozuordnung gehoert nicht zu diesem Profil.');
    if (account.reference !== null && (account.reference !== incoming.reference || account.identityKind !== incoming.identityKind)) throw new UserError('RSI-Konto stimmt nicht mit diesem Profil ueberein.');
    const prior = previous?.document.account;
    if (prior?.identityKind === 'rsi-handle' && (incoming.identityKind !== prior.identityKind || incoming.reference !== prior.reference)) throw new UserError('RSI-Konto hat sich geaendert. Letzter Stand bleibt erhalten.');
  }
  private stored(accountId: string): LastSeen | null {
    try {
      const result = lastSeenSchema.parse(this.read(this.file(accountId)));
      if (result.accountId !== accountId || result.document.dataMode !== 'real') throw new Error('Wrong profile');
      return result;
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return null;
      throw new UserError('Letzter Stand ist nicht lesbar oder gehoert nicht zu diesem Profil.');
    }
  }
  load(account: Account): LastSeen | null {
    const view = this.stored(account.id);
    if (view) this.checkIdentity(account, view);
    return view ? this.withAppliedPurchases(view) : null;
  }
  private appliedPurchaseFile(accountId: string) { return path.join(this.directory, uuid.parse(accountId) + '.applied-purchases.json'); }
  private appliedPurchases(view: LastSeen): z.infer<typeof appliedPurchasesSchema>['entries'] {
    if (view.document.account.identityKind !== 'rsi-handle') return [];
    try {
      const saved = appliedPurchasesSchema.parse(this.read(this.appliedPurchaseFile(view.accountId)));
      return saved.accountId === view.accountId && saved.reference === view.document.account.reference ? saved.entries : [];
    } catch { return []; }
  }
  private withAppliedPurchases(view: LastSeen): LastSeen {
    const entries = this.appliedPurchases(view);
    if (!entries.length) return view;
    const pledges = new Map(view.document.pledges.map(pledge => [pledge.pledgeId, pledge]));
    const histories = entries.flatMap(entry => {
      const pledge = pledges.get(entry.pledgeId);
      return pledge && purchaseBasis(pledge) === entry.basis ? [[entry.pledgeId, entry.history] as const] : [];
    });
    return histories.length ? { ...view, appliedPurchaseHistories: Object.fromEntries(histories) } : view;
  }
  rememberAppliedPurchases(account: Account, view: LastSeen, pledgeId: string, result: UpgradeHistoryResult): LastSeen {
    return this.rememberPurchaseHistories(account, view, { [pledgeId]: result });
  }
  rememberPurchaseHistories(account: Account, view: LastSeen, histories: Readonly<Record<string, UpgradeHistoryResult>>,
    basePurchases: Readonly<Record<string, RsiPurchase>> = {}): LastSeen {
    this.checkIdentity(account, view);
    if (view.document.account.identityKind !== 'rsi-handle' || (!Object.keys(histories).length && !Object.keys(basePurchases).length)) return view;
    const stored = this.stored(account.id);
    if (!stored || stored.revision !== view.revision || stored.document.account.reference !== view.document.account.reference ||
        stored.document.account.identityKind !== 'rsi-handle') return view;
    const updates: z.infer<typeof appliedPurchaseEntry>[] = [];
    const sessionOrders = new Map<string, RsiPurchase>();
    if (Object.keys(basePurchases).length) {
      for (const pledge of view.document.pledges) {
        if (pledge.rsiPurchase?.status === 'documented' && pledge.rsiPurchase.source === 'order') {
          sessionOrders.set(pledge.pledgeId, pledge.rsiPurchase);
        }
      }
    }
    let baseChanged = false;
    const pledges = stored.document.pledges.map(pledge => {
      const id = pledge.pledgeId;
      if (Object.hasOwn(histories, id)) {
        const entry = appliedPurchaseEntry.safeParse({ pledgeId: id, basis: purchaseBasis(pledge), history: histories[id] });
        if (entry.success) updates.push(entry.data);
      }
      if (pledge.rsiPurchase?.status === 'excluded' || pledge.rsiPurchase?.status === 'documented' && pledge.rsiPurchase.source === 'order') return pledge;
      const candidate = sessionOrders.get(id) ?? (Object.hasOwn(basePurchases, id) ? basePurchases[id] : undefined);
      if (!candidate) return pledge;
      const price = rsiPurchaseSchema.safeParse(candidate);
      if (!price.success || price.data.status !== 'documented' || price.data.source !== 'order') return pledge;
      baseChanged = true;
      return { ...pledge, rsiPurchase: price.data };
    });
    if (baseChanged) {
      const document = { ...stored.document, pledges };
      view = { ...view, document };
      try { this.write(this.file(account.id), { ...stored, document }); }
      catch { /* Keep the verified observation available for the current session. */ }
    }
    if (!updates.length) return view;
    const previous = this.appliedPurchases(view);
    const merged = new Map(previous.map(entry => [entry.pledgeId, entry]));
    const appliedPurchaseHistories = { ...view.appliedPurchaseHistories };
    for (const entry of updates) {
      const old = merged.get(entry.pledgeId);
      const prior = old?.basis === entry.basis ? old.history : appliedPurchaseHistories[entry.pledgeId];
      const history = prior?.steps.length && !entry.history.steps.length ? prior : entry.history;
      merged.delete(entry.pledgeId);
      merged.set(entry.pledgeId, { ...entry, history });
      appliedPurchaseHistories[entry.pledgeId] = history;
    }
    // Keep paid receipts ahead of confirmed empty histories when the bounded sidecar fills.
    const newestFirst = [...merged.values()].reverse();
    const prioritized = [...newestFirst.filter(entry => entry.history.steps.length), ...newestFirst.filter(entry => !entry.history.steps.length)];
    const sidecar = { accountId: account.id, reference: stored.document.account.reference, entries: [] as typeof updates };
    let bytes = Buffer.byteLength(JSON.stringify(sidecar));
    for (const entry of prioritized) {
      if (sidecar.entries.length >= MAX_APPLIED_PURCHASE_HISTORIES) break;
      const size = Buffer.byteLength(JSON.stringify(entry)) + (sidecar.entries.length ? 1 : 0);
      if (bytes + size > MAX_BYTES) continue;
      bytes += size;
      sidecar.entries.push(entry);
    }
    sidecar.entries.reverse();
    try { this.write(this.appliedPurchaseFile(account.id), sidecar); }
    catch { /* Sidecar persistence is independent of base receipts and the active table. */ }
    return { ...view, appliedPurchaseHistories };
  }
  assertIdentity(account: Account, view: LastSeen): void { this.checkIdentity(account, view); }
  canRemember(account: Account, identity: ImportCandidate['document']['account']): boolean {
    if (account.mode !== 'real' || identity.identityKind !== 'rsi-handle') return false;
    if (account.reference !== null) return account.identityKind === identity.identityKind && account.reference === identity.reference;
    const expected = this.stored(account.id)?.document.account;
    return expected?.identityKind !== 'rsi-handle' || expected.reference === identity.reference;
  }
  save(account: Account, candidate: ImportCandidate, previous?: LastSeen | null): LastSeen {
    const view = lastSeenSchema.parse({ schemaVersion: 1, accountId: account.id, revision: randomUUID(),
      observedAt: new Date().toISOString(), document: candidate.document });
    const stored = this.stored(account.id);
    // Explicitly accepted account binding outranks an old, derived observation cache.
    this.checkIdentity(account, view, account.reference === null ? stored : null);
    if (previous && account.reference === null) this.checkIdentity(account, view, previous);
    const prior = stored?.document;
    if (prior?.account.identityKind === 'rsi-handle' && view.document.account.identityKind === 'rsi-handle'
      && prior.account.reference === view.document.account.reference) {
      const priorPurchases = new Map(prior.pledges.filter(p => p.rsiPurchase).map(p => [p.pledgeId, p]));
      const pledges = view.document.pledges.map(pledge => {
        const old = priorPurchases.get(pledge.pledgeId);
        if (!old?.rsiPurchase || old.name !== pledge.name || old.sourceValues.date !== pledge.sourceValues.date) return pledge;
        const incoming = pledge.rsiPurchase;
        if (!incoming || incoming.status === 'documented' && incoming.source === 'log'
          && old.rsiPurchase.status === 'documented' && old.rsiPurchase.source === 'order') {
          return { ...pledge, rsiPurchase: old.rsiPurchase };
        }
        if(incoming.status==='documented'&&incoming.currency==='GBP'&&!incoming.poundRate&&
            old.rsiPurchase.status==='documented'&&old.rsiPurchase.currency==='GBP'&&old.rsiPurchase.poundRate&&
            old.rsiPurchase.minor===incoming.minor&&old.rsiPurchase.purchaseDate===incoming.purchaseDate) {
          return {...pledge,rsiPurchase:{...incoming,poundRate:old.rsiPurchase.poundRate}};
        }
        return pledge;
      });
      const retained = { ...view.document, pledges };
      if (Buffer.byteLength(JSON.stringify({ ...view, document: retained })) <= MAX_BYTES) view.document = retained;
    }
    if (!view.document.buybackObservation && prior?.buybackObservation && prior.account.reference === view.document.account.reference
      && prior.account.identityKind === view.document.account.identityKind) {
      const retained = { ...view.document, buybacks: prior.buybacks, buybackObservation: { ...prior.buybackObservation, current: false } };
      if (Buffer.byteLength(JSON.stringify({ ...view, document: retained })) <= MAX_BYTES) view.document = retained;
    }
    this.write(this.file(account.id), view);
    return this.withAppliedPurchases(view);
  }
  selected(accounts: Account[]): string | null {
    try {
      const parsed = z.object({ accountId: uuid }).strict().parse(this.read(path.join(this.directory, 'selected.json')));
      if (accounts.some(a => a.id === parsed.accountId)) return parsed.accountId;
    } catch { /* An invalid preference never selects a foreign or fabricated account. */ }
    return accounts.find(a => a.mode === 'real')?.id ?? accounts[0]?.id ?? null;
  }
  select(accountId: string) { this.write(path.join(this.directory, 'selected.json'), { accountId: uuid.parse(accountId) }); }
}
