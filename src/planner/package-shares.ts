import { z } from 'zod';
import { id, text, type Pledge } from '../domain/model';
import { parseRsiPledgeValue } from '../pricing/inventory-values';
import { ccuObservationTime, type ChainObservation } from './observation';

const shareMinor = z.number().int().min(0).max(100_000_000);
const basisSchema = z.object({
  pledgeId: id,
  childId: id,
  modelName: text,
  totalMinor: shareMinor.min(1),
  currency: z.enum(['EUR', 'USD']),
}).strict();
export const packageShareEditSchema = basisSchema.extend({ minor: shareMinor.nullable() }).strict();
const shareSchema = basisSchema.extend({ minor: shareMinor }).strict();
export type PackageBasis = z.infer<typeof basisSchema>;
export type PackageShare = z.infer<typeof shareSchema>;
export type PackageShareEdit = z.infer<typeof packageShareEditSchema>;

export function packageKey(basis: PackageBasis) {
  return JSON.stringify([basis.pledgeId, basis.totalMinor, basis.currency]);
}

export function samePackageBasis(a: PackageBasis, b: PackageBasis) {
  return packageKey(a) === packageKey(b) && a.childId === b.childId && a.modelName === b.modelName;
}

export const packageSharesSchema = z.array(shareSchema).max(10000).refine(shares => {
  const used = new Map<string, number>(), ships = new Set<string>();
  for (const share of shares) {
    const packageId = packageKey(share), shipId = JSON.stringify([packageId, share.childId]);
    const total = (used.get(packageId) ?? 0) + share.minor;
    if (ships.has(shipId) || total > share.totalMinor) return false;
    ships.add(shipId);
    used.set(packageId, total);
  }
  return true;
});

/** A share is only meaningful against an observed order for the unchanged package. */
export function packageBasis(pledge: Pledge | undefined, childId: string, observation?: ChainObservation): PackageBasis | null {
  if (!pledge || pledge.ships.length < 2 || pledge.insurance.kind !== 'lti' || pledge.ccus.length ||
      pledge.sourceValues.upgradeState === 'unresolved') return null;
  const receipt = pledge.rsiPurchase;
  const observedAt = ccuObservationTime(pledge, observation);
  const configuration = pledge.sourceValues.pledgeConfigurationValue;
  if (receipt?.status !== 'documented' || receipt.source !== 'order' || !observedAt || !Number.isFinite(Date.parse(observedAt)) ||
      configuration && parseRsiPledgeValue(configuration)?.minor !== 0) return null;
  const ships = pledge.ships.filter(ship => ship.role !== 'included' && ship.role !== 'loaner');
  const matches = ships.filter(ship => ship.childId === childId);
  if (ships.length < 2 || matches.length !== 1) return null;
  return { pledgeId: pledge.pledgeId, childId, modelName: matches[0]!.modelName, totalMinor: receipt.minor, currency: receipt.currency };
}
