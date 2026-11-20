import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { MarketCache, TargetOffer } from './model';

type Offers = NonNullable<MarketCache['offers']>;
const clock = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
});
const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
function berlinTime(time: number) {
  const parts = Object.fromEntries(clock.formatToParts(time).map(part => [part.type, part.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

const date = z.iso.datetime({ offset: true });
const timestamp = z.number().int().min(1_577_836_800_000).max(4_102_444_800_000);
const id = z.number().int().positive().max(1_000_000_000);
const exhibitionSchema = z.object({
  key: z.string().regex(/^(iae|defense-con)-\d{4}$/),
  name: z.string().trim().min(1).max(160),
  start: timestamp,
  end: timestamp,
}).strict().refine(event => event.end > event.start && event.end - event.start <= 32 * 86400_000);
type Exhibition = z.infer<typeof exhibitionSchema>;
const calendarSchema = z.object({ v: z.literal(1), now: z.array(z.unknown()).max(100) });
const calendarEntrySchema = z.object({ name: z.string().trim().min(1).max(160), start: timestamp, end: timestamp });

function containsExhibition(outer: Exhibition, inner: Exhibition): boolean {
  return outer.key === inner.key && outer.start <= inner.start && outer.end >= inner.end
    && (outer.start < inner.start || outer.end > inner.end);
}

export function activeExhibition(raw: unknown, now: number): Exhibition | null {
  const candidates: Exhibition[] = [];
  for (const value of calendarSchema.parse(raw).now) {
    const result = calendarEntrySchema.safeParse(value);
    if (!result.success) continue;
    const event = result.data;
    if (now < event.start || now >= event.end || /\bfree[ -]fly\b/i.test(event.name)) continue;
    const family = /\b(?:intergalactic aerospace expo|iae)\b/i.test(event.name) ? 'iae'
      : /\b(?:defense[ -]?con|invictus launch week)\b/i.test(event.name) ? 'defense-con' : null;
    if (!family) continue;
    const candidate = exhibitionSchema.safeParse({ ...event, key: family + '-' + berlinTime(event.start).day.slice(0, 4) });
    if (candidate.success) candidates.push(candidate.data);
  }
  return candidates.filter(event => !candidates.some(other => containsExhibition(other, event)))
    .sort((a, b) => b.start - a.start || a.name.localeCompare(b.name))[0] ?? null;
}

export const fairNoticeIdSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}:openh:[1-9]\d{0,9}:[1-9]\d{0,9}$/);
const noticeSchema = z.object({
  id: fairNoticeIdSchema, offerKey: z.string().regex(/^openh:[1-9]\d{0,9}:[1-9]\d{0,9}$/),
  shipId: id, targetName: z.string().trim().min(1).max(240), usdMinor: z.number().int().positive().max(100_000_000),
  observedAt: date, day: daySchema, seen: z.boolean(),
}).strict();
type Notice = z.infer<typeof noticeSchema>;
const journalSchema = z.object({
  schemaVersion: z.literal(1), fromDay: daySchema, exhibition: exhibitionSchema.nullable(),
  comparedAt: date.nullable(), notices: z.array(noticeSchema).max(2000),
}).strict();
type Journal = z.infer<typeof journalSchema>;
export type FairNews = {
  exhibition: string | null; sourceAt: string | null;
  status: 'unavailable' | 'inactive' | 'waiting' | 'fresh';
  unread: (Omit<Notice, 'seen'> & { currentUsdMinor: number | null })[];
};

export function pricedWarbond(offer: TargetOffer): offer is TargetOffer & { warbondMinor: number } {
  return offer.change !== 'missing' && offer.warbond && offer.warbondMinor !== null
    && offer.warbondMinor > 0 && offer.warbondMinor < offer.regularMinor;
}

function observe(journal: Journal, older: Offers, newer: Offers) {
  const time = Date.parse(newer.sourceAt);
  if (time <= Date.parse(older.sourceAt) || (journal.comparedAt && time <= Date.parse(journal.comparedAt))) return;
  const { day } = berlinTime(time);
  const event = journal.exhibition!;
  if (day < journal.fromDay || time < event.start || time >= event.end) return;
  const previous = new Set(older.items.filter(offer => offer.change !== 'missing' && offer.warbond).map(offer => offer.toShipId));
  const seenIds = new Set(journal.notices.map(notice => notice.id));
  for (const offer of newer.items.filter(pricedWarbond)) {
    const noticeId = `${day}:${offer.key}`;
    if (previous.has(offer.toShipId) || seenIds.has(noticeId)) continue;
    journal.notices.push({
      id: noticeId, offerKey: offer.key, shipId: offer.toShipId, targetName: offer.targetName,
      usdMinor: offer.warbondMinor, day, observedAt: newer.sourceAt, seen: false,
    });
    seenIds.add(noticeId);
    previous.add(offer.toShipId);
  }
  journal.comparedAt = newer.sourceAt;
}

/** Local to this installation's data directory. No account identifiers or RSI session data. */
export class FairNewsStore {
  private readonly file: string;
  private journal: Journal;
  private unreadable = false;
  private updateFailed = false;
  private calendarKnown = false;

  constructor(directory: string, installedAt: number) {
    this.file = path.join(directory, 'fair-news-v1.json');
    this.journal = { schemaVersion: 1, fromDay: berlinTime(installedAt).day, exhibition: null, comparedAt: null, notices: [] };
    try {
      const stat = fs.lstatSync(this.file);
      if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error('FAIR_NEWS_FILE');
      this.journal = journalSchema.parse(JSON.parse(fs.readFileSync(this.file, 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.unreadable = true;
    }
  }

  private save(next: Journal) {
    const bytes = Buffer.from(JSON.stringify(journalSchema.parse(next)));
    if (bytes.length > 1024 * 1024) throw new Error('FAIR_NEWS_SIZE');
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temp = this.file + '-' + randomUUID() + '.tmp';
    try {
      fs.writeFileSync(temp, bytes, { flag: 'wx' });
      fs.renameSync(temp, this.file);
      this.journal = next;
    } finally {
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
    }
  }

  record(calendar: unknown | undefined, older: Offers | null, newer: Offers | null, now: number, history: () => Offers[]) {
    if (this.unreadable) return;
    const next = structuredClone(this.journal);
    try {
      let expanded = false;
      if (calendar !== undefined) {
        let exhibition;
        try {
          exhibition = activeExhibition(calendar, now);
          this.calendarKnown = true;
        } catch { this.calendarKnown = false; }
        const previous = next.exhibition;
        if (exhibition && exhibition.key !== previous?.key) {
          next.exhibition = exhibition;
          next.comparedAt = null;
          next.notices = [];
        } else if (exhibition && previous && !containsExhibition(previous, exhibition)) {
          expanded = exhibition.start < previous.start;
          next.exhibition = exhibition;
        }
      }
      if (next.exhibition && newer) {
        const checkpoint = next.comparedAt;
        const replay = expanded || !checkpoint || (!!older && Date.parse(checkpoint) < Date.parse(older.sourceAt));
        if (expanded) next.comparedAt = null;
        const snapshots = new Map<string, Offers>();
        for (const batch of [...(replay ? history() : []), ...(older ? [older] : []), newer]) snapshots.set(batch.sourceAt, batch);
        const ordered = [...snapshots.values()].sort((a, b) => Date.parse(a.sourceAt) - Date.parse(b.sourceAt));
        for (let index = 1; index < ordered.length; index++) observe(next, ordered[index - 1]!, ordered[index]!);
        if (checkpoint && (!next.comparedAt || Date.parse(next.comparedAt) < Date.parse(checkpoint))) next.comparedAt = checkpoint;
      }
      if (JSON.stringify(next) !== JSON.stringify(this.journal)) this.save(next);
      this.updateFailed = false;
    } catch {
      this.updateFailed = true;
    }
  }

  markSeen(noticeId: string) {
    if (this.unreadable) throw new Error('FAIR_NEWS_UNAVAILABLE');
    const next = structuredClone(this.journal);
    const notice = next.notices.find(item => item.id === noticeId);
    if (notice && !notice.seen) {
      notice.seen = true;
      this.save(next);
    }
  }

  snapshot(offers: Offers | null, now: number, offersFailed: boolean): FairNews {
    const today = berlinTime(now);
    const comparison = this.journal.comparedAt;
    const observed = comparison ? berlinTime(Date.parse(comparison)) : null;
    const status = this.unreadable || this.updateFailed ? 'unavailable'
      : !this.journal.exhibition ? (this.calendarKnown ? 'inactive' : 'unavailable')
      : now >= this.journal.exhibition.end ? 'inactive'
      : offersFailed || observed?.day !== today.day || observed.hour < 17 ? 'waiting' : 'fresh';
    const activePrices = new Map((offers?.items ?? []).filter(pricedWarbond).map(offer => [offer.key, offer.warbondMinor]));
    return {
      exhibition: this.journal.exhibition?.name ?? null, sourceAt: offers?.sourceAt ?? null, status,
      unread: this.journal.notices.filter(notice => !notice.seen).sort((a, b) => b.observedAt.localeCompare(a.observedAt))
        .map(({ seen: _seen, ...notice }) => ({ ...notice, currentUsdMinor: activePrices.get(notice.offerKey) ?? null })),
    };
  }
}

/** NSIS writes the local uninstaller during installation. Portable builds use their first start. */
export function fairInstallationTime(executable: string | null, now: number): number {
  if (executable) {
    try {
      const stat = fs.lstatSync(path.join(path.dirname(executable), 'Uninstall.exe'));
      if (stat.isFile() && stat.mtimeMs >= 1_577_836_800_000 && stat.mtimeMs <= now) return stat.mtimeMs;
    } catch { /* Portable and development runs start observing on their first launch. */ }
  }
  return now;
}
