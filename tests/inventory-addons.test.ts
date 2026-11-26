import test from 'node:test';
import assert from 'node:assert/strict';
import {inventoryAddons} from '../src/domain/inventory-addons';
import {parseImport} from '../src/importers/files';
import {basePledge} from './fixtures';

const source = 'rsi-dom-probe/1';
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
