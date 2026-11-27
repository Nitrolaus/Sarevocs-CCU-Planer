import test from 'node:test';
import assert from 'node:assert/strict';
import {inventoryAddons} from '../src/domain/inventory-addons';
import {parseImport} from '../src/importers/files';
import {basePledge} from './fixtures';

const source = 'rsi-dom-probe/1';

test('RSI generic FPS Equipment is classified by explicit object names, including translated punctuation',()=>{
 const definitions = [
  ['Hedeby Arlington Everglade Rifle','weapons'], ['Gemini R97 Runic Shotgun','weapons'],
  ['Behring P8-SC Echo SMG','weapons'], ['Eyaja Knife','weapons'], ['VCK-1 Payback Blade','weapons'],
  ['Overlord Supernova Helmet','armor'], ['Overlord Supernova Core','armor'],
  ['Overlord Supernova Arms','armor'], ['Overlord Supernova Legs','armor'],
  ['RSI Zeus Echo Exploration Suit','armor'], ['Wastelander Undersuit','armor'],
  ['Bobcat Varsity Jacket','clothing'], ['Wally Retro T-Shirt','clothing'], ['Retro T\u2011Shirt','clothing'],
  ['Foundation Festival Beanie Black','clothing'], ['Yaeger Aviator Glasses','clothing'],
  ['Carmilla Nightstand','decorations'], ['Zeus Best in Show Poster','decorations'],
  ['CitizenCon Trophy','collectibles'], ['Banu Lockbox Replica','collectibles'],
  ['Greycat Multi-Tool','other'], ['Unlisted Model Code','other'],
 ] as const;
 const entry=addon('fps',definitions.map(([title])=>({title,kind:'FPS\n Equipment'})));
 const before=JSON.stringify(entry);
 assert.deepEqual(inventoryAddons([entry]).map(r=>r.category),definitions.map(d=>d[1]));
 assert.equal(JSON.stringify(entry),before);
});

test('supplementary gear without a source kind inherits clear armor-set context and keeps each copy',()=>{
 const entry=addon('bundle',[{title:'Synthetic Helmet',kind:'FPS Equipment'}]);
 entry.pledge.sourceValues.alsoContains=JSON.stringify([{title:'Synthetic Core'},{title:'Synthetic Arms'},
  {title:'Synthetic Legs'},{title:'Synthetic Pistol'},{title:'Synthetic Jacket'}]);
 const rows=inventoryAddons([entry]);
 assert.deepEqual(rows.map(r=>r.category),['armor','armor','armor','armor','weapons','clothing']);
 assert.ok(rows.every(r=>r.purchase===null));
 const single=addon('ambiguous-core',[{title:'Apple Core'}]);
 assert.equal(inventoryAddons([single])[0]!.category,'other');
});

test('decorative gear names, explicit source kinds and unknown equipment cannot be confused',()=>{
 const rows=inventoryAddons([addon('precedence',[
  {title:'Rifle Poster',kind:'FPS Equipment'}, {title:'Helmet Replica',kind:'FPS Equipment'},
  {title:'Pistol Paint',kind:'Skin'}, {title:'Flight Blade',kind:'Component'},
  {title:'Rifle Jacket',kind:'Clothing'}, {title:'Unknown Relic',kind:'Hangar decoration'},
  {title:'Unknown Relic',kind:'Unlisted source kind'}, {title:'Equipment collection',kind:'Equipment'},
 ])]);
 assert.deepEqual(rows.map(r=>r.category),['decorations','collectibles','paints','modules','clothing','decorations','other','other']);
});

