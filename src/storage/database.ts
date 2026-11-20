import initSqlJs, { type Database, type SqlJsStatic, type SqlValue } from 'sql.js';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { checkBinding } from '../accounts/service';
import { APP_VERSION, type Account, type AccountInventory, type ImportCandidate, type InventoryDocument, type Preview, UserError } from '../domain/model';

export class InventoryStore {
  private constructor(private sql: SqlJsStatic, private db: Database, readonly file: string) {}
  static async open(file: string, wasmBinary?: Buffer) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const sql = await initSqlJs(wasmBinary ? { wasmBinary: Uint8Array.from(wasmBinary).buffer } : {});
    const existed = fs.existsSync(file);
    const db = new sql.Database(existed ? fs.readFileSync(file) : undefined);
    const store = new InventoryStore(sql, db, file);
    const version = Number(store.rows('PRAGMA user_version')[0]?.user_version ?? 0);
    if (version > 1) { db.close(); throw new UserError('Datenbank ist neuer als diese App. Keine Änderung vorgenommen.'); }
    if (version < 1) {
      if (existed) store.backup('vor-migration-1');
      store.transaction(() => {
        db.run(`CREATE TABLE accounts (id TEXT PRIMARY KEY, name TEXT NOT NULL, mode TEXT NOT NULL,
          reference TEXT, identityKind TEXT, identityStatus TEXT NOT NULL, lastComplete TEXT,
          UNIQUE(reference, identityKind, mode));
          CREATE TABLE snapshots (id TEXT PRIMARY KEY, accountId TEXT NOT NULL REFERENCES accounts(id),
          digest TEXT NOT NULL, adapter TEXT NOT NULL, importedAt TEXT NOT NULL, sourceCreatedAt TEXT NOT NULL,
          completeness TEXT NOT NULL, payload TEXT NOT NULL, UNIQUE(accountId, digest));
          CREATE TABLE items (accountId TEXT NOT NULL REFERENCES accounts(id), pledgeId TEXT NOT NULL,
          payload TEXT NOT NULL, availability TEXT NOT NULL, source TEXT NOT NULL, importedAt TEXT NOT NULL,
          PRIMARY KEY(accountId, pledgeId));
          CREATE TABLE buybacks (accountId TEXT NOT NULL REFERENCES accounts(id), entryId TEXT NOT NULL,
          payload TEXT NOT NULL, PRIMARY KEY(accountId, entryId));
          PRAGMA user_version = 1;`);
      });
    }
    store.db.run('PRAGMA foreign_keys = ON;');
    return store;
  }
  private rows(query: string, params: SqlValue[] = []): Record<string, SqlValue>[] {
    const statement = this.db.prepare(query);
    try { statement.bind(params); const rows = []; while (statement.step()) rows.push(statement.getAsObject()); return rows; }
    finally { statement.free(); }
  }
  private persist() {
    const temp = this.file + '.' + randomUUID() + '.pending';
    const data = this.db.export();
    const fd = fs.openSync(temp, 'wx');
    try { fs.writeFileSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temp, this.file);
  }
  private transaction<T>(fn: () => T): T {
    const before = this.db.export();
    this.db.run('PRAGMA foreign_keys = ON; BEGIN IMMEDIATE;');
    try { const result = fn(); this.db.run('COMMIT;'); this.persist(); return result; }
    catch (error) { this.db.close(); this.db = new this.sql.Database(before); this.db.run('PRAGMA foreign_keys = ON;'); throw error; }
  }
  accounts(): Account[] { return this.rows('SELECT * FROM accounts ORDER BY rowid').map(a => a as unknown as Account); }
  account(id: string): Account {
    const a = this.accounts().find(x => x.id === id);
    if (!a) throw new UserError('Lokales Kontoprofil nicht gefunden.');
    return a;
  }
  createAccount(name: string, mode: 'demo' | 'real'): Account {
    const accountId = randomUUID();
    this.transaction(() => this.db.run('INSERT INTO accounts VALUES (?, ?, ?, NULL, NULL, ?, NULL)', [accountId, name, mode, 'unbound']));
    return this.account(accountId);
  }
  /** Maintenance only: never delete a real profile, and never touch session or key folders. */
  deleteDemoAccount(accountId: string): void {
    if (this.account(accountId).mode !== 'demo') throw new UserError('Echte Kontoprofile dürfen hier nicht gelöscht werden.');
    this.transaction(() => {
      for (const table of ['items', 'buybacks', 'snapshots']) this.db.run(`DELETE FROM ${table} WHERE accountId = ?`, [accountId]);
      this.db.run('DELETE FROM accounts WHERE id = ? AND mode = ?', [accountId, 'demo']);
    });
  }
  inventory(accountId: string): AccountInventory {
    const account = this.account(accountId);
    return { account, items: this.rows('SELECT * FROM items WHERE accountId = ? ORDER BY pledgeId', [accountId]).map(x => ({
      pledge: JSON.parse(String(x.payload)), availability: String(x.availability) as 'present' | 'removed',
      source: String(x.source), importedAt: String(x.importedAt),
    })), buybacks: this.rows('SELECT payload FROM buybacks WHERE accountId = ? ORDER BY entryId', [accountId]).map(x => JSON.parse(String(x.payload))) };
  }
  private checkSourceDate(candidate: ImportCandidate, at: number) {
    if (candidate.adapter === 'sarevocs-json/1' && Date.parse(candidate.document.createdAt) > at) {
      throw new UserError('Das Erstellungsdatum der Datei liegt in der Zukunft. Bitte Dateidatum und Systemuhr prüfen.');
    }
  }
  preview(accountId: string, candidate: ImportCandidate): Omit<Preview, 'token'> {
    const account = this.account(accountId);
    this.checkSourceDate(candidate, Date.now());
    if (account.reference !== null) checkBinding(account, candidate, true);
    else if (account.mode !== candidate.document.dataMode) throw new UserError('Demo- und Echtdaten benötigen getrennte Profile.');
    const inventory = this.inventory(accountId);
    const previous = new Map(inventory.items.filter(x => x.availability === 'present').map(x => [x.pledge.pledgeId, x.pledge]));
    let added = 0, changed = 0, unchanged = 0;
    const seen = new Set<string>();
    for (const pledge of candidate.document.pledges) {
      seen.add(pledge.pledgeId); const old = previous.get(pledge.pledgeId);
      if (!old) added++;
      else if (JSON.stringify(old) === JSON.stringify({ ...pledge, protected: old.protected, baseReleased: old.baseReleased })) unchanged++;
      else changed++;
    }
    return { accountId, adapter: candidate.adapter, dataMode: candidate.document.dataMode, reference: candidate.document.account.reference,
      completeness: candidate.completeness, evidence: candidate.evidence, warnings: candidate.warnings,
      pledges: candidate.document.pledges, buybacks: candidate.document.buybacks,
      bindingRequired: account.reference === null || candidate.document.account.identityKind === 'manual-reference',
      changes: { added, changed, unchanged, missing: [...previous.keys()].filter(k => !seen.has(k)).length } };
  }
  commit(accountId: string, candidate: ImportCandidate, manuallyConfirmed: boolean) {
    const account = this.account(accountId);
    checkBinding(account, candidate, manuallyConfirmed);
    const binding = candidate.document.account;
    if (this.accounts().some(a => a.id !== accountId && a.mode === account.mode && a.reference === binding.reference && a.identityKind === binding.identityKind)) {
      throw new UserError('Diese Kontoreferenz ist bereits einem anderen lokalen Profil zugeordnet. Dort importieren.');
    }
    if (this.rows('SELECT id FROM snapshots WHERE accountId = ? AND digest = ?', [accountId, candidate.digest]).length) return { repeated: true };
    const importedAt = new Date().toISOString();
    this.checkSourceDate(candidate, Date.parse(importedAt));
    if (candidate.adapter === 'sarevocs-json/1') {
      // Older releases accepted future-dated files. Ignore those snapshots for chronological ordering.
      const latest = this.rows(`SELECT sourceCreatedAt FROM snapshots WHERE accountId = ? AND adapter = ?
        AND julianday(sourceCreatedAt) <= julianday(importedAt) AND julianday(sourceCreatedAt) <= julianday(?)
        ORDER BY julianday(sourceCreatedAt) DESC LIMIT 1`, [accountId, candidate.adapter, importedAt])[0];
      if (latest && Date.parse(candidate.document.createdAt) < Date.parse(String(latest.sourceCreatedAt))) {
        throw new UserError('Die Datei ist älter als der bereits übernommene Datenstand. Keine Bestandsänderung.');
      }
    }
    const existing = new Map(this.inventory(accountId).items.map(x => [x.pledge.pledgeId, x.pledge]));
    this.transaction(() => {
      this.db.run('UPDATE accounts SET reference=?, identityKind=?, identityStatus=? WHERE id=?', [binding.reference, binding.identityKind, 'manual-confirmed', accountId]);
      if (candidate.completeness === 'complete') this.db.run('UPDATE items SET availability=? WHERE accountId=?', ['removed', accountId]);
      for (const pledge of candidate.document.pledges) {
        const old = existing.get(pledge.pledgeId);
        const item = { ...pledge, ...(old ? { protected: old.protected, baseReleased: old.baseReleased } : {}) };
        this.db.run('INSERT OR REPLACE INTO items VALUES (?, ?, ?, ?, ?, ?)', [accountId, pledge.pledgeId, JSON.stringify(item), 'present', candidate.adapter, importedAt]);
      }
      for (const b of candidate.document.buybacks) this.db.run('INSERT OR REPLACE INTO buybacks VALUES (?, ?, ?)', [accountId, b.entryId, JSON.stringify(b)]);
      this.db.run('INSERT INTO snapshots VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [randomUUID(), accountId, candidate.digest, candidate.adapter, importedAt,
        candidate.document.createdAt, candidate.completeness, JSON.stringify(candidate)]);
      if (candidate.completeness === 'complete') this.db.run('UPDATE accounts SET lastComplete=? WHERE id=?', [importedAt, accountId]);
    });
    return { repeated: false };
  }
  export(accountId: string): InventoryDocument {
    const inventory = this.inventory(accountId);
    if (!inventory.account.reference || !inventory.account.identityKind) throw new UserError('Noch kein Bestand für dieses Profil übernommen.');
    // Current inventory may combine partial observations. Never invent complete source coverage.
    return { type: 'sarevocs-ccu-inventory', schemaVersion: 1, appVersion: APP_VERSION, createdAt: new Date().toISOString(),
      dataMode: inventory.account.mode, account: { reference: inventory.account.reference, identityKind: inventory.account.identityKind },
      scope: { kind: 'partial', exportComplete: false, expectedPledges: null, pagesExpected: null, pagesRead: null },
      pledges: inventory.items.filter(x => x.availability === 'present').map(x => x.pledge), buybacks: inventory.buybacks };
  }
  backup(purpose = 'manuell'): string {
    const destination = path.join(path.dirname(this.file), 'backups', `${purpose}-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.sqlite`);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, this.db.export(), { flag: 'wx' });
    return destination;
  }
  close() { this.db.close(); }
}
