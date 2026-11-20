import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { documentSchema, UserError, type Account, type ImportCandidate } from '../domain/model';

const uuid = z.uuid();
const lastSeenSchema = z.object({ schemaVersion: z.literal(1), accountId: uuid, revision: uuid,
  observedAt: z.iso.datetime({ offset: true }), document: documentSchema }).strict();
export type LastSeen = z.infer<typeof lastSeenSchema>;
const MAX_BYTES = 20 * 1024 * 1024;

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
    try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temp, file);
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
    return view;
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
    return view;
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
