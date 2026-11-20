import { z } from 'zod';

export const LOANER_ARTICLES = {
  loaners: { id: 360003093114, title: 'Loaner Ship Matrix', url: 'https://support.robertsspaceindustries.com/hc/en-us/articles/360003093114-Loaner-Ship-Matrix' },
  included: { id: 4408770370455, title: 'Included Vessels - Snub Fighters and Rovers', url: 'https://support.robertsspaceindustries.com/hc/en-us/articles/4408770370455-Included-Vessels-Snub-Fighters-and-Rovers' },
} as const;
export type LoanerSource = keyof typeof LOANER_ARTICLES;
const name = z.string().trim().min(1).max(160), at = z.iso.datetime({ offset: true });
export const articleSchema = z.object({ articleId: z.number().int(), updatedAt: at, fetchedAt: at,
  rows: z.array(z.object({ parent: name, children: z.array(z.object({ name, replaces: name.nullable() }).strict()).min(1).max(15) }).strict()).min(1).max(500) }).strict();
export type LoanerArticle = z.infer<typeof articleSchema>;
export const loanerCacheSchema = z.object({ schemaVersion: z.literal(1), loaners: articleSchema, included: articleSchema }).strict()
  .refine(x => x.loaners.articleId === LOANER_ARTICLES.loaners.id && x.included.articleId === LOANER_ARTICLES.included.id);
export type LoanerCache = z.infer<typeof loanerCacheSchema>;
export type LoanerSnapshot = { data: LoanerCache | null; pending: boolean; error: boolean };

/** Parse only the bounded two-column data table; HTML is never loaded or rendered. */
export function parseLoanerArticle(source: LoanerSource, value: unknown, fetchedAt = new Date().toISOString()): LoanerArticle {
  const article = (value as { article?: Record<string, unknown> } | null)?.article, expected = LOANER_ARTICLES[source];
  if (!article || article.id !== expected.id || article.title !== expected.title || article.locale !== 'en-us' ||
      article.html_url !== expected.url || typeof article.body !== 'string' || article.body.length > 256 * 1024) throw Error('LOANER_ARTICLE_FORMAT');
  const updatedAt = at.parse(article.updated_at);
  if (Date.parse(updatedAt) < Date.UTC(2000, 0, 1) || Date.parse(updatedAt) > Date.parse(fetchedAt) + 300000) throw Error('LOANER_SOURCE_TIME');
  const tables = [...article.body.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table\s*>/gi)];
  if (tables.length !== 1) throw Error('LOANER_TABLE_FORMAT');
  const table = tables[0]![1]!;
  if (/<(?:script|style|iframe|object|embed|img|input|svg)\b|\b(?:rowspan|colspan)\s*=/i.test(table)) throw Error('LOANER_TABLE_FORMAT');
  const text = (html: string) => {
    const entities: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', ndash: '–', mdash: '—' };
    const result = html.replace(/<[^>]*>/g, ' ').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (_, entity: string) => {
      if (entity.startsWith('#')) { const n = entity[1]?.toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
        if (!Number.isSafeInteger(n) || n < 32 || n > 0x10ffff || n >= 0xd800 && n <= 0xdfff) throw Error('LOANER_ENTITY'); return String.fromCodePoint(n); }
      if (!(entity.toLowerCase() in entities)) throw Error('LOANER_ENTITY'); return entities[entity.toLowerCase()]!;
    }).replace(/\s+/g, ' ').trim();
    if (/[<>&]|[\u0000-\u001f\u007f]/.test(result)) {
      // Ampersand is used by the published Idris-M & P parent expression.
      if (/[<>]|[\u0000-\u001f\u007f]/.test(result) || /&[^ ]*;/.test(result)) throw Error('LOANER_CELL_TEXT');
    }
    return name.parse(result);
  };
  const rows = [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi)].map(row => {
    const cells = [...row[1]!.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]\s*>/gi)];
    if (cells.length !== 2) throw Error('LOANER_COLUMN_FORMAT'); return cells.map(cell => text(cell[1]!));
  });
  const expectedHeader = source === 'loaners' ? ['YOUR SHIP', 'OUR LOANER(S)'] : ['Parent Ship', 'Included Vessel'];
  if (JSON.stringify(rows.shift()) !== JSON.stringify(expectedHeader) || rows.length < 1 || rows.length > 500) throw Error('LOANER_HEADER_FORMAT');
  const result = articleSchema.parse({ articleId: expected.id, updatedAt, fetchedAt, rows: rows.map(([parent, children]) => ({ parent,
    children: children!.split(',').map(child => {
      const replacement = /^(.+?)\*?\s*\(currently (.+)\)$/i.exec(child.trim());
      if (replacement) return { name: replacement[2]!.trim(), replaces: replacement[1]!.replace(/\*$/, '').trim() };
      if (/[()*]/.test(child)) throw Error('LOANER_CHILD_FORMAT'); return { name: child.trim(), replaces: null };
    }) })) });
  if (new Set(result.rows.map(row => row.parent.toLowerCase())).size !== result.rows.length) throw Error('LOANER_DUPLICATE_PARENT');
  return result;
}
