import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RsiPurchase } from '../src/domain/model';
import type { MarketSnapshot } from '../src/market/model';
import { historyCosts } from '../src/pricing/history-costs';
import { DEFAULT_DISPLAY_SETTINGS, type PricingSnapshot } from '../src/pricing/model';
import { basePledge } from './fixtures';

function fixture() {
  const receipt = (minor: number): RsiPurchase => ({ status: 'documented', source: 'order', minor, currency: 'USD' });
  const pledge = basePledge('1001');
  pledge.name = 'Standalone Ships - Hawk';
  pledge.ships[0]!.modelName = 'Hyūn';
  pledge.rsiPurchase = receipt(9100);
  const steps = [
    { step: { from: 'Hawk', to: 'Nova Tank', appliedAt: '2026-11-21 19:20', ccuPledgeId: '1002' }, price: receipt(910) },
    { step: { from: 'Nova', to: 'Hyūn', appliedAt: '2026-11-23 14:20', ccuPledgeId: '1003' }, price: receipt(4065) },
  ];
  const fetchedAt = new Date().toISOString();
  const display: PricingSnapshot = { settings: { ...DEFAULT_DISPLAY_SETTINGS, currency: 'USD', vatBasisPoints: 1900 },
    configured: true, settingsError: false, rate: null, pending: false, rateError: false };
  const market: MarketSnapshot = {
    schemaVersion: 1, pending: false, errors: { catalogue: null, offers: null },
    refreshSchedule: { hour: 17, timeZone: 'Europe/Berlin' }, offers: null,
    catalogue: { fetchedAt, ships: ([[154, 'Nova'], [111, 'Hyūn']] as const).map(([id, name]) => ({
      id, name, chassisId: null, manufacturer: 'Test', manufacturerCode: 'T',
      status: 'unknown', focus: '', length: null,
    })) },
    values: { schemaVersion: 1, fetchedAt, source: 'rsi-from-ships', currency: 'USD', taxBasis: 'net',
      items: [{ id: 111, name: 'Hyūn', minor: 20000 }] },
  };
  return { pledge, steps, display, market };
}

test('history compares the starting ship and applied CCU receipts with the current gross target price', () => {
  const { pledge, steps, display, market } = fixture();
  const summary = historyCosts(pledge, steps, false, display, market);
  assert.deepEqual(summary, { start: 'Hawk', target: 'Hyūn', knownMinor: 14075, approximate: false,
    paid: 14075, normal: 23800, difference: 9725, percentage: 41 });
  assert.equal(display.settings.taxMode, 'net');
  assert.equal(historyCosts(pledge, steps, false, display).difference, null);
});

test('unknown, duplicated and unallocated costs leave the total open', () => {
  const { pledge, steps, display, market } = fixture();
  const summarize = (prices: Parameters<typeof historyCosts>[1] = steps, partial = false, start = pledge) =>
    historyCosts(start, prices, partial, display, market);
  const first = steps[0]!, last = steps[1]!;
  const missing = summarize([first, { ...last, price: undefined }]);
  assert.equal(missing.knownMinor, 10010);
  assert.equal(missing.paid, null);
  assert.equal(missing.difference, null);
  assert.equal(summarize(steps, true).paid, null);
  const duplicate = summarize([first, { ...last, step: { ...last.step, ccuPledgeId: first.step.ccuPledgeId } }]);
  assert.equal(duplicate.knownMinor, 10010);
  assert.equal(duplicate.paid, null);
  const unknownBase = summarize(steps, false, { ...pledge, name: 'Packs - Ship and more' });
  assert.equal(unknownBase.knownMinor, 4975);
  assert.equal(unknownBase.paid, null);
  const noRate = historyCosts(pledge, steps, false, { ...display, settings: { ...display.settings, currency: 'EUR' } }, market);
  assert.equal(noRate.paid, null);
  assert.equal(noRate.normal, null);
});

test('Einzelschiff mit Lackierung und vollständig belegtem Subscriber-Upgrade zeigt die Summe beider Bestellpositionen', () => {
  const { pledge, display } = fixture();
  const order = (minor: number) => ({status:'documented', source:'order', currency:'EUR', minor} as const);
  display.settings.currency = 'EUR';
  pledge.name = 'Standalone Ships - MDC plus Icefront Camo Paint';
  pledge.ships[0]!.modelName = 'Sabre Firebird';
  pledge.rsiPurchase = order(4125);
  const step = {from:'MDC', to:'Sabre Firebird Imperator Subscribers Edition', appliedAt:'2026-02-03 09:17', ccuPledgeId:'1002'};
  const entries = [{step, price:order(9980)}];
  assert.equal(historyCosts(pledge, entries, false, display).paid, 14105);
  assert.equal(historyCosts(pledge, [{step}], false, display).paid, null);
  for (const name of ['Package - MDC plus Icefront Camo Paint', 'Standalone Ships - Other plus Icefront Camo Paint',
    'Standalone Ships - MDC plus Another Ship plus Icefront Camo Paint', 'Standalone Ships - MDC plus Another Ship']) {
    assert.equal(historyCosts({...pledge, name}, entries, false, display).paid, null);
  }
  assert.equal(historyCosts({...pledge, ships:[...pledge.ships, {...pledge.ships[0]!,childId:'2'}]}, entries, false, display).paid, null);
});
