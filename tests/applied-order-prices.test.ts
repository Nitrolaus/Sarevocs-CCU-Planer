import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appliedOrderPrices, type PurchaseLogRow, type PurchaseOrder } from '../src/importers/rsi-purchase-data';

const title = 'Upgrade - MDC to Sabre Firebird Imperator Subscribers Edition';
const step = { from: 'MDC', to: 'Sabre Firebird Imperator Subscribers Edition', ccuPledgeId: '111', appliedAt: '2026-01-21 18:01' };
const row = { id: '111', owner: 'fixture', title, order: 'ORDER1', date: 'Jan 8 2026, 10:00 am', value: '€99.00 EUR' };
const order = { id: 'ORDER1', paid: true, discount: '€0.00 EUR', lines: [{ title, quantity: '1', total: '€15.00 EUR' }] };
const prices = (log:PurchaseLogRow[], orders:PurchaseOrder[]) => appliedOrderPrices([step], log, 'Fixture', orders);

test('applied Firebird subscriber CCU resolves only the paid item at its invoice price', () => {
  assert.deepEqual(prices([row], [order]).get('111'), { status: 'documented', source: 'order', currency: 'EUR', minor: 1500 });
  assert.equal(prices([row], []).size, 0);
  assert.equal(prices([row], [{ ...order, lines: [{ ...order.lines[0]!, title: 'Upgrade - MDC to Sabre Firebird' }] }]).size, 0);
  assert.equal(prices([{...row, id:'112'}], [order]).size, 0);
  assert.equal(prices([row, {id:'111', excluded:true}], [order]).size, 0);
  assert.equal(prices([row], [{...order, paid:false}]).size, 0);
  assert.equal(prices([row], [{...order, discount:'€2.00 EUR'}]).size, 0);
  assert.equal(prices([row], [{...order, lines:[...order.lines,...order.lines]}]).size, 0);
  assert.equal(prices([row], [order,order]).size, 0);
  assert.equal(prices([{...row, date:'Jan 22, 2026'}], [order]).size, 0);
  assert.equal(prices([row], [{...order, date:'Jan 22 2026'}]).size, 0);
  assert.equal(prices([row,row], [order]).size, 0);
  assert.equal(appliedOrderPrices([step,step], [row], 'Fixture', [order]).size, 0);
});
