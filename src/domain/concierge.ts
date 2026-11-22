export type ConciergeRank = {
  status: 'loaded';
  rank: string;
  nextRank: string | null;
  progress: number | null;
} | {
  status: 'unavailable' | 'no-rank';
};

export type PledgeTotal =
  | { status: 'loaded'; amountMinor: number; currency: 'USD' | 'EUR' | 'GBP' }
  | { status: 'cancelled' | 'unavailable' | 'hello-unavailable' };
