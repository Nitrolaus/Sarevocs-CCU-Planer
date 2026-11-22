import type { PledgeTotal } from '../domain/concierge';
import type { HelloConsent } from './windows-hello';

export async function readWithPledgeConsent(
  isCurrent: () => boolean,
  verify: () => Promise<HelloConsent>,
  read: () => Promise<PledgeTotal>,
): Promise<PledgeTotal> {
  if (!isCurrent()) return { status: 'cancelled' };
  const consent = await verify();
  if (!isCurrent() || consent === 'cancelled') return { status: 'cancelled' };
  if (consent !== 'verified') return { status: 'hello-unavailable' };
  const total = await read();
  return isCurrent() ? total : { status: 'cancelled' };
}
