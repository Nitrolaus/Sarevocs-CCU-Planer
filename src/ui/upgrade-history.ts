import type { Account, Pledge } from '../domain/model';
import type { UpgradeHistoryResult } from '../domain/upgrade-history';
import type { LastSeen } from '../storage/last-seen';

export type HistoryKey = { accountId: string; revision: string; pledgeId: string };
export type HistoryTooltipState = UpgradeHistoryResult | { status: 'loading' };
type Ticket = { context: string; generation: number; pledgeId: string; state: HistoryTooltipState };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const contextKey = (accountId: string, revision: string) => accountId + ':' + revision;
export const MAX_HISTORY_TOOLTIPS = 256;

/** One current profile/revision, bounded memoization and stale-response invalidation. */
export class HistoryTooltipCache {
  private context: string | null = null;
  private generation = 0;
  private values = new Map<string, HistoryTooltipState>();
  activate(accountId: string, revision?: string): void {
    const next = revision ? contextKey(accountId, revision) : null;
    if (next !== this.context) { this.clear(); this.context = next; }
  }
  clear(): void { this.values.clear(); this.generation++; }
  get(key: HistoryKey): HistoryTooltipState | undefined {
    return this.context === contextKey(key.accountId, key.revision) ? this.values.get(key.pledgeId) : undefined;
  }
  begin(key: HistoryKey): Ticket | null {
    if (this.context !== contextKey(key.accountId, key.revision) || this.values.has(key.pledgeId)) return null;
    if (this.values.size >= MAX_HISTORY_TOOLTIPS) this.values.delete(this.values.keys().next().value!);
    const state: HistoryTooltipState = { status: 'loading' };
    this.values.set(key.pledgeId, state);
    return { context: this.context, generation: this.generation, pledgeId: key.pledgeId, state };
  }
  finish(ticket: Ticket, result: UpgradeHistoryResult): boolean {
    if (ticket.context !== this.context || ticket.generation !== this.generation || this.values.get(ticket.pledgeId) !== ticket.state) return false;
    this.values.set(ticket.pledgeId, result); return true;
  }
}

export function historyKey(pledge: Pledge, account: Account | undefined, observed: LastSeen | null): HistoryKey | null {
  if (!account || account.mode !== 'real' || !observed || observed.accountId !== account.id ||
    !uuid.test(account.id) || !uuid.test(observed.revision) || !/^[1-9][0-9]{0,15}$/.test(pledge.pledgeId) ||
    !Number.isSafeInteger(Number(pledge.pledgeId)) || !pledge.ships.length || pledge.ccus.length || pledge.sourceValues.upgradeState === 'unresolved') return null;
  return { accountId: account.id, revision: observed.revision, pledgeId: pledge.pledgeId };
}

function rsiDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2})$/.exec(value);
  // RSI supplies displayed local time. Preserve it without inventing a timezone conversion.
  return match ? `${match[3]}.${match[2]}.${match[1]} ${match[4]}` : 'Datum nicht lesbar';
}
export function upgradeHistoryTitle(pledge: Pledge, eligible: boolean, state?: HistoryTooltipState): string {
  const original = 'Pledge: ' + pledge.name;
  if (!eligible) return original;
  const lines = [original, 'Aktuell: ' + pledge.ships.map(ship => ship.modelName).join(', ')];
  if (pledge.ships.length > 1) lines.push('Pledge-Protokoll, Zuordnung zu Paketkindern ungeprüft.');
  if (!state) lines.push('Upgrade-Verlauf beim Darüberfahren laden.');
  else if (state.status === 'loading') lines.push('Upgrade-Verlauf wird geladen …');
  else if (state.status === 'auth-required') lines.push('Upgrade-Verlauf benötigt eine gültige RSI-Sitzung.');
  else if (state.status === 'cancelled') lines.push('Upgrade-Verlauf abgebrochen.');
  else if (state.status === 'unavailable') lines.push('Upgrade-Verlauf derzeit nicht verfügbar.');
  else {
    if (state.partial) lines.push('Unvollständiges RSI-Pledge-Protokoll.');
    if (!state.steps.length) lines.push('Keine Upgrade-Schritte im abgerufenen RSI-Protokoll.');
    else {
      if (pledge.ships.length === 1 && state.steps.at(-1)?.to !== pledge.ships[0]?.modelName) lines.push('Protokollende passt nicht eindeutig zum aktuellen Modell.');
      lines.push('Upgrade-Schritte im RSI-Pledge-Protokoll (älteste zuerst):');
      for (const step of state.steps) lines.push(`${step.from} → ${step.to}${step.appliedAt ? ' · ' + rsiDate(step.appliedAt) : ' · Datum unbekannt'}`);
    }
  }
  return lines.join('\n');
}
