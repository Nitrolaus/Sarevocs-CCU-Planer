import type { Pledge } from './model';

export type GameAccessEvidence = { starCitizen: boolean; squadron42: boolean; upgradeOnly: boolean };

/** Imported contents are evidence of an included copy, not the account's live Game Library selection. */
export function gameAccessEvidence(pledge: Pick<Pledge, 'sourceValues'>): GameAccessEvidence {
  const titles: string[] = [];
  for (const field of ['items', 'alsoContains'] as const) {
    const raw = pledge.sourceValues[field];
    if (typeof raw !== 'string' || raw.length > 4000) continue;
    try {
      const values: unknown = JSON.parse(raw);
      if (!Array.isArray(values) || values.length > 100 || values.some(value => !value || typeof value !== 'object' ||
          typeof value.title !== 'string' || value.title.length > 500)) continue;
      for (const value of values) titles.push(value.title.replace(/\s+/g, ' ').trim().toLowerCase());
    } catch { /* Unreadable source data never invents a game entitlement. */ }
  }
  const starCitizen = titles.includes('star citizen digital download');
  const squadron42 = titles.includes('squadron 42 digital download');
  return { starCitizen, squadron42, upgradeOnly: starCitizen && squadron42 };
}
