import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { UserError } from '../domain/model';
import { protectSessionDirectory } from './directory';
import { cookieSchema, officialCookie, hasAuthenticationCookie, type StoredCookie } from './rsi-cookies';
export { officialCookie, type StoredCookie } from './rsi-cookies';
const accountIdSchema = z.uuid();
const capsuleSchema = z.object({ schemaVersion: z.literal(1), accountId: accountIdSchema,
  issuer: z.literal('https://robertsspaceindustries.com'), cookies: z.array(cookieSchema).max(500) }).strict();
export type Encryption = { isAsyncEncryptionAvailable(): Promise<boolean>; encryptStringAsync(value: string): Promise<Buffer>;
  decryptStringAsync(value: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }> };
export class SessionVault {
  private preparation: Promise<void> | null = null;
  constructor(readonly directory: string, private encryption: Encryption, private keyDirectory?: string) {}
  private async ready() {
    if (!this.preparation) this.preparation = (async () => {
      if (this.keyDirectory) await protectSessionDirectory(this.keyDirectory, true);
      if (process.platform !== 'win32' || !await this.encryption.isAsyncEncryptionAvailable()) throw new UserError('Windows-Verschlüsselung nicht verfügbar. Es wird keine Sitzung gespeichert.');
      await protectSessionDirectory(this.directory);
    })().catch(() => { this.preparation = null; throw new UserError('Verschlüsselung oder geschützte Ordnerrechte nicht verfügbar. Es wird keine Sitzung gespeichert.'); });
    await this.preparation;
  }
  async prepare() { await this.ready(); }
  private file(accountId: string) {
    if (!accountIdSchema.safeParse(accountId).success) throw new UserError('Ungültiges Kontoprofil für den Anmeldespeicher.');
    return path.join(this.directory, accountId + '.session.enc');
  }
  async status(accountId: string) {
    const file = this.file(accountId);
    const stored = fs.existsSync(file);
    try { await this.ready(); }
    catch { return { available: false, saved: false, stored, directory: this.directory, error: null }; }
    try {
      const record = await this.read(accountId);
      return { available: true, saved: hasAuthenticationCookie(record?.cookies ?? []), stored, directory: this.directory, error: null };
    } catch { return { available: true, saved: false, stored, directory: this.directory, error: 'Gespeicherte Anmeldung nicht lesbar. Die Datei bleibt erhalten.' }; }
  }
  async save(accountId: string, cookies: StoredCookie[]) {
    const destination = this.file(accountId); await this.ready();
    const approved = cookies.filter(officialCookie);
    const capsule = capsuleSchema.parse({ schemaVersion: 1, accountId, issuer: 'https://robertsspaceindustries.com', cookies: approved });
    // Consent/device-only snapshots must neither create an alleged login nor overwrite a saved login.
    if (!hasAuthenticationCookie(capsule.cookies)) return false;
    const plaintext = JSON.stringify(capsule);
    if (Buffer.byteLength(plaintext, 'utf8') > 1024 * 1024) throw new UserError('Sitzungsumfang unerwartet groß. Keine Speicherung.');
    const encrypted = await this.encryption.encryptStringAsync(plaintext);
    if (!encrypted.length || encrypted.includes(Buffer.from(plaintext))) throw new UserError('Sitzungsverschlüsselung fehlgeschlagen. Keine Speicherung.');
    const temp = path.join(this.directory, accountId + '.' + randomUUID() + '.session.pending');
    const fd = fs.openSync(temp, 'wx');
    try {
      try { fs.writeFileSync(fd, encrypted); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(temp, destination);
    } catch (error) {
      try { fs.unlinkSync(temp); } catch { /* A later explicit session deletion also removes pending copies. */ }
      throw error;
    }
    return true;
  }
  async load(accountId: string, persistReEncryption = true): Promise<StoredCookie[]> {
    this.file(accountId); await this.ready();
    try {
      const record = await this.read(accountId);
      if (!record) return [];
      if (record.shouldReEncrypt && persistReEncryption) await this.save(accountId, record.cookies);
      return record.cookies;
    } catch { throw new UserError('Gespeicherte Sitzung nicht lesbar oder nicht diesem Profil/Windows-Benutzer zugeordnet. Sitzung gezielt löschen und erneut bei RSI anmelden.'); }
  }
  private async read(accountId: string) {
      const file = this.file(accountId);
      if (!fs.existsSync(file)) return null;
      if (fs.lstatSync(file).isSymbolicLink()) throw new Error('Invalid file');
      const fd = fs.openSync(file, 'r'); let encrypted: Buffer;
      try {
        const size = fs.fstatSync(fd).size;
        if (size < 1 || size > 2 * 1024 * 1024) throw new Error('Invalid size');
        encrypted = Buffer.alloc(size);
        if (fs.readSync(fd, encrypted, 0, size, 0) !== size || fs.fstatSync(fd).size !== size) throw new Error('Changed file');
      } finally { fs.closeSync(fd); }
      const decrypted = await this.encryption.decryptStringAsync(encrypted);
      const capsule = capsuleSchema.parse(JSON.parse(decrypted.result));
      if (capsule.accountId !== accountId) throw new Error('Wrong account');
      const cookies = capsule.cookies.filter(officialCookie);
      return { cookies, shouldReEncrypt: decrypted.shouldReEncrypt };
  }
  async remove(accountId: string) {
    const file = this.file(accountId);
    if (!fs.existsSync(this.directory)) return;
    await protectSessionDirectory(this.directory);
    try {
      const pending = new RegExp(`^${accountId}\\.[0-9a-f-]{36}\\.session\\.pending$`, 'i');
      const paths = [file, ...fs.readdirSync(this.directory).filter(name => pending.test(name)).map(name => path.join(this.directory, name))];
      for (const candidate of paths) {
        try { fs.unlinkSync(candidate); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      }
    } catch { throw new UserError('Gespeicherte Sitzung konnte nicht vollständig gelöscht werden.'); }
  }
}
