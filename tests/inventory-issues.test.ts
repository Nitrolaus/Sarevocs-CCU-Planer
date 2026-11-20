import test from 'node:test';import assert from 'node:assert/strict';
import {inventoryReadIssues,hasInventoryReadIssue} from '../src/domain/inventory-issues';import {basePledge,demoDocument,foreignDocument} from './fixtures';import {parseImport} from '../src/importers/files';

test('recognized CCUs stay out of Unresolved despite unknown insurance and unverified applicability',()=>{
 for(const p of demoDocument().pledges){const before=JSON.stringify(p);assert.deepEqual(inventoryReadIssues(p),[]);assert.equal(JSON.stringify(p),before);}
 const p=demoDocument().pledges.find(p=>p.ccus.length)!;p.ccus[0]!.applicability='rejected';assert.equal(hasInventoryReadIssue(p),false); // applicability is a separate constraint, not a failed read
});
test('ordinary ships, packages and other pledges need no insurance or account applicability proof to be recognized',()=>{const p=basePledge();p.insurance={kind:'unknown',reason:'Not read'};assert.equal(p.ships[0]!.identity,'unresolved');assert.equal(hasInventoryReadIssue(p),false);p.ships=[];assert.equal(hasInventoryReadIssue(p),false);});
test('real ambiguous or unreadable upgrade reports remain visible even when endpoints exist',()=>{
 const p=demoDocument().pledges.find(p=>p.ccus.length)!;
 for(const value of ['ambiguous','unreadable']){p.sourceValues.upgradeIssue=value;assert.ok(inventoryReadIssues(p).includes('reported-upgrade-problem'));}
 delete p.sourceValues.upgradeIssue;p.sourceValues.upgradeState='unresolved';assert.equal(hasInventoryReadIssue(p),true);
});
test('missing/equal endpoints, inconsistent structured source and corrupt source JSON are genuine mapping errors',()=>{
 for(const names of [['','Beta'],['Alpha',' '],['Alpha',' ALPHA ']]){const p=demoDocument().pledges.find(p=>p.ccus.length)!;[p.ccus[0]!.from,p.ccus[0]!.to]=names as [string,string];assert.ok(inventoryReadIssues(p).includes('ccu-endpoints'));}
 const p=demoDocument().pledges.find(p=>p.ccus.length)!;
 p.sourceValues.upgrade=JSON.stringify({from:p.ccus[0]!.from,to:p.ccus[0]!.to});assert.equal(hasInventoryReadIssue(p),false);
 for(const raw of ['{broken',JSON.stringify({from:'Wrong variant',to:p.ccus[0]!.to}),JSON.stringify({from:null,to:null})]){p.sourceValues.upgrade=raw;assert.ok(inventoryReadIssues(p).includes('ccu-source-conflict'));}
});
test('duplicate physical IDs and missing ship model are reported while distinct copies remain valid',()=>{const p=demoDocument().pledges.find(p=>p.ccus.length)!;p.ccus.push({...p.ccus[0]!,instanceId:'second-copy'});assert.equal(hasInventoryReadIssue(p),false);p.ccus[1]!.instanceId=p.ccus[0]!.instanceId;assert.ok(inventoryReadIssues(p).includes('duplicate-ccu'));const ship=basePledge();ship.ships.push({...ship.ships[0]!});assert.ok(inventoryReadIssues(ship).includes('duplicate-ship'));ship.ships[0]!.modelName=' ';assert.ok(inventoryReadIssues(ship).includes('ship-model'));});
test('real adapter defaults do not populate Unresolved; explicit reader failure still does',()=>{const document=foreignDocument();const parsed=parseImport(JSON.stringify(document));assert.ok(parsed.document.pledges.every(p=>!hasInventoryReadIssue(p)));const failed={...document,pledges:[{pledgeId:'failed',pledgeName:'Upgrade unreadable',items:[],alsoContains:[],upgradeIssue:'unreadable'}]};assert.equal(hasInventoryReadIssue(parseImport(JSON.stringify(failed)).document.pledges[0]!),true);});