test('known CCU titles and currency do not leak into the gear projection',()=>{
 const entry=addon('upgrade',[{title:'Upgrade - Alpha to Beta'},{title:'Starting Money: 5,000 UEC',kind:'Credits'},
  {title:'Upgrade Workshop Poster',kind:'FPS Equipment'}]);
 entry.pledge.name='Upgrade - Alpha to Beta';
 entry.pledge.ccus=[{instanceId:'one',from:'Alpha',to:'Beta',status:'unused',applicability:'unverified',insurance:entry.pledge.insurance}];
 assert.deepEqual(inventoryAddons([entry]).map(r=>r.name),['Upgrade Workshop Poster']);
});
test('game access and insurance with whitespace variants never become add-ons and source titles remain untouched',()=>{
 for(const space of [' ','  ','\n','\u00a0']){
  const imported=parseImport(JSON.stringify({type:'hangarexport',version:2,handle:'SYNTHETIC',pledges:[{pledgeId:'whitespace',pledgeName:'Synthetic package',
   items:[{title:'Synthetic Ship',kind:'Ship'},{title:'Synthetic Paint',kind:'Skin'}],alsoContains:[{title:'Star'+space+'Citizen'+space+'Digital'+space+'Download'},{title:'Lifetime'+space+'Insurance'},{title:'5,000'+space+'UEC'},{title:'Insurance case',kind:'Clothing'}]}]}));
  const pledge=imported.document.pledges[0]!,before=JSON.stringify(pledge);
  assert.deepEqual(inventoryAddons([{pledge,source}]).map(s=>s.name),['Synthetic Paint','Insurance case']);
  assert.equal(JSON.stringify(pledge),before);
 }
});
function addon(id: string, items: {title: string; kind?: string}[]) {
  const pledge = basePledge(id);
  pledge.ships = [];
  pledge.name = 'Synthetic purchase ' + id;
  pledge.sourceValues = {items: JSON.stringify(items), alsoContains: '[]'};
  pledge.rsiPurchase = {status:'documented', source:'order', minor:4125, currency:'EUR'};
  return {pledge, source};
}

test('retained import contents appear as separate rows without changing ship or CCU resources', () => {
  const imported = parseImport(JSON.stringify({type:'hangarexport', version:2, handle:'SYNTHETIC',
    pledges:[{pledgeId:'pack', pledgeName:'Synthetic ship package', items:[
      {title:'MTC',kind:'Vehicle'}, {title:'Icefront Camo Paint',kind:'Skin'},
      {title:'P4-AR',kind:'Weapon'}, {title:'Unrecognized object',kind:'Unlisted type'},
    ], alsoContains:[{title:'Lifetime Insurance'}, {title:'Star Citizen Digital Download'}, {title:'Icefront Camo Paint'}]}]}));
  const pledge = imported.document.pledges[0]!;
  pledge.rsiPurchase = {status:'documented', source:'order', minor:7810, currency:'EUR'};
  const before = JSON.stringify(pledge);
  const rows = inventoryAddons([{pledge,source}]);
  assert.deepEqual(rows.map(row => row.category), ['paints','weapons','other']);
  assert.equal(rows.every(row => row.purchase === null), true);
  assert.equal(pledge.ships.length, 1);
  assert.equal(pledge.ccus.length, 0);
  assert.equal(JSON.stringify(pledge), before);
});

test('a documented singleton gets a personal price while a melt value or log value does not', () => {
  const entry = addon('single', [{title:'Galaxy - Cargo Module',kind:'Module'}]);
  entry.pledge.sourceValues.pledgeValue = '$999.00 USD';
  assert.equal(inventoryAddons([entry], ['Galaxy'])[0]!.purchase?.minor, 4125);
  entry.pledge.rsiPurchase = {status:'documented',source:'log',minor:5500,currency:'USD'};
  assert.equal(inventoryAddons([entry])[0]!.purchase, null);
  delete entry.pledge.rsiPurchase;
  assert.equal(inventoryAddons([entry])[0]!.purchase, null);
  entry.pledge.acquisitionCost = {minor:0,currency:'EUR',taxBasis:'gross',evidence:'Synthetic recorded zero'};
  assert.equal(inventoryAddons([entry])[0]!.purchase?.minor, 0);
});

test('the package total is never repeated on multiple items, duplicate names retain their separate copies', () => {
  const entry = addon('multi', [{title:'Synthetic Paint',kind:'Skin'}, {title:'Synthetic Paint',kind:'Skin'}]);
  entry.pledge.sourceValues.alsoContains = JSON.stringify([{title:'Synthetic Paint'}]);
  const rows = inventoryAddons([entry]);
  assert.equal(rows.length, 2);
  assert.equal(new Set(rows.map(row => row.key)).size, 2);
  assert.ok(rows.every(row => row.purchase === null));
  const second = addon('other-pledge', [{title:'Synthetic Paint',kind:'Skin'}]);
  assert.equal(new Set(inventoryAddons([entry,second]).map(row => row.key)).size, 3);
});

