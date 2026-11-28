import test from 'node:test';
import assert from 'node:assert/strict';
import {reportFixture} from './fixtures/report-data';
import {fleetShips,fleetFile,fleetJson,fleetSelectionSchema,fleetOptionsSchema} from '../src/export/fleetyards';
import {FleetYardsService} from '../src/export/fleetyards-service';
import {commandSchema} from '../src/main/commands';
import type {LastSeen} from '../src/storage/last-seen';
import {readFileSync} from 'node:fs';
import type {FleetOptions,FleetShip} from '../src/export/fleetyards';
import type {UpgradeHistoryResult} from '../src/domain/upgrade-history';
const options={customShipNames:false,paints:false};
function scenario(){const input=reportFixture();return{input,rows:fleetShips(input.inventory,null,input.market.catalogue!.ships)}}

test('each physical ship stays separate; exact eight-key reference format hides sensitive values by default',()=>{
 const {rows}=scenario(),file=fleetFile(rows.ships,rows.ships.map(s=>s.key),options);
 assert.deepEqual(file.map(s=>s.name).sort(),['A','B','Starter']);
 const sample=JSON.parse(readFileSync(new URL('./fixtures/fleetyards-hangar-xplor-example.json',import.meta.url),'utf8'));
 assert.ok(file.every(s=>Object.keys(s).join(',')===Object.keys(sample[0]).join(',')&&Object.keys(s).every(key=>typeof s[key as keyof typeof s]===typeof sample[0][key])));
 assert.ok(file.every(s=>s.cost===''&&s.pledge_date===''&&!s.lti&&!s.warbond));
 assert.deepEqual(file.map(s=>s.package_id),['00000001','00000002','00000003']);
 assert.doesNotMatch(fleetJson(file),/SECRET|SYNTHETIC|HYPERLINK|rsi-local|November|4000|10000/);
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
test('unsupported fields cannot be added to the exact format, even if the source contains them',()=>{
 const {rows}=scenario(),s={...rows.ships[0]!,customShipName:'Synthetic custom name',paintSlugs:['synthetic-paint']};
 assert.ok(!('shipName'in fleetFile([s],[s.key],options)[0]!));
 assert.throws(()=>fleetFile([s],[s.key],{customShipNames:true,paints:true}));
 assert.doesNotMatch(fleetJson(fleetFile([s],[s.key],options)),/Synthetic custom|synthetic-paint/);
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

test('the official three-row example can be reproduced exactly, including types, dates, currency and key order',()=>{
 const sample=JSON.parse(readFileSync(new URL('./fixtures/fleetyards-hangar-xplor-example.json',import.meta.url),'utf8'));
 const ships:FleetShip[]=sample.map((row:Record<string,unknown>,i:number)=>({key:'test-'+i,name:row.name,catalogueName:row.name,
  manufacturer:row.manufacturer,customShipName:null,paintSlugs:[],lti:row.lti,warbond:row.warbond,packageName:row.pledge,
  knownPrice:{minor:[7000,11000,14000][i],currency:'USD'},knownDate:'2020-01-01'}));
 const file=fleetFile(ships,ships.map(s=>s.key),{price:{mode:'known'},date:{mode:'known'},includeLti:true,includeWarbond:true,includePackageNames:true});
 assert.deepEqual(file,sample);assert.equal(JSON.stringify(file),JSON.stringify(sample));
});

test('custom global and per-ship disclosures change the file only; missing values stay empty instead of zero',()=>{
 const {rows}=scenario(),ships=rows.ships.map((s,i)=>({...s,knownPrice:i?null:{minor:15480,currency:'EUR' as const},knownDate:i?null:'2026-01-15',packageName:'PRIVATE ORIGINAL PACK'}));
 const before=structuredClone(ships),keys=ships.map(s=>s.key);
 const known=fleetFile(ships,keys,{price:{mode:'known'},date:{mode:'known'}});
 assert.equal(known[0]!.cost,'€154.80 EUR');assert.equal(known[0]!.pledge_date,'January 15, 2026');
 assert.ok(known.slice(1).every(s=>s.cost===''&&s.pledge_date===''));
 assert.ok(known.every(s=>!s.pledge.includes('PRIVATE')));
 const custom:FleetOptions={price:{mode:'custom',value:{minor:1000,currency:'USD'}},date:{mode:'custom',value:'2020-01-01'},overrides:[
  {key:keys[0]!,price:{mode:'hidden'},date:{mode:'known'}},{key:keys[1]!,price:{mode:'custom',value:{minor:0,currency:'GBP'}},date:{mode:'hidden'}}]};
 const file=fleetFile(ships,keys,custom);
 assert.equal(file[0]!.cost,'');assert.equal(file[0]!.pledge_date,'January 15, 2026');
 assert.equal(file[1]!.cost,'£0.00 GBP');assert.equal(file[1]!.pledge_date,'');
 assert.equal(file[2]!.cost,'$10.00 USD');assert.equal(file[2]!.pledge_date,'January 1, 2020');
 assert.deepEqual(ships,before);
 assert.equal(fleetFile(ships,[keys[0]!],custom).length,1);
});

test('invalid calendar dates, money, duplicate overrides and foreign ship settings are rejected',()=>{
 const {rows}=scenario(),keys=rows.ships.map(s=>s.key),base={mode:'custom' as const};
 for(const value of ['2020-02-30','2021-02-29','2020-1-1','1899-12-31','2101-01-01'])assert.equal(fleetOptionsSchema.safeParse({date:{...base,value}}).success,false,value);
 for(const minor of [-1,0.1,NaN,Infinity,100_000_001])assert.equal(fleetOptionsSchema.safeParse({price:{...base,value:{minor,currency:'USD'}}}).success,false);
 assert.equal(fleetOptionsSchema.safeParse({price:{...base,value:{minor:10,currency:'USD',order:'PRIVATE'}}}).success,false);
 assert.equal(fleetOptionsSchema.safeParse({overrides:[{key:keys[0]},{key:keys[0]}]}).success,false);
 assert.throws(()=>fleetFile(rows.ships,keys,{overrides:[{key:'FOREIGN',price:{mode:'known'}}]}));
 assert.equal(fleetOptionsSchema.safeParse({customShipNames:true}).success,false);
 assert.equal(fleetOptionsSchema.safeParse({paints:true}).success,false);
 assert.equal(fleetOptionsSchema.safeParse({date:{mode:'hidden',value:'2020-01-01'}}).success,false);
});

function upgraded(){
 const {input}=scenario(),p=structuredClone(input.inventory.items[0]!.pledge),account=input.inventory.account;
 p.name='Standalone Ships - MDC';p.acquisitionCost=null;p.ships[0]!.modelName='Sabre Firebird';
 p.rsiPurchase={status:'documented',source:'order',minor:3870,currency:'EUR',purchaseDate:'2025-11-26'};
 const history:UpgradeHistoryResult={status:'loaded',partial:false,steps:[{from:'MDC',to:'Sabre Firebird Imperator Subscribers Edition',ccuPledgeId:'102',appliedAt:'2026-02-03 12:00'}],
  purchases:[{ccuPledgeId:'102',price:{status:'documented',source:'order',minor:11610,currency:'EUR'}}]};
 const observed:LastSeen={schemaVersion:1,accountId:account.id,revision:'22222222-2222-4222-8222-222222222222',observedAt:new Date(Date.now()+1000).toISOString(),
  document:{type:'sarevocs-ccu-inventory',schemaVersion:1,appVersion:'TEST',createdAt:input.now!,dataMode:'real',account:{reference:'rsi-local:'+account.id,identityKind:'manual-reference'},
   scope:{kind:'partial',exportComplete:false,expectedPledges:null,pagesExpected:null,pagesRead:1},pledges:[p],buybacks:[]},appliedPurchaseHistories:{[p.pledgeId]:history}};
 const catalogue=[{...input.market.catalogue!.ships[0]!,name:'MDC'},{...input.market.catalogue!.ships[1]!,name:'Sabre Firebird'}];
 return{input,p,history,observed,catalogue,rows:()=>fleetShips(input.inventory,observed,catalogue).ships};
}

test('upgraded Firebird exports the documented native-currency total only after opt-in, never the token alone',()=>{
 const f=upgraded(),before=structuredClone(f.observed),rows=f.rows();
 assert.deepEqual(rows[0]!.knownPrice,{minor:15480,currency:'EUR'});assert.equal(rows[0]!.dateKind,'purchase');
 assert.equal(fleetFile(rows,rows.map(s=>s.key),{})[0]!.cost,'');
 assert.equal(fleetFile(rows,rows.map(s=>s.key),{price:{mode:'known'}})[0]!.cost,'€154.80 EUR');
 assert.deepEqual(f.observed,before);
 f.p.rsiPurchase={status:'documented',source:'order',minor:3000,currency:'GBP'};
 f.history.purchases![0]!.price={status:'documented',source:'order',minor:9000,currency:'GBP'};
 assert.deepEqual(f.rows()[0]!.knownPrice,{minor:12000,currency:'GBP'});
 assert.equal(f.rows()[0]!.dateKind,'hangar');
});

test('incomplete, disconnected, duplicated, mixed-currency or stale upgrades never expose a misleading base price',()=>{
 const mutations:((f:ReturnType<typeof upgraded>)=>void)[]=[
  f=>{f.observed.appliedPurchaseHistories=undefined},f=>{f.history.partial=true},f=>{f.history.steps[0]!.from='Other'},
  f=>{f.history.steps[0]!.to='Other'},f=>{f.history.purchases=[]},
  f=>{f.history.purchases![0]!.price={status:'documented',source:'order',minor:1000,currency:'GBP'}},
  f=>{f.history.steps[0]!.ccuPledgeId=f.p.pledgeId;f.history.purchases![0]!.ccuPledgeId=f.p.pledgeId},
  f=>{f.history.steps.push({...f.history.steps[0]!});f.history.purchases!.push({...f.history.purchases![0]!})},
 ];
 for(const change of mutations){const f=upgraded();change(f);assert.equal(f.rows()[0]!.knownPrice,null);}
 const f=upgraded();f.input.inventory.items=[{pledge:f.p,source:'rsi-dom-probe/1',availability:'present',importedAt:new Date(Date.now()+5000).toISOString()}];
 assert.equal(f.rows()[0]!.knownPrice,null,'older observed history must not attach to a newer accepted snapshot');
});

test('multi-ship package totals are not repeated; only a matching allocated share can be disclosed',()=>{
 const {input}=scenario(),pack=input.inventory.items[2]!.pledge;
 pack.rsiPurchase={status:'documented',source:'order',minor:10000,currency:'EUR'};
 const unallocated=fleetShips(input.inventory,null,input.market.catalogue!.ships).ships.filter(s=>s.name==='A'||s.name==='B');
 assert.ok(unallocated.every(s=>s.knownPrice===null));
 const share={pledgeId:pack.pledgeId,childId:'s1',modelName:'B',totalMinor:10000,currency:'EUR' as const,minor:4000};
 const allocated=fleetShips(input.inventory,null,input.market.catalogue!.ships,[share]).ships;
 assert.deepEqual(allocated.find(s=>s.name==='B')!.knownPrice,{minor:4000,currency:'EUR'});assert.equal(allocated.find(s=>s.name==='A')!.knownPrice,null);
 assert.equal(fleetShips(input.inventory,null,input.market.catalogue!.ships,[{...share,totalMinor:9999}]).ships.find(s=>s.name==='B')!.knownPrice,null);
});

test('a hangar log value or USD melt value does not become the documented personal price',()=>{
 const {input}=scenario(),p=input.inventory.items[0]!.pledge;p.name='Standalone Ship - Starter';p.acquisitionCost=null;
 p.rsiPurchase={status:'documented',source:'log',minor:4000,currency:'USD'};
 assert.equal(fleetShips(input.inventory,null,input.market.catalogue!.ships).ships.find(s=>s.name==='Starter')!.knownPrice,null);
 p.rsiPurchase=undefined;p.sourceValues.pledgeValue='$40.00 USD';
 assert.equal(fleetShips(input.inventory,null,input.market.catalogue!.ships).ships.find(s=>s.name==='Starter')!.knownPrice,null);
});
