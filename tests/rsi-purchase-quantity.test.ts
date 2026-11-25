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

test('An old GBP order keeps its currency and matched purchase date while a documented EUR order takes precedence', () => {
  const log=purchaseMatches([{...basePledge('1'),name:title}],
    [{id:'1',title,owner:'Synthetic',order:order.id,value:'£20.00 GBP',date:'May 12 2019, 10:12 pm'}],'Synthetic');
  const pounds={...order,discount:'£0.00 GBP',lines:[{title,quantity:'1',total:'£20.00'}]};
  assert.deepEqual(purchasePrices(log,[pounds]).get('1'),{
    status:'documented',source:'order',minor:2000,currency:'GBP',purchaseDate:'2019-05-12',
  });
  assert.deepEqual(purchasePrices(log,[{...pounds,discount:'€0.00 EUR',lines:[{title,quantity:'1',total:'€24.00 EUR'}]}]).get('1'),
    {status:'documented',source:'order',minor:2400,currency:'EUR'});
  assert.deepEqual(purchasePrices(log,[]).get('1'),{
    status:'documented',source:'log',minor:2000,currency:'GBP',purchaseDate:'2019-05-12',
  });
});

test('A euro symbol alone identifies a documented amount, while an ambiguous or conflicting currency does not', () => {
  const log = (value: string) => purchaseMatches([{...basePledge('1'),name:title}],
    [{id:'1',title,owner:'Synthetic',order:order.id,value}],'Synthetic');
  assert.deepEqual(purchasePrices(log('€19.99'), []).get('1'),
    {status:'documented',source:'log',minor:1999,currency:'EUR'});
  assert.deepEqual(purchasePrices(evidence(1), [{...order,discount:'€0.00',lines:[{title,quantity:'2',total:'€39.98'}]}]).get('1'),
    {status:'documented',source:'order',minor:1999,currency:'EUR'});
  for (const value of ['$19.99', '€19.99 GBP', '19.99']) {
    assert.notEqual(purchasePrices(log(value), []).get('1')?.status, 'documented');
  }
});
