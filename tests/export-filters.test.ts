import test from 'node:test';
import assert from 'node:assert/strict';
import {createReport,createReports} from '../src/export/document';
import {commandSchema} from '../src/main/commands';
import {reportAccountId,reportFixture} from './fixtures/report-data';

test('generic RSI FPS gear also follows armor, weapon and clothing filters in file exports',async()=>{
 const input=reportFixture(),entry=structuredClone(input.inventory.items[0]!);
 entry.pledge.pledgeId='synthetic-fps-export';entry.pledge.name='Synthetic gear bundle';
 entry.pledge.ships=[];entry.pledge.ccus=[];
 entry.pledge.sourceValues={items:JSON.stringify([
  {title:'Synthetic Helmet',kind:'FPS Equipment'}, {title:'Synthetic Pistol',kind:'FPS Equipment'},
  {title:'Synthetic Jacket',kind:'FPS Equipment'},
 ]),alsoContains:'[]'};
 input.inventory.items=[entry];
 const before=JSON.stringify(input.inventory);
 for(const [category,name] of [['armor','Synthetic Helmet'],['weapons','Synthetic Pistol'],['clothing','Synthetic Jacket']] as const){
  const result=await createReports(input,['addons'],undefined,{addons:[category]});
  assert.deepEqual(result.sections![0]!.rows.map(row=>row.cells[0]),[name]);
 }
 assert.equal(JSON.stringify(input.inventory),before);
});

test('add-on reports preserve individual package contents and only documented singleton costs', async()=>{
 const input=reportFixture(),template=input.inventory.items[0]!;
 const module={...template,pledge:structuredClone(template.pledge)};
 module.pledge.pledgeId='addon-module';
 module.pledge.name='Synthetic Module';
 module.pledge.ships=[];
 module.pledge.sourceValues.items=JSON.stringify([{title:'Galaxy - Cargo Module',kind:'Module'}]);
 module.pledge.rsiPurchase={status:'documented',source:'order',minor:4125,currency:'EUR'};
 module.pledge.acquisitionCost=null;
 const bundle={...template,pledge:structuredClone(template.pledge)};
 bundle.pledge.pledgeId='addon-paint-package';
 bundle.pledge.sourceValues.items=JSON.stringify([{title:'Included Paint',kind:'Skin'}]);
 input.inventory.items.push(module,bundle);
 const doc=createReport({...input,kind:'addons'});
 assert.equal(doc.rows.length,2);
 assert.equal(doc.rows.find(row=>row.cells[0]==='Galaxy - Cargo Module')!.cells[4],41.25);
 assert.equal(doc.rows.find(row=>row.cells[0]==='Included Paint')!.cells[4],null);
 assert.doesNotMatch(JSON.stringify(doc),/SECRET_NOT_FOR_REPORT|session|originalDescription|rsi-local/);
 const selection=await createReports(input,['addons'],undefined,{addons:['paints']});
 assert.deepEqual(selection.sections![0]!.rows.map(row=>row.cells[0]),['Included Paint']);
 assert.equal(commandSchema.safeParse({action:'report.selection',accountId:reportAccountId,
  kinds:['addons'],filters:{addons:['modules','weapons','armor','clothing','paints','decorations','collectibles','other']}}).success,true);
});

test('paint filters distinguish a reported reclaim action, ship bundles and unknown status',async()=>{
 const input=reportFixture(),ship=input.inventory.items[0]!,template=input.inventory.items[1]!;
 ship.pledge.sourceValues.items=JSON.stringify([{title:'Included paint',kind:'Skin'}]);
 ship.pledge.sourceValues.meltable='true';
 function paint(id:string,source:string,meltable?:string){
  return {...template,source,pledge:{...template.pledge,pledgeId:id,name:id,ships:[],ccus:[],
   sourceValues:{items:JSON.stringify([{title:id+' paint',kind:'Skin'}]),...(meltable?{meltable}:{})}}};
 }
 input.inventory.items.push(paint('Reclaimable','rsi-dom-probe/1','true'),paint('Unknown','file-import','true'),paint('Blocked','rsi-dom-probe/1','false'));
 const {sections}=await createReports(input,['paints','offers'],undefined,{paints:['meltable','ship-package'],offers:['warbond']});
 const [paints,offers]=sections!;
 assert.deepEqual(paints!.rows.map(row=>row.cells[0]),[ship.pledge.name,'Reclaimable']);
 assert.match(paints!.notes[0]!,/Einschmelzbar laut RSI oder Im Schiffspaket/);
 assert.deepEqual(offers!.rows.map(row=>row.cells[0]),['Galaxy']);
 const unknown=createReport({...input,kind:'paints',filters:['unknown']});
 assert.deepEqual(unknown.rows.map(row=>row.cells[0]),['Unknown']);
});

test('stock filters keep only matching CCUs within a pledge and classify ships and game packages independently',()=>{
 const input=reportFixture(),ccu=input.inventory.items[1]!.pledge,ship=input.inventory.items[0]!.pledge;
 ccu.ccus.push({...ccu.ccus[0]!,instanceId:'applied',from:'B',to:'Galaxy',status:'applied'});
 ship.sourceValues.items=JSON.stringify([{title:'Star Citizen Digital Download'},{title:'Squadron 42 Digital Download'}]);
 ship.sourceValues.gameAccessAssignment='["sc"]';
 const used=createReport({...input,kind:'ccus',filters:['applied']});
 assert.equal(used.rows[0]!.cells[3],'B → Galaxy');
 assert.equal(createReport({...input,kind:'ships',filters:['lti']}).rows.length,2);
 assert.equal(createReport({...input,kind:'packages',filters:['both']}).rows[0]!.cells[0],ship.name);
 assert.equal(createReport({...input,kind:'access',filters:['sc']}).rows[0]!.cells[0],ship.name);
});

test('Buy Back uses known insurance and a filtered chain avoids full-chain totals',()=>{
 const input=reportFixture();
 input.inventory.buybacks=[{entryId:'a',description:'',name:'Known LTI',availability:'unverified',currentPrice:null,insurance:{kind:'lti',evidence:'test'}},
  {entryId:'b',description:'',name:'Unknown',availability:'unverified',currentPrice:null}];
 assert.deepEqual(createReport({...input,kind:'buyback',filters:['unknown']}).rows.map(row=>row.cells[0]),['Unknown']);
 const chain=createReport({...input,kind:'chain',filters:['purchase']});
 assert.deepEqual(chain.rows.map(row=>row.cells.slice(1,3)),[['Starter','A'],['B','Galaxy']]);
 assert.deepEqual(chain.totals,[]);
 assert.match(chain.notes.join(' '),/Startbasis · Starter/);
});

test('export IPC rejects filters for other areas, duplicates and arbitrary keys',()=>{
 const command={action:'report.selection',accountId:reportAccountId,kinds:['paints']};
 assert.ok(commandSchema.safeParse({...command,filters:{paints:['meltable','ship-package']}}).success);
 for(const filters of [{paints:['unused']},{paints:['meltable','meltable']},{ccus:['unused']},{price:['lti']},{paints:[]}]){
  assert.equal(commandSchema.safeParse({...command,filters}).success,false);
 }
});
