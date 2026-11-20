import assert from 'node:assert/strict';
import { test } from 'node:test';
import { purchaseMatches, purchasePrices, type PurchaseOrder } from '../src/importers/rsi-purchase-data';
import { basePledge } from './fixtures';

const title = 'Standalone Ship - Synthetic Unit';
const order: PurchaseOrder = { id:'SYNTHETIC-ORDER', paid:true, discount:'€0.00 EUR',
  lines:[{title, quantity:'2', total:'€39.98 EUR'}] };
const evidence = (count: number) => {
  const pledges = Array.from({length:count}, (_, i) => ({ ...basePledge(String(i+1)), name:title }));
  return purchaseMatches(pledges, pledges.map(p => ({ id:p.pledgeId, title, owner:'Synthetic', order:order.id, value:'' })), null);
};

test('A paid order line records an exact unit amount for each matched pledge, even when one no longer appears', () => {
  for (const count of [1, 2]) {
    const prices = purchasePrices(evidence(count), [order]);
    assert.equal(prices.size, count);
    for (const price of prices.values()) assert.deepEqual(price, {status:'documented',source:'order',minor:1999,currency:'EUR'});
  }
});

test('Over-assigned, non-divisible, malformed and discounted multi-unit lines do not create purchase evidence', () => {
  assert.equal(purchasePrices(evidence(3), [order]).size, 0);
  const line = order.lines[0]!;
  for (const invalid of [
    {...order, discount:'€0.01 EUR'}, {...order, discount:'$0.00 USD'},
    {...order, lines:[{...line, total:'€39.99 EUR'}]},
    {...order, lines:[{...line, quantity:'0'}]}, {...order, lines:[{...line, quantity:'2.5'}]},
    {...order, lines:[line, line]},
  ]) assert.equal(purchasePrices(evidence(2), [invalid]).size, 0);
});
