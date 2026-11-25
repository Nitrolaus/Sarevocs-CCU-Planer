import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { InventoryItem } from '../src/domain/model';
import { appliedCcuPrice, historicCcuPurchases } from '../src/domain/applied-ccu-price';
import { basePledge } from './fixtures';

test('applied CCU price requires the exact documented purchase from this RSI account', () => {
  const pledge = basePledge('2468');
  pledge.ships = [];
  pledge.ccus = [{ instanceId: '2468:ccu', from: 'Hawk', to: 'Nova Tank', status: 'unverified',
    applicability: 'unverified', insurance: pledge.insurance }];
  pledge.rsiPurchase = { status: 'documented', source: 'order', minor: 500, currency: 'GBP' };
  const item: InventoryItem = { pledge, availability: 'removed', source: 'rsi-dom-probe/1', importedAt: '2026-11-20T00:00:00Z' };
  const step = { from: 'Hawk', to: 'Nova Tank', appliedAt: '2026-11-23 18:00', ccuPledgeId: pledge.pledgeId };
  const purchases = historicCcuPurchases([item], []);

  assert.deepEqual(appliedCcuPrice(step, purchases), pledge.rsiPurchase);
  assert.equal(appliedCcuPrice({ ...step, to: 'Talon' }, purchases), undefined);
  assert.equal(appliedCcuPrice({ ...step, ccuPledgeId: undefined }, purchases), undefined);
  assert.equal(appliedCcuPrice({ ...step, ccuPledgeId: '2469' }, purchases), undefined);
  assert.equal(appliedCcuPrice(step, historicCcuPurchases([item], [pledge])), undefined);
  assert.equal(appliedCcuPrice(step, historicCcuPurchases([{ ...item, source: 'sarevocs-json/1' }], [])), undefined);
});
