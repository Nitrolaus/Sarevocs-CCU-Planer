import test from 'node:test';import assert from 'node:assert/strict';
import {openRsiUpgrades,RSI_UPGRADES_URL} from '../src/market/upgrade-link';
import {commandSchema} from '../src/main/commands';
test('upgrade opening accepts only a fieldless fixed action, never a URL, SKU, token or checkout instruction',()=>{
  assert.equal(commandSchema.safeParse({action:'market.openUpgrades'}).success,true);
  for(const field of ['url','shipId','from','to','sku','accountId','token','checkout','method'])assert.equal(commandSchema.safeParse({action:'market.openUpgrades',[field]:'SYNTHETIC_FORBIDDEN_FIELD'}).success,false,field);
});
test('the opener uses exactly the official current entry URL once, without prefill, cookies or purchase actions',async()=>{
  const calls:string[]=[];const result=await openRsiUpgrades(async url=>{calls.push(url)});
  assert.deepEqual(calls,['https://robertsspaceindustries.com/en/pledge/']);assert.equal(RSI_UPGRADES_URL,calls[0]);assert.deepEqual(result,{opened:true,prefilled:false});
});
test('external browser failure is propagated instead of reporting a successful opening',async()=>{
  await assert.rejects(openRsiUpgrades(async()=>{throw new Error('SYNTHETIC_OPEN_FAILURE')}),/SYNTHETIC_OPEN_FAILURE/);
});