test('missing individual prices retain documented parent purchase information without allocating it',()=>{
 const entry=addon('priced-bundle',[{title:'Synthetic Helmet',kind:'FPS Equipment'},{title:'Synthetic Arms',kind:'FPS Equipment'}]);
 const before=JSON.stringify(entry);
 const rows=inventoryAddons([entry]);
 assert.ok(rows.every(r=>r.purchase===null&&r.sharedPurchase&&r.parentPurchase?.minor===4125));
 assert.equal(JSON.stringify(entry),before);
 entry.pledge.rsiPurchase={status:'documented',source:'log',minor:9900,currency:'USD'};
 assert.ok(inventoryAddons([entry]).every(r=>r.parentPurchase===null&&r.purchase===null&&r.sharedPurchase));
 delete entry.pledge.rsiPurchase;
 entry.pledge.sourceValues.pledgeValue='$99.00 USD';
 assert.ok(inventoryAddons([entry]).every(r=>r.parentPurchase===null&&r.purchase===null&&r.sharedPurchase));
});

test('single documented items remain direct prices while unknown items never become zero-cost gifts',()=>{
 const entry=addon('one',[{title:'Synthetic Helmet',kind:'FPS Equipment'}]);
 const priced=inventoryAddons([entry])[0]!;
 assert.equal(priced.purchase?.minor,4125);assert.equal(priced.sharedPurchase,false);assert.equal(priced.parentPurchase,null);
 entry.pledge.rsiPurchase={status:'excluded'};
 const unknown=inventoryAddons([entry])[0]!;
 assert.equal(unknown.purchase,null);assert.equal(unknown.sharedPurchase,false);assert.equal(unknown.parentPurchase,null);
});

test('ship association uses the named model, never the arbitrary parent ship or a partial model match', () => {
  const entry = addon('related', [{title:'Galaxy - Cargo Module',kind:'Module'},
    {title:'MTC XL - Icefront Paint',kind:'Skin'}, {title:'Icefront Camo Paint',kind:'Skin'}]);
  entry.pledge.ships = [{childId:'ship',modelName:'Unrelated',modelId:null,identity:'unresolved',role:'unverified'}];
  const rows = inventoryAddons([entry], ['Galaxy','MTC','MTC XL']);
  assert.deepEqual(rows.map(row => row.relatedShips), [['Galaxy'],['MTC XL'],[]]);
});

test('saved entries without structured contents remain visible as Other with no invented singleton cost', () => {
  const entry = addon('old', []);
  entry.pledge.sourceValues = {};
  const [row] = inventoryAddons([entry]);
  assert.equal(row!.category, 'other');
  assert.equal(row!.name, entry.pledge.name);
  assert.equal(row!.purchase, null);
});

test('invalid source contents never prove singleton cost and known entitlements are excluded', () => {
  const entry = addon('partial', [{title:'Synthetic Paint',kind:'Skin'}]);
  for (const raw of ['{bad', '[null]', JSON.stringify([{title:'Missing kind'}]).repeat(200)]) {
    entry.pledge.sourceValues.alsoContains = raw;
    assert.equal(inventoryAddons([entry])[0]!.purchase, null);
  }
  const access = addon('access', [{title:'Star Citizen Digital Download',kind:'Game'},
    {title:'Lifetime Insurance',kind:'Insurance'}, {title:'5,000 UEC',kind:'Currency'}]);
  assert.equal(inventoryAddons([access]).length, 0);
  const ccu = addon('ccu', []);
  ccu.pledge.sourceValues.upgradeState = 'unresolved';
  assert.equal(inventoryAddons([ccu]).length, 0);
});

test('category coverage and a 200-package inventory preserve every distinct item', () => {
  const definitions = [
    ['Cargo Module','Ship Module','modules'], ['P4-AR','Weapon','weapons'], ['Helmet','Armor','armor'],
    ['Jacket','Clothing','clothing'], ['Ship Paint','Skin','paints'], ['Poster','Decoration','decorations'],
    ['Miniature','Collectible','collectibles'], ['Mystery','New RSI kind','other'],
  ] as const;
  const entry = addon('types', definitions.map(([title,kind]) => ({title,kind})));
  assert.deepEqual(inventoryAddons([entry]).map(row => row.category), definitions.map(row => row[2]));
  const ambiguous = addon('ambiguous', [{title:'Synthetic equipment',kind:'Equipment'},
    {title:'Subscriber gift',kind:'Subscriber Flair'}]);
  assert.deepEqual(inventoryAddons([ambiguous]).map(row => row.category), ['other','other']);
  const entries = Array.from({length:200}, (_,index) => addon(String(index), [
    {title:'Galaxy - Cargo Module',kind:'Module'}, {title:'Icefront Camo Paint',kind:'Skin'},
  ]));
  const rows = inventoryAddons(entries,['Galaxy']);
  assert.equal(rows.length,400);
  assert.equal(new Set(rows.map(row => row.key)).size,400);
  assert.equal(rows.every(row => row.purchase === null),true);
});
