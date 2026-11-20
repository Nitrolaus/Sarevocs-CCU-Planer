import { z } from 'zod';

const repository = 'Nitrolaus/Sarevocs-CCU-Planer';
export const RELEASES_API_URL = `https://api.github.com/repos/${repository}/releases?per_page=10`;
export const releaseTagSchema = z.string().regex(/^v(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})(?:-(alpha|beta|rc)(?:\.(0|[1-9]\d{0,3}))?)?(?![\s\S])/);
const releaseSchema = z.object({
  tag_name: releaseTagSchema,
  draft: z.literal(false),
  published_at: z.string().min(1),
  body: z.string().nullable().optional(),
});

export type ReleaseUpdate = {
  tag: string;
  version: string;
  notes: Record<'de' | 'en', string[]>;
};

function versionParts(tag: string): [number, number, number] {
  const [major = 0, minor = 0, patch = 0] = tag.slice(1).split('-')[0]?.split('.').map(Number) ?? [];
  return [major, minor, patch];
}

function compareVersions(left: string, right: string): number {
  const [a, b, c] = versionParts(left);
  const [x, y, z] = versionParts(right);
  return a - x || b - y || c - z;
}

function releaseNotes(body: string): ReleaseUpdate['notes'] {
  const lines = body.slice(0, 24_000).split(/\r?\n/);
  const headings = lines.flatMap((line, index) => {
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line.trim());
    return match ? [{ index, level: match[1]!.length, text: match[2]! }] : [];
  });
  function notesFor(language: 'de' | 'en'): string[] {
    const topics = language === 'de' ? /^was ist neu\??$/i : /^what(?:['’]s| is) new\??$/i;
    const section = language === 'de' ? /^(?:deutsch|german|de)$/i : /^(?:english|en)$/i;
    const heading = headings.find(item => topics.test(item.text)) ?? headings.find(item => section.test(item.text));
    const localized = headings.some(item => /^(?:deutsch|german|de|english|en|was ist neu\??|what(?:['’]s| is) new\??)$/i.test(item.text));
    if (!heading && localized) return [];
    const end = heading ? headings.find(item => item.index > heading.index && item.level <= heading.level)?.index : undefined;
    return lines.slice(heading ? heading.index + 1 : 0, end)
      .filter(line => !/^\s*(?:#|```|~~~|<!--|>)/.test(line))
      .map(line => line.replace(/^\s*(?:[-+*]\s+|\d+[.)]\s+)/, '')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/<[^>]*>|https?:\/\/\S+/gi, '')
        .replace(/[*`_\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '')
        .trim())
      .filter(Boolean)
      .slice(0, 4)
      .map(line => line.length <= 240 ? line : line.slice(0, 237).trimEnd() + '…');
  }
  return { de: notesFor('de'), en: notesFor('en') };
}

export function findReleaseUpdate(raw: unknown, installedVersion: string): ReleaseUpdate | null {
  if (!Array.isArray(raw) || !releaseTagSchema.safeParse('v' + installedVersion).success) return null;
  let latest: z.infer<typeof releaseSchema> | undefined;
  for (const row of raw.slice(0, 10)) {
    const release = releaseSchema.safeParse(row);
    if (!release.success || compareVersions(release.data.tag_name, 'v' + installedVersion) <= 0) continue;
    if (!latest || compareVersions(release.data.tag_name, latest.tag_name) > 0 ||
        (compareVersions(release.data.tag_name, latest.tag_name) === 0 && !release.data.tag_name.includes('-'))) {
      latest = release.data;
    }
  }
  if (!latest) return null;
  const version = latest.tag_name.slice(1).replace(/-(alpha|beta|rc)/, (_match, channel: string) =>
    ' ' + ({ alpha: 'Alpha', beta: 'Beta', rc: 'RC' }[channel]));
  return { tag: latest.tag_name, version, notes: releaseNotes(latest.body ?? '') };
}

const refreshInterval = 60 * 60 * 1000;
const retryInterval = 5 * 60 * 1000;

export class ReleaseUpdates {
  private current: ReleaseUpdate | null = null;
  private pending?: Promise<ReleaseUpdate | null>;
  private nextCheckAt = 0;
  private readonly controller = new AbortController();

  constructor(
    private readonly installedVersion: string,
    private readonly read: (signal: AbortSignal) => Promise<unknown>,
    private readonly now = Date.now,
  ) {}

  check(): Promise<ReleaseUpdate | null> {
    if (this.controller.signal.aborted) return Promise.resolve(null);
    if (this.pending) return this.pending;
    if (this.now() < this.nextCheckAt) return Promise.resolve(this.current);
    this.pending = Promise.resolve().then(() => this.read(this.controller.signal)).then(raw => {
      if (this.controller.signal.aborted) return null;
      if (!Array.isArray(raw)) throw new Error('INVALID_RELEASE_LIST');
      this.current = findReleaseUpdate(raw, this.installedVersion);
      this.nextCheckAt = this.now() + refreshInterval;
      return this.current;
    }).catch(() => {
      this.nextCheckAt = this.now() + retryInterval;
      return this.controller.signal.aborted ? null : this.current;
    }).finally(() => { this.pending = undefined; });
    return this.pending;
  }

  async open(tag: string, openExternal: (url: string) => Promise<void>): Promise<{ opened: true } | null> {
    if (this.controller.signal.aborted || tag !== this.current?.tag || !releaseTagSchema.safeParse(tag).success) return null;
    await openExternal(`https://github.com/${repository}/releases/tag/${tag}`);
    return { opened: true };
  }

  close() {
    this.controller.abort();
  }
}
