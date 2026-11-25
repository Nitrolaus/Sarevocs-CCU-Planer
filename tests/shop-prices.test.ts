import test from 'node:test';
import assert from 'node:assert/strict';
import { shopPriceReader } from '../src/market/shop-prices';
import { commandSchema } from '../src/main/commands';

const pair = { fromId: 251, toId: 46 };
const standard = { id: 16323, title: 'Standard Edition', upgradePrice: 2500, available: true, unlimitedStock: true, availableStock: 0 };
const warbond = { ...standard, id: 16324, title: 'Warbond Edition', upgradePrice: 2000 };
const signal = new AbortController().signal;

test('reads the official amount for separate exact SKUs, skipping unavailable or ambiguous variants', async () => {
  const requests: {operationName:string;query:string;variables:Record<string,number>}[] = [];
  const reader = shopPriceReader(async body => {
    const [request] = JSON.parse(body);
    requests.push(request);
    if (request.operationName === 'getShipDetails') return [{data:{ship:{id:46,skus:[standard, warbond,
      {...warbond,id:16325,available:false}]}}}];
    const isStandard = request.variables.to === standard.id;
    return [{data:{app:{pricing:{currencyCode:'EUR',exponent:2,taxRate:1900,isTaxInclusive:true}},
      price:{amount:isStandard?2618:2094,nativeAmount:isStandard?2500:2000}}}];
  });
  const result = await reader(pair,signal);
  assert.deepEqual(result.map(({edition,amount}) => [edition,amount.minor,amount.currency,amount.taxMode,amount.vatBasisPoints]),
    [['standard',2618,'EUR','gross',1900],['warbond',2094,'EUR','gross',1900]]);
  assert.deepEqual(requests.map(({variables})=>variables),[{id:46,fromShipId:251},{from:251,to:16323},{from:251,to:16324}]);
  assert.ok(requests.every(({query}) => query.startsWith('query ') && !/mutation|cart|checkout/i.test(query)));
});

test('invalid currency or target identity cannot produce a quote', async () => {
  const unknown = shopPriceReader(async body => JSON.parse(body)[0].operationName === 'getShipDetails'
    ? [{data:{ship:{id:46,skus:[standard]}}}]
    : [{data:{app:{pricing:{currencyCode:'GBP',exponent:2,taxRate:1900,isTaxInclusive:true}},price:{amount:2618}}}]);
  assert.deepEqual(await unknown(pair, signal), []);
  const wrong = shopPriceReader(async () => [{data:{ship:{id:47,skus:[standard]}}}]);
  assert.deepEqual(await wrong(pair, signal), []);
  assert.equal(commandSchema.safeParse({action:'market.shopPrices',pairs:[{...pair,url:'https://example.invalid'}]}).success,false);
  assert.equal(commandSchema.safeParse({action:'market.shopPrices',pairs:[{fromId:46,toId:46}]}).success,false);
});

test('retries a missing amount for an available SKU without repeating the successful edition', async () => {
  const requestedSkuIds: number[] = [];
  const reader = shopPriceReader(async body => {
    const [request] = JSON.parse(body);
    if (request.operationName === 'getShipDetails') return [{ data: { ship: { id: pair.toId, skus: [standard, warbond] } } }];
    const id: number = request.variables.to;
    const missing = id === warbond.id && !requestedSkuIds.includes(id);
    requestedSkuIds.push(id);
    return [{ data: {
      app: { pricing: { currencyCode: 'USD', exponent: 2, taxRate: 0, isTaxInclusive: false } },
      price: missing ? null : { amount: id === warbond.id ? 2000 : 2500 },
    } }];
  });
  assert.deepEqual((await reader(pair, signal)).map(({ edition, amount }) => [edition, amount.minor]),
    [['standard', 2500], ['warbond', 2000]]);
  assert.deepEqual(requestedSkuIds, [standard.id, warbond.id, warbond.id]);
});

test('a failed details request is limited to two attempts and a valid unavailable offer needs only one', async () => {
  let attempts = 0;
  const failing = shopPriceReader(async () => { attempts++; throw new Error('offline'); });
  await assert.rejects(failing(pair, signal), /offline/);
  assert.equal(attempts, 2);

  attempts = 0;
  const unavailable = shopPriceReader(async () => {
    attempts++;
    return [{ data: { ship: { id: pair.toId, skus: [{ ...standard, available: false }] } } }];
  });
  assert.deepEqual(await unavailable(pair, signal), []);
  assert.equal(attempts, 1);
});

test('cancellation during the retry delay prevents a second request', async () => {
  const controller = new AbortController();
  let attempts = 0;
  const reader = shopPriceReader(async () => { attempts++; throw new Error('offline'); });
  const quote = reader(pair, controller.signal);
  await new Promise(resolve => setImmediate(resolve));
  controller.abort();
  await assert.rejects(quote, { name: 'AbortError' });
  assert.equal(attempts, 1);
});
