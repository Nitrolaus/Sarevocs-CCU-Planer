import test from 'node:test';
import assert from 'node:assert/strict';
import {reportFixture} from './fixtures/report-data';
import {fleetShips,fleetFile,fleetJson,fleetSelectionSchema,fleetOptionsSchema} from '../src/export/fleetyards';
import {FleetYardsService} from '../src/export/fleetyards-service';
import {commandSchema} from '../src/main/commands';
import type {LastSeen} from '../src/storage/last-seen';
const options={customShipNames:false,paints:false};
function scenario(){const input=reportFixture();return{input,rows:fleetShips(input.inventory,null,input.market.catalogue!.ships)}}

test('each physical ship in a package stays separate, without account or price fields in the JSON',()=>{
 const {rows}=scenario(),file=fleetFile(rows.ships,rows.ships.map(s=>s.key),options);
 assert.deepEqual(file.map(s=>s.name).sort(),['A','B','Starter']);
 assert.ok(file.every(s=>Object.keys(s).join(',')==='name,public,nameVisible'&&!s.public&&!s.nameVisible));
 assert.doesNotMatch(fleetJson(file),/SECRET|pledge|token|key|reference|amount|price|account|profile|currency|serial/i);
});
test('removed inventory, loaners and included craft are not exported as owned ships',()=>{
 const {input}=scenario();input.inventory.items[2]!.availability='removed';
 input.inventory.items[0]!.pledge.ships.push({...input.inventory.items[0]!.pledge.ships[0]!,childId:'loaner',role:'loaner'},
  {...input.inventory.items[0]!.pledge.ships[0]!,childId:'included',role:'included'});
 const rows=fleetShips(input.inventory,null,input.market.catalogue!.ships);assert.equal(rows.ships.length,1);
});
test('duplicate model copies can be selected independently and survive serialization',()=>{
 const {input}=scenario(),p=input.inventory.items[0]!.pledge;p.ships.push({...p.ships[0]!,childId:'second'});
 const rows=fleetShips(input.inventory,null,input.market.catalogue!.ships).ships.filter(s=>s.name==='Starter');
 assert.equal(rows.length,2);assert.notEqual(rows[0]!.key,rows[1]!.key);
 assert.equal(fleetFile(rows,[rows[1]!.key],options).length,1);
 assert.equal(fleetFile(rows,rows.map(s=>s.key),options).length,2);
});
test('unknown names, ambiguous catalogue names and unresolved upgrades cannot be selected',()=>{
 const {input}=scenario();input.inventory.items[0]!.pledge.sourceValues.upgradeState='unresolved';
 const catalogue=[...input.market.catalogue!.ships,{...input.market.catalogue!.ships[1]!,id:99}];
 const rows=fleetShips(input.inventory,null,catalogue).ships;
 assert.equal(rows.filter(s=>!s.catalogueName).length,2);
 assert.throws(()=>fleetFile(rows,[rows.find(s=>!s.catalogueName)!.key],options));
});
test('duplicate physical IDs remain visible but cannot be silently counted as two owned ships',()=>{
 const {input}=scenario(),p=input.inventory.items[0]!.pledge;p.ships.push({...p.ships[0]!});
 const rows=fleetShips(input.inventory,null,input.market.catalogue!.ships).ships.filter(s=>s.name==='Starter');
 assert.equal(rows.length,2);assert.ok(rows.every(s=>s.catalogueName===null));assert.notEqual(rows[0]!.key,rows[1]!.key);
});
test('known RSI aliases are canonicalized using their exact catalogue identity',()=>{
 const {input}=scenario();input.inventory.items[0]!.pledge.ships[0]!.modelName='350r Racer';
 const catalogue=[{...input.market.catalogue!.ships[0]!,id:10,name:'350r'}];
 const row=fleetShips(input.inventory,null,catalogue).ships.find(s=>s.name==='350r Racer')!;
 assert.equal(fleetFile([row],[row.key],options)[0]!.name,'350r');
});
test('optional names and paints are omitted until selected, and absent evidence is not invented',()=>{
 const {rows}=scenario(),s={...rows.ships[0]!,customShipName:'Synthetic custom name',paintSlugs:['synthetic-paint']};
 assert.ok(!('shipName'in fleetFile([s],[s.key],options)[0]!));
 assert.deepEqual(fleetFile([s],[s.key],{customShipNames:true,paints:true})[0],{name:s.catalogueName,public:false,nameVisible:false,shipName:s.customShipName,paintSlugs:s.paintSlugs});
 assert.ok(rows.ships.every(s=>s.customShipName===null&&!s.paintSlugs.length));
});
test('a frozen receipt cannot leak another profile, be modified through its preview, or survive expiry',()=>{
 const {input}=scenario();let now=1000;const service=new FleetYardsService(()=>now);
 const preview=service.preview(input.inventory,null,input.market.catalogue!.ships),key=preview.ships[0]!.key;
 preview.ships[0]!.catalogueName='ATTACKER_MUTATION';
 assert.doesNotMatch(service.file(input.inventory.account.id,preview.token,[key],options),/ATTACKER/);
 assert.throws(()=>service.file('22222222-2222-4222-8222-222222222222',preview.token,[key],options));
 now+=16*60_000;assert.throws(()=>service.file(input.inventory.account.id,preview.token,[key],options));
});
test('large inventories preserve all 240 copies and exact selections instead of truncating at the page size',()=>{
 const {input}=scenario(),template=input.inventory.items[0]!;
 input.inventory.items=Array.from({length:240},(_,i)=>({...template,pledge:{...template.pledge,pledgeId:String(i+1000)}}));
 const rows=fleetShips(input.inventory,null,input.market.catalogue!.ships).ships;
 assert.equal(rows.length,240);assert.equal(new Set(rows.map(s=>s.key)).size,240);
 assert.equal(fleetFile(rows,rows.slice(25,200).map(s=>s.key),options).length,175);
});
test('a newer observed view is used and a foreign cached profile is rejected',()=>{
 const {input}=scenario(),account=input.inventory.account;
 const observed:LastSeen={schemaVersion:1,accountId:account.id,revision:'22222222-2222-4222-8222-222222222222',observedAt:new Date(Date.now()+1000).toISOString(),document:{type:'sarevocs-ccu-inventory',schemaVersion:1,appVersion:'TEST',createdAt:input.now!,dataMode:'real',account:{reference:'rsi-local:'+account.id,identityKind:'manual-reference'},scope:{kind:'partial',exportComplete:false,expectedPledges:null,pagesExpected:null,pagesRead:1},pledges:[input.inventory.items[0]!.pledge],buybacks:[]}};
 assert.equal(fleetShips(input.inventory,observed,input.market.catalogue!.ships).ships.length,1);
 assert.throws(()=>fleetShips(input.inventory,{...observed,accountId:'22222222-2222-4222-8222-222222222222'},input.market.catalogue!.ships));
});
test('empty, duplicate or unknown keys and extra request properties are rejected',()=>{
 const {input,rows}=scenario(),key=rows.ships[0]!.key;
 assert.equal(fleetSelectionSchema.safeParse([]).success,false);assert.equal(fleetSelectionSchema.safeParse([key,key]).success,false);
 assert.throws(()=>fleetFile(rows.ships,['unknown'],options));assert.equal(fleetOptionsSchema.safeParse({...options,serials:true}).success,false);
 const request={action:'fleetyards.save',accountId:input.inventory.account.id,token:'22222222-2222-4222-8222-222222222222',selected:[key],options};
 assert.ok(commandSchema.safeParse(request).success);assert.equal(commandSchema.safeParse({...request,ships:[{name:'unverified'}]}).success,false);
});
