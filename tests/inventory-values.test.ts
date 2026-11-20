import test from 'node:test';import assert from 'node:assert/strict';import {parseRsiPledgeValue,purchaseValue,inventoryAcquisitionPrice,currentShipValues,convertPurchaseValue} from '../src/pricing/inventory-values';import {demoDocument} from './fixtures';import type {MarketSnapshot} from '../src/market/model';import type {PricingSnapshot} from '../src/pricing/model';
test('RSI pledge values require explicit USD, known English grouping and whole cents; malformed values stay unknown',()=>{
 for(const [s,n]of [['$95.00 USD',9500],['95 USD',9500],['$1,234.56 USD',123456],['$0.00 USD',0]] as const){const v=parseRsiPledgeValue(s);assert.equal(v?.minor,n);assert.equal(v?.taxBasis,'net');}
 for(const s of ['',null,3500,'3500','$95','$95.00 EUR','200 UEC','$95,00 USD','$1,23.00 USD','$95.000 USD','-5 USD','5e2 USD','5 USD junk','$00.10 USD','$1000000.01 USD','5\n USD'])assert.equal(parseRsiPledgeValue(s),null,String(s));
});
test('RSI purchase value stays a single pledge total, does not invent personal acquisition cost and does not promote foreign raw fields',()=>{const p=demoDocument().pledges[0]!;p.acquisitionCost=null;p.sourceValues.pledgeValue='$95.00 USD';const before=JSON.stringify(p),v=purchaseValue(p,'rsi-dom-probe/1');assert.equal(v.kind,'rsi-pledge');assert.equal(v.value?.minor,9500);assert.equal(v.scope,'pledge-total');assert.equal(JSON.stringify(p),before);assert.equal(purchaseValue(p,'hangarlink-v2/1').value,null);p.acquisitionCost={minor:123,currency:'EUR',taxBasis:'gross',evidence:'Synthetic receipt'};assert.equal(purchaseValue(p,'sarevocs-json/1').value?.minor,123);});
test('inventory treats an unchanged RSI standalone as an estimate and never assigns a package or upgrade total to the current ship',()=>{
 const pledge=demoDocument().pledges[0]!;
 pledge.name='Standalone Ships - Starlite - Warbond';
 pledge.ships=[{childId:'test',modelName:'Starlite',modelId:null,identity:'unresolved',role:'unverified'}];
 pledge.ccus=[];
 pledge.acquisitionCost=null;
 pledge.sourceValues={pledgeValue:'$55.00 USD'};
 const source='rsi-dom-probe/1';
 assert.equal(inventoryAcquisitionPrice(pledge,source).value?.minor,5500);
 assert.equal(inventoryAcquisitionPrice({...pledge,name:'Standalone Ship - Starlite - IAE 2956 Warbond Edition'},source).value?.minor,5500);
 for(const name of ['Nine Tails Shogun Pack','Standalone Ships - Prospector']){
  assert.equal(inventoryAcquisitionPrice({...pledge,name},source).value,null);
 }
 assert.equal(inventoryAcquisitionPrice({...pledge,sourceValues:{pledgeValue:'$0.00 USD'}},source).value,null);
 assert.equal(inventoryAcquisitionPrice({...pledge,sourceValues:{pledgeValue:'$55.00 USD',pledgeConfigurationValue:'$5.00 USD'}},source).value,null);
 assert.equal(inventoryAcquisitionPrice({...pledge,sourceValues:{pledgeValue:'$55.00 USD',pledgeConfigurationValue:'unreadable'}},source).value,null);
 const receipt={minor:7500,currency:'EUR',taxBasis:'gross',evidence:'Synthetic receipt'} as const;
 assert.deepEqual(inventoryAcquisitionPrice({...pledge,name:'Synthetic bundle',acquisitionCost:receipt},source).value,receipt);
});
test('current model value uses the actual child, strict variant identity and freshness, independently for every package child',()=>{const p=demoDocument().pledges[0]!;p.ships=[{childId:'one',modelName:'C2 Hercules',modelId:null,identity:'unresolved',role:'unverified'},{childId:'two',modelName:'600i Touring Module',modelId:null,identity:'unresolved',role:'unverified'}];const at=new Date().toISOString(),market:MarketSnapshot={schemaVersion:1,catalogue:{fetchedAt:at,ships:[{id:162,name:'C2 Hercules',chassisId:null,manufacturer:'Test',manufacturerCode:'T',status:'unknown',focus:'',length:null},{id:140,name:'600i Touring',chassisId:null,manufacturer:'Test',manufacturerCode:'T',status:'unknown',focus:'',length:null}]},offers:null,values:{schemaVersion:1,source:'rsi-from-ships',fetchedAt:at,currency:'USD',taxBasis:'net',items:[{id:162,name:'C2 Hercules',minor:40000},{id:140,name:'600i Touring',minor:43500}]},pending:false,errors:{catalogue:null,offers:null},refreshSchedule:{hour:17,timeZone:'Europe/Berlin'}};const before=JSON.stringify([p,market]),v=currentShipValues(p,market);assert.equal(v[0]!.usdMinor,40000);assert.equal(v[1]!.usdMinor,null);assert.equal(JSON.stringify([p,market]),before);market.values!.fetchedAt=new Date(Date.now()-7*3600000).toISOString();assert.ok(currentShipValues(p,market).every(v=>v.usdMinor===null));});
test('historical USD to EUR is a current-FX reference, never inflated by current VAT or applied twice to old gross receipts',()=>{const at=new Date().toISOString(),d:PricingSnapshot={configured:true,settingsError:false,pending:false,rateError:false,settings:{schemaVersion:1,language:'de',currency:'EUR',taxMode:'gross',vatBasisPoints:1900},rate:{source:'ECB',sourceDate:at.slice(0,10),usdPerEurMicros:1100000,fetchedAt:at}};assert.deepEqual(convertPurchaseValue(parseRsiPledgeValue('$95.00 USD'),d),{minor:8636,approximate:true});assert.deepEqual(convertPurchaseValue({minor:12345,currency:'EUR',taxBasis:'gross',evidence:'synthetic'},d),{minor:12345,approximate:false});assert.equal(convertPurchaseValue(parseRsiPledgeValue('$95.00 USD'),{...d,rate:null}).minor,null);});
