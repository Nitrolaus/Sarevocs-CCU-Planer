import test from 'node:test';
import assert from 'node:assert/strict';
import { displayShopMinor, parseEcbRate, estimateMinor, euroRateIsStale, formatMinor, type EuroRate } from '../src/pricing/money';

const fetchedAt='2026-11-15T12:00:00Z';
const xml=(day='2026-11-13',usd="<Cube currency='USD' rate='1.1052'/>") => `<?xml version="1.0"?><gesmes:Envelope xmlns:gesmes="urn:gesmes"><Cube><Cube time='${day}'>${usd}<Cube currency='GBP' rate='0.83559'/></Cube></Cube></gesmes:Envelope>`;
const rate:EuroRate=parseEcbRate(xml(),fetchedAt);
const net={currency:'EUR' as const,taxMode:'net' as const,vatBasisPoints:1900};
test('ECB base is EUR: 275 USD becomes 248.82 EUR, not the inverse multiplication',()=>{
  assert.equal(rate.usdPerEurMicros,1_105_200);assert.equal(rate.sourceDate,'2026-11-13');
  assert.equal(estimateMinor(27500,net,rate),24882);assert.equal(estimateMinor(36000,net,rate),32573);
});
test('Net display applies no configured VAT; gross estimates explicitly apply it once',()=>{
  assert.equal(estimateMinor(27500,{...net,vatBasisPoints:2500},rate),24882);
  assert.equal(estimateMinor(27500,{...net,taxMode:'gross'},rate),29610);
  assert.equal(estimateMinor(27500,{...net,currency:'USD',taxMode:'gross'},null),32725);
});
test('Conversion and VAT are rounded together only at the final cent',()=>{
  assert.equal(estimateMinor(1,{...net,taxMode:'gross',vatBasisPoints:2500},{...rate,usdPerEurMicros:2_000_000}),1);
  assert.equal(estimateMinor(3,net,{...rate,usdPerEurMicros:2_000_000}),2);
  assert.equal(estimateMinor(0,net,rate),0);
});
test('Missing source amount or exchange rate stays unknown; USD does not need an FX rate',()=>{
  assert.equal(estimateMinor(null,net,rate),null);assert.equal(estimateMinor(undefined,net,rate),null);
  assert.equal(estimateMinor(27500,net,null),null);
  assert.equal(estimateMinor(27500,{...net,currency:'USD'},null),27500);
});
test('Bad amounts, fractional VAT basis points and unsupported currencies fail closed',()=>{
  for(const amount of [-1,1.2,NaN,Infinity,100_000_001])assert.throws(()=>estimateMinor(amount,net,rate));
  for(const vatBasisPoints of [-1,10001,1900.1,NaN])assert.throws(()=>estimateMinor(100,{...net,vatBasisPoints},rate));
  assert.throws(()=>estimateMinor(100,{...net,currency:'GBP' as 'EUR'},rate));
});
test('ECB parser accepts attribute order and exact decimal precision without binary-rate rounding',()=>{
  assert.equal(parseEcbRate(xml('2026-11-13','<Cube rate="1.000001" currency="USD" />'),fetchedAt).usdPerEurMicros,1_000_001);
});
test('Missing, duplicate, malformed or future dates/rates cannot become FX evidence',()=>{
  for(const body of [xml('2026-02-30'),xml('2026-11-16'),xml('2026-11-13',''),xml('2026-11-13',"<Cube currency='USD' rate='1.1'/><Cube currency='USD' rate='1.2'/>"),xml('2026-11-13',"<Cube currency='USD' rate='0.0'/>"),xml('2026-11-13',"<Cube currency='USD' rate='1e0'/>"),xml('2026-11-13',"<Cube currency='USD' rate='1.1234567'/>"),xml('2026-11-13',"<Cube currency='USD' rate='1.1' rate='1.2'/>"),'<html>Sign in</html>'])assert.throws(()=>parseEcbRate(body,fetchedAt));
});
test('ECB parsing never expands DTDs, entities or oversized XML',()=>{
  for(const body of ['<!DOCTYPE x [<!ENTITY y SYSTEM "file:///private">]>'+xml(),xml().replace('1.1052','&y;'),xml()+' '.repeat(65536)])assert.throws(()=>parseEcbRate(body,fetchedAt));
});
test('Weekend reference data is fresh; older than seven days is labelled stale',()=>{
  assert.equal(euroRateIsStale(rate,Date.parse(fetchedAt)),false);
  assert.equal(euroRateIsStale(rate,Date.parse('2026-11-21T00:00:00Z')),true);
});
test('Currency formatting follows the selected language',()=>{
  assert.match(formatMinor(24882,'EUR','de'),/^248,82\s*€$/);
  assert.equal(formatMinor(24882,'EUR','en'),'€248.82');
});
test('CCU shop display preserves real local prices and converts foreign quotes with tax applied once',()=>{
  const usd = { minor: 2500, currency: 'USD', taxMode: 'net', vatBasisPoints: 0 } as const;
  const eur = { minor: 2618, currency: 'EUR', taxMode: 'gross', vatBasisPoints: 1900 } as const;
  const gross = { ...net, taxMode: 'gross' } as const;
  assert.equal(displayShopMinor(eur, gross, null), 2618);
  assert.equal(displayShopMinor(usd, { ...net, currency: 'USD' }, null), 2500);
  assert.equal(displayShopMinor(usd, net, rate), 2262);
  assert.equal(displayShopMinor(usd, gross, rate), 2692);
  assert.equal(displayShopMinor(eur, { ...gross, currency: 'USD' }, rate), 2893);
  assert.equal(displayShopMinor(eur, { ...net, currency: 'USD' }, rate), 2431);
  assert.equal(displayShopMinor(usd, gross, null), null);
});
