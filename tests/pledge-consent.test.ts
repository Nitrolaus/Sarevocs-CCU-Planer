import assert from 'node:assert/strict';
import test from 'node:test';
import { readWithPledgeConsent } from '../src/main/pledge-consent';

const total = { status: 'loaded', amountMinor: 4200, currency: 'USD' } as const;

test('RSI total is read only after successful Windows Hello', async () => {
  const calls: string[] = [];
  const result = await readWithPledgeConsent(() => true,
    async () => { calls.push('hello'); return 'verified'; },
    async () => { calls.push('read'); return total; });
  assert.deepEqual(calls, ['hello', 'read']);
  assert.deepEqual(result, total);
});

test('aborted, unavailable and superseded Windows Hello never start the RSI request', async () => {
  const read = async () => assert.fail('Billing request started without effective consent');
  assert.deepEqual(await readWithPledgeConsent(() => true, async () => 'cancelled', read), { status: 'cancelled' });
  assert.deepEqual(await readWithPledgeConsent(() => true, async () => 'unavailable', read), { status: 'hello-unavailable' });
  let current = true;
  assert.deepEqual(await readWithPledgeConsent(() => current,
    async () => { current = false; return 'verified'; }, read), { status: 'cancelled' });
});

test('profile change or hidden window discards an already in-flight total', async () => {
  let current = true;
  const result = await readWithPledgeConsent(() => current, async () => 'verified',
    async () => { current = false; return total; });
  assert.deepEqual(result, { status: 'cancelled' });
});
