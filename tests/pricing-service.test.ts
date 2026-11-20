import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {PricingService,DEFAULT_DISPLAY_SETTINGS} from '../src/pricing/service';
const day=new Date(Date.now()-86400000).toISOString().slice(0,10);
const xml=(date=day)=>`<gesmes:Envelope><Cube><Cube time='${date}'><Cube currency='USD' rate='1.1052'/></Cube></Cube></gesmes:Envelope>`;
function dir(){const parent=path.resolve('work/temp/pricing-unit');fs.mkdirSync(parent,{recursive:true});return fs.mkdtempSync(path.join(parent,'case-'));}
test('First-run defaults are EUR net; reading does not write defaults or claim completed setup',()=>{const folder=dir(),s=new PricingService(folder,async()=>xml());assert.deepEqual(s.snapshot().settings,DEFAULT_DISPLAY_SETTINGS);assert.equal(s.snapshot().configured,false);assert.deepEqual(fs.readdirSync(folder),[]);s.close();});
test('Preferences survive restart and do not contain FX, account or session data',()=>{const folder=dir(),s=new PricingService(folder,async()=>xml()),settings={...DEFAULT_DISPLAY_SETTINGS,language:'en',taxMode:'gross',vatBasisPoints:850};s.save(settings);s.close();const next=new PricingService(folder,async()=>xml());assert.equal(next.snapshot().configured,true);assert.deepEqual(next.snapshot().settings,settings);assert.deepEqual(fs.readdirSync(folder),['display-v1.json']);next.close();});
test('Invalid settings cannot overwrite the last accepted preferences',()=>{const folder=dir(),s=new PricingService(folder,async()=>xml());s.save(DEFAULT_DISPLAY_SETTINGS);const before=fs.readFileSync(path.join(folder,'display-v1.json'),'utf8');for(const change of [{language:'fr'},{currency:'GBP'},{vatBasisPoints:-1},{vatBasisPoints:1900.1},{taxMode:'guess'},{token:'forbidden'}])assert.throws(()=>s.save({...DEFAULT_DISPLAY_SETTINGS,...change}));assert.equal(fs.readFileSync(path.join(folder,'display-v1.json'),'utf8'),before);s.close();});
test('an optional, dated shop quote survives restart and can be removed to restore ECB',()=>{
  const folder=dir(),s=new PricingService(folder,async()=>xml());
  const shopRate={eurPerUsdMicros:880000,observedOn:day};
  const settings={...DEFAULT_DISPLAY_SETTINGS,shopRate};
  s.save(settings);
  for(const invalid of [{...shopRate,observedOn:'2025-02-30'},{...shopRate,observedOn:'2999-01-01'},{...shopRate,eurPerUsdMicros:0},{...shopRate,eurPerUsdMicros:300000.5},{...shopRate,eurPerUsdMicros:10100000}]){
    assert.throws(()=>s.save({...settings,shopRate:invalid}));
  }
  s.close();
  const restored=new PricingService(folder,async()=>xml());
  assert.deepEqual(restored.snapshot().settings,settings);
  restored.save(DEFAULT_DISPLAY_SETTINGS);restored.close();
  const legacy=new PricingService(folder,async()=>xml());
  assert.deepEqual(legacy.snapshot().settings,DEFAULT_DISPLAY_SETTINGS);legacy.close();
});
test('Successful ECB refresh survives restart; source failures preserve the prior rate',async()=>{const folder=dir();let fail=false;const s=new PricingService(folder,async()=>{if(fail)throw Error('synthetic');return xml();});await s.refresh();assert.equal(s.snapshot().rate?.usdPerEurMicros,1105200);const before=fs.readFileSync(path.join(folder,'ecb-v1.json'),'utf8');fail=true;await s.refresh();assert.equal(s.snapshot().rateError,true);assert.equal(fs.readFileSync(path.join(folder,'ecb-v1.json'),'utf8'),before);s.close();const next=new PricingService(folder,async()=>xml());assert.equal(next.snapshot().rate?.sourceDate,day);next.close();});
test('A backwards source date never replaces a newer cached rate',async()=>{const folder=dir();let older=false;const s=new PricingService(folder,async()=>xml(older?'2001-01-01':day));await s.refresh();older=true;await s.refresh();assert.equal(s.snapshot().rate?.sourceDate,day);assert.equal(s.snapshot().rateError,true);s.close();});
test('Refreshes coalesce; closing cancels and discards late responses',async()=>{const folder=dir();let complete!:(value:string)=>void;let signal:AbortSignal|undefined;const s=new PricingService(folder,sig=>{signal=sig;return new Promise(resolve=>{complete=resolve;});});const first=s.refresh();assert.equal(s.refresh(),first);assert.equal(s.snapshot().pending,true);s.close();assert.equal(signal?.aborted,true);complete(xml());await first;assert.equal(s.snapshot().rate,null);assert.deepEqual(fs.readdirSync(folder),[]);});
test('Corrupt settings/cache are surfaced and never silently replaced during reading',()=>{const folder=dir();fs.writeFileSync(path.join(folder,'display-v1.json'),'{bad');fs.writeFileSync(path.join(folder,'ecb-v1.json'),'{bad');const s=new PricingService(folder,async()=>xml());assert.equal(s.snapshot().settingsError,true);assert.equal(s.snapshot().rateError,true);assert.equal(s.snapshot().configured,false);assert.equal(fs.readFileSync(path.join(folder,'display-v1.json'),'utf8'),'{bad');s.close();});
