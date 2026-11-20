import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { id } from '../domain/model';

const maxBytes = 20 * 1024 * 1024;
export const giveawayOrganizerSchema = z.string().trim().max(80)
  .regex(/^[^\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]*$/u);
export const giveawayEditSchema = z.object({ pledgeId: id, organizer: giveawayOrganizerSchema }).strict();
const giveawayFileSchema = z.object({ schemaVersion: z.literal(1), accountId: z.uuid(),
  entries: z.array(giveawayEditSchema.extend({ organizer: giveawayOrganizerSchema.min(1) })).max(50000),
}).strict().refine(file => new Set(file.entries.map(entry => entry.pledgeId)).size === file.entries.length);

export type GiveawayEdit = z.infer<typeof giveawayEditSchema>;
export type GiveawayOriginsSnapshot = { accountId: string; entries: GiveawayEdit[] };

/** Profile-local annotations stay separate from imports and exports. */
export class GiveawayOriginsStore {
  constructor(private readonly directory: string) {}

  private file(accountId: string) {
    return path.join(this.directory, z.uuid().parse(accountId) + '.json');
  }

  private checkDirectory() {
    const stat = fs.lstatSync(this.directory, { throwIfNoEntry: false });
    if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) throw Error('GIVEAWAY_DIRECTORY');
  }

  private read(accountId: string) {
    const file = this.file(accountId);
    this.checkDirectory();
    const stat = fs.lstatSync(file, { throwIfNoEntry: false });
    if (!stat) return { schemaVersion: 1 as const, accountId, entries: [] as GiveawayEdit[] };
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes) throw Error('GIVEAWAY_FILE');
    const data = giveawayFileSchema.parse(JSON.parse(fs.readFileSync(file, 'utf8')));
    if (data.accountId !== accountId) throw Error('GIVEAWAY_ACCOUNT');
    return data;
  }

  snapshot(accountId: string): GiveawayOriginsSnapshot {
    return { accountId, entries: this.read(accountId).entries };
  }

  save(accountId: string, input: GiveawayEdit): GiveawayOriginsSnapshot {
    const entry = giveawayEditSchema.parse(input), data = this.read(accountId);
    const entries = new Map(data.entries.map(current => [current.pledgeId, current]));
    if (entry.organizer) entries.set(entry.pledgeId, entry);
    else entries.delete(entry.pledgeId);
    if (entries.size === 0 && data.entries.length === 0) return { accountId, entries: [] };
    const next = giveawayFileSchema.parse({ ...data, entries: [...entries.values()] });
    const bytes = Buffer.from(JSON.stringify(next), 'utf8');
    if (bytes.length > maxBytes) throw Error('GIVEAWAY_SIZE');
    fs.mkdirSync(this.directory, { recursive: true });
    this.checkDirectory();
    const temporary = path.join(this.directory, randomUUID() + '.pending');
    const fd = fs.openSync(temporary, 'wx');
    try {
      try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); }
      finally { fs.closeSync(fd); }
      fs.renameSync(temporary, this.file(accountId));
    } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    return { accountId, entries: next.entries };
  }
}
