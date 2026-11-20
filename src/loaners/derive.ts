import type { Pledge } from '../domain/model';
import { gameAccessEvidence } from '../domain/game-access';
import type { LoanerCache, LoanerSource } from './model';

/** Deliberate aliases only. No fuzzy match, chassis guess, or recursive grants from a loaner. */
const key = (value: string) => value.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
const aliases: Record<string, string> = {
  'hercules c2': 'c2 hercules starlifter', 'hercules m2': 'm2 hercules starlifter',
  'mpuv passenger': 'mpuv personnel', 'mpuv-personnel': 'mpuv personnel', 'mpuv cargo': 'mpuv-cargo',
  'idris-m frigate': 'idris-m', 'idris-p frigate': 'idris-p',
  'carrack expedition w/c8x': 'carrack expedition w/ c8x', 'carrack w/c8x': 'carrack w/ c8x',
};
const canonical = (value: string) => aliases[key(value)] ?? key(value);
const parentGroups: Record<string, string[]> = {
  '600i explorer and executive': ['600i Explorer','600i Executive Edition'],
  'carrack / carrack expedition': ['Carrack','Carrack Expedition'],
  'carrack w/ c8x / carrack expedition w/c8x': ['Carrack w/ C8X','Carrack Expedition w/ C8X'],
  'carrack expedition w/c8x': ['Carrack Expedition w/ C8X'],
  'carrack expedition w/ c8x': ['Carrack Expedition w/ C8X'],
  'carrack w/ c8x': ['Carrack w/ C8X'],
  'hull d, e': ['Hull D','Hull E'], 'idris-m & p': ['Idris-M','Idris-P'],
  'cyclone variants': ['Cyclone','Cyclone AA','Cyclone RC','Cyclone RN','Cyclone TR','Cyclone MT'],
  'fury variants': ['Fury','Fury MX','Fury LX'], 'g12 variants': ['G12','G12a','G12r'],
  'storm variants': ['Storm','Storm AA'], 'pulse (+ lx)': ['Pulse','Pulse LX'], 'x1 (+ velocity, force)': ['X1','X1 Velocity','X1 Force'],
};
function expandParents(parent: string): string[] | null {
  const expression=key(parent.replace(/\*$/, ''));
  return parentGroups[expression] ?? (/\bvariants\b|[+&/,()]/i.test(expression) ? null : [parent.replace(/\*$/, '')]);
}
export type LoanerOrigin = { pledgeId: string; childId: string; parent: string; publishedParent: string; kind: 'loaner' | 'included'; source: LoanerSource; replaces: string | null };
/** A published rule is never evidence of an individual account allocation. */
export type DerivedLoaner = { key: string; name: string; origins: LoanerOrigin[]; alsoOwned: boolean; accountVerification: 'unconfirmed' };
export type DerivedLoaners = { rows: DerivedLoaner[]; gameAccessObserved: boolean; partialRules: boolean };

export function deriveLoaners(pledges: readonly Pledge[], cache: LoanerCache | null): DerivedLoaners {
  const result: DerivedLoaners = { rows: [], gameAccessObserved: pledges.some(p => gameAccessEvidence(p).starCitizen), partialRules: false };
  if (!cache) return result;
  result.partialRules=[...cache.loaners.rows,...cache.included.rows].some(row=>!expandParents(row.parent));
  const owned = pledges.filter(p => !p.ccus.length && p.sourceValues.upgradeState !== 'unresolved').flatMap(p => p.ships
    .filter(s => s.role !== 'loaner' && s.role !== 'included').map(s => ({ p, s })));
  const ownedNames = new Set(owned.map(x => canonical(x.s.modelName))), rows = new Map<string, DerivedLoaner>();
  for (const { p, s } of owned) {
    const grants: { name: string; origin: LoanerOrigin }[] = [];
    for (const source of ['included','loaners'] as const) for (const row of cache[source].rows) {
      const parents=expandParents(row.parent);if(!parents)continue;
      if (!parents.some(parent => canonical(parent) === canonical(s.modelName))) continue;
      for (const child of row.children) {
        const name = canonical(child.name);
        // A permanent included craft also listed in the matrix is one grant from this parent.
        if (source === 'loaners' && grants.some(g => canonical(g.name) === name)) continue;
        grants.push({ name: child.name, origin: { pledgeId: p.pledgeId, childId: s.childId, parent: s.modelName, publishedParent: row.parent,
          kind: source === 'included' && !child.replaces ? 'included' : 'loaner', source, replaces: child.replaces } });
      }
    }
    for (const grant of grants) {
      const name = canonical(grant.name);
      if (!rows.has(name)) rows.set(name, { key: name, name: grant.name, origins: [], alsoOwned: ownedNames.has(name), accountVerification: 'unconfirmed' });
      const output = rows.get(name)!;
      if (!output.origins.some(o => o.pledgeId === grant.origin.pledgeId && o.childId === grant.origin.childId && o.source === grant.origin.source)) output.origins.push(grant.origin);
    }
  }
  result.rows = [...rows.values()].sort((a,b) => a.name.localeCompare(b.name, 'de')); return result;
}
