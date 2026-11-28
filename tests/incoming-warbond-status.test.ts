import test from 'node:test';
import assert from 'node:assert/strict';
import { incomingWarbondStatus } from '../src/planner/incoming-warbond-status';
import type { IncomingAdvice } from '../src/planner/incoming-warbonds';

const advice = (count: number, purchaseGaps = 1): IncomingAdvice => ({ state: 'ready', purchaseGaps,
  candidates: Array.from({ length: count }, (_, i) => ({ fromId: i + 1, toId: 10,
    from: {} as never, target: {} as never, relation: 'fits-gap' })) });

test('an all-owned route, no offer, and already-owned matching offers have different reasons', () => {
  assert.equal(incomingWarbondStatus(advice(0, 0), [], 0), 'covered');
  assert.equal(incomingWarbondStatus(advice(0), [], 0), 'no-offers');
  assert.equal(incomingWarbondStatus(advice(3), ['free', 'reserved', 'locked'], 0), 'already-owned');
});
test('missing/expired/non-discounted quotes do not establish absence or ownership', () => {
  assert.equal(incomingWarbondStatus(advice(1), ['missing'], 0), 'unconfirmed');
  assert.equal(incomingWarbondStatus(advice(2), ['free', 'missing'], 0), 'unconfirmed');
  assert.equal(incomingWarbondStatus(advice(2), ['missing', 'unknown'], 0), 'stock-unknown');
  assert.equal(incomingWarbondStatus(advice(2), ['free'], 0), 'stock-unknown');
});
test('unavailable route/market retain their own reason, and visible quotes need no empty status', () => {
  for (const state of ['target-required', 'base-required', 'chain-unavailable', 'market-unavailable'] as const)
    assert.equal(incomingWarbondStatus({ state, candidates: [] }, [], 0), state);
  assert.equal(incomingWarbondStatus(advice(2), ['missing', 'free'], 1), null);
});
