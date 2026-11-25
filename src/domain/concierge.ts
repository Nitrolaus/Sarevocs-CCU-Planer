export type ConciergeRank = {
  status: 'loaded';
  rank: string;
  nextRank: string | null;
  progress: number | null;
} | { status: 'no-rank' } | ConciergeUnavailable;

export type ConciergeUnavailable =
  | { status: 'session-required' }
  | { status: 'unavailable'; reason?: 'response' | 'format' };

export type ObservedConciergeRank = Extract<ConciergeRank, { status: 'loaded' | 'no-rank' }>;

export type PledgeTotal =
  | { status: 'loaded'; amountMinor: number; currency: 'USD' | 'EUR' | 'GBP' }
  | { status: 'cancelled' | 'hello-unavailable' }
  | ConciergeUnavailable;
