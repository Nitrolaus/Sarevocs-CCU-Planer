import type { Insurance, Pledge } from '../domain/model';

export type CcuInsuranceDisplay = { label: string; tone: 'neutral' | 'lti' | 'months' | 'check'; title: string };
const basis = 'Beim Anwenden bleibt die Basisversicherung erhalten. Ein ausdrücklich belegter CCU-Zusatz kann den Schutz erhöhen; die höhere Laufzeit gilt. Laufzeiten werden nicht addiert.';
const key = (insurance: Insurance) => insurance.kind === 'months' ? 'months:' + insurance.months : insurance.kind;

/** Presentation only: never computes a resulting policy or combines independent CCU bonuses. */
export function ccuInsuranceDisplay(pledge: Pick<Pledge, 'ccus' | 'insurance' | 'sourceValues'>): CcuInsuranceDisplay | null {
  const unresolved = pledge.sourceValues.upgradeState === 'unresolved';
  if (!pledge.ccus.length) {
    if (!unresolved) return null;
    const existing = pledge.insurance.kind === 'lti' ? ' Vorhandener Pledge-Beleg: LTI.'
      : pledge.insurance.kind === 'months' ? ` Vorhandener Pledge-Beleg: ${pledge.insurance.months} Monate.` : '';
    return { label: 'Basis gilt', tone: 'neutral', title: basis + ' CCU-Zuordnung ungeklärt; ein Versicherungszusatz wird daraus nicht abgeleitet.' + existing };
  }
  const kinds = new Set(pledge.ccus.map(ccu => key(ccu.insurance)));
  if (unresolved || kinds.size !== 1) return { label: 'Zusatz prüfen', tone: 'check',
    title: basis + ' Zusatzbelege sind unterschiedlich oder nicht eindeutig zugeordnet. CCU-Exemplare einzeln prüfen; kein gemeinsamer Höchstwert wird angenommen.' };
  const insurance = pledge.ccus[0]!.insurance;
  if (insurance.kind === 'lti') return { label: '+LTI', tone: 'lti', title: basis + ' Zusätzliches Lifetime Insurance ist für die CCU-Exemplare belegt.' };
  if (insurance.kind === 'months') return { label: `+${insurance.months} Mon.`, tone: 'months', title: basis + ` Zusatzbeleg der CCU-Exemplare: ${insurance.months} Monate.` };
  return { label: 'Basis gilt', tone: 'neutral', title: basis + ' Kein zusätzlicher Versicherungsbonus belegt.' };
}
