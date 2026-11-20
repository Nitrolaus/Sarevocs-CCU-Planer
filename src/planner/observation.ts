import { z } from 'zod';
import type { Pledge } from '../domain/model';

export type ChainObservation = { kind: 'rsi-hangar'; observedAt: string } |
  { kind: 'rsi-imports'; observations: Readonly<Record<string, string>> };
export function ccuObservationTime(pledge: Pledge, observation?: ChainObservation): string | undefined {
  return observation?.kind === 'rsi-hangar' ? observation.observedAt : observation?.kind === 'rsi-imports' ? observation.observations[pledge.pledgeId] : undefined;
}
const pair = z.object({ from: z.string().trim().min(1).max(500), to: z.string().trim().min(1).max(500) }).strict();
const evidence = z.object({ resolution: z.enum(['structured-unique', 'structured-display-match']),
  sourceCandidates: z.literal(1), targetCandidates: z.number().int().min(1).max(100) }).strict()
  .refine(e => e.resolution === 'structured-unique' ? e.targetCandidates === 1 : e.targetCandidates > 1);

/** A dated observation of a standalone upgrade is distinct from verified RSI applicability.
 * File imports alone, title guesses and applied-upgrade history never establish this evidence. */
export function observedStandaloneCcu(pledge: Pledge, observation?: ChainObservation): boolean {
  const at = ccuObservationTime(pledge, observation);
  if (!at || !Number.isFinite(Date.parse(at)) ||
    Date.parse(at) > Date.now() + 5 * 60_000 || pledge.ccus.length !== 1 || pledge.ships.length !== 0 ||
    pledge.sourceValues.upgradeIssue || pledge.sourceValues.upgradeState === 'unresolved') return false;
  const ccu = pledge.ccus[0]!;
  if (ccu.status !== 'unverified' || ccu.applicability === 'rejected' || ccu.instanceId !== pledge.pledgeId + ':ccu') return false;
  try {
    const endpoints = pair.parse(JSON.parse(pledge.sourceValues.upgrade ?? 'null'));
    evidence.parse(JSON.parse(pledge.sourceValues.upgradeEvidence ?? 'null'));
    return endpoints.from === ccu.from && endpoints.to === ccu.to && endpoints.from !== endpoints.to;
  } catch { return false; }
}
