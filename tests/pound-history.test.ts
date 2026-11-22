import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePoundHistory, poundRateFor } from '../src/pricing/pound-history';
import { convertPurchaseValue, type AcquisitionValue } from '../src/pricing/inventory-values';
import { DEFAULT_DISPLAY_SETTINGS, type PricingSnapshot } from '../src/pricing/model';
import { paidCcuCost } from '../src/planner/costs';
import type { ChainStep } from '../src/planner/chain';
import type { Pledge } from '../src/domain/model';
import { basePledge } from './fixtures';

const history=parsePoundHistory("<gesmes:Envelope><Cube><Cube time='2019-05-10'><Cube currency='USD' rate='1.125'/><Cube currency='GBP' rate='0.8'/></Cube><Cube time='2019-05-13'><Cube currency='USD' rate='1.12'/><Cube currency='GBP' rate='0.9'/></Cube></Cube></gesmes:Envelope>");
const purchaseDate='2019-05-12', rate=poundRateFor(history,purchaseDate)!;
const display:PricingSnapshot={settings:{...DEFAULT_DISPLAY_SETTINGS,taxMode:'gross'},configured:true,settingsError:false,rate:null,pending:false,rateError:false};
const documented:AcquisitionValue={minor:10000,currency:'GBP',taxBasis:'unknown',evidence:'Test',purchaseDate,poundRate:rate};

test('A weekend GBP purchase uses the last previous ECB rate in the receipt currency conversion',()=>{
  assert.equal(rate.sourceDate,'2019-05-10');
  assert.deepEqual(convertPurchaseValue(documented,display),{minor:12500,approximate:true});
  assert.deepEqual(convertPurchaseValue(documented,{...display,settings:{...display.settings,currency:'USD'}}),{minor:14063,approximate:true});
  assert.equal(poundRateFor(history,'2019-05-08'),undefined);
  assert.equal(poundRateFor(history,'2019-06-12'),undefined);
  assert.throws(()=>parsePoundHistory('<!DOCTYPE foo><gesmes:Envelope></gesmes:Envelope>'));
});

test('A missing or mismatched purchase date leaves the converted amount open',()=>{
  assert.equal(convertPurchaseValue({...documented,purchaseDate:undefined},display).minor,null);
  assert.equal(convertPurchaseValue({...documented,poundRate:undefined},display).minor,null);
  assert.equal(convertPurchaseValue({...documented,purchaseDate:'2019-05-09'},display).minor,null);
});

test('A paid RSI CCU order contributes the historical GBP conversion once, while an unpriced receipt stays open',()=>{
  const from={key:'matrix:1',name:'Start',catalogueConfirmed:true,nominalUsd:6000};
  const to={key:'matrix:2',name:'Target',catalogueConfirmed:true,nominalUsd:8000};
  const owned={key:'example',pledgeId:'123',instanceId:'123:ccu',from,to,warbond:true,applicabilityConfirmed:true,protected:false};
  const step:ChainStep={...owned,kind:'owned',ccu:owned};
  const p:Pledge={...basePledge('123'),ships:[],acquisitionCost:null,
    ccus:[{instanceId:owned.instanceId,from:from.name,to:to.name,status:'unverified',applicability:'unverified',insurance:{kind:'unknown',reason:'Fixture'}}],
    sourceValues:{upgrade:JSON.stringify({from:from.name,to:to.name}),upgradeEvidence:JSON.stringify({resolution:'structured-unique',sourceCandidates:1,targetCandidates:1})},
    rsiPurchase:{status:'documented',source:'order',minor:10000,currency:'GBP',purchaseDate,poundRate:rate}};
  const observation={kind:'rsi-hangar' as const,observedAt:'2026-11-22T12:00:00Z'};
  assert.equal(paidCcuCost(step,[p],display,observation).minor,12500);
  assert.equal(paidCcuCost(step,[{...p,rsiPurchase:{status:'documented',source:'order',minor:10000,currency:'GBP'}}],display,observation).minor,null);
});
