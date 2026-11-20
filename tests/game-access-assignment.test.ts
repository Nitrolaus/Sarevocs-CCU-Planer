import {test} from 'node:test';import assert from 'node:assert/strict';
import {gameAccessAssignment,hasProtectedGameAccess} from '../src/domain/game-access-assignment';import {gameContentKind} from '../src/domain/game-content';
import {basePledge} from './fixtures';import {parseImport} from '../src/importers/files';import fs from 'node:fs';
test('A ship game package can simultaneously provide an assigned protected access',()=>{
 const p=basePledge();p.sourceValues.items=JSON.stringify([{title:'Star Citizen Digital Download'},{title:'Squadron 42 Digital Download'}]);p.sourceValues.gameAccessAssignment='["sq42"]';
 assert.equal(gameContentKind(p),'package');assert.deepEqual(gameAccessAssignment(p,'rsi-dom-probe/1'),{state:'observed',games:['sq42']});assert.equal(hasProtectedGameAccess(p,'rsi-dom-probe/1'),true);
 p.sourceValues.gameAccessAssignment='[]';assert.equal(gameContentKind(p),'package');assert.equal(hasProtectedGameAccess(p,'rsi-dom-probe/1'),false);
});
test('No ship, an included download or local protection never implies RSI assignment; old caches remain unknown',()=>{
 const p=basePledge();p.ships=[];p.name='SC Game Access';p.sourceValues.items=JSON.stringify([{title:'Star Citizen Digital Download'}]);
 assert.equal(gameContentKind(p),'copy');assert.deepEqual(gameAccessAssignment(p,'rsi-dom-probe/1'),{state:'unknown',games:[]});assert.equal(hasProtectedGameAccess(p,'rsi-dom-probe/1'),false);
 p.sourceValues.gameAccessAssignment='["sc"]';assert.deepEqual(gameAccessAssignment(p,'hangarlink-v2/1'),{state:'declared',games:['sc']});assert.equal(hasProtectedGameAccess(p,'sarevocs-json/1'),false);
});
test('Corrupt, excessive, duplicate and arbitrary assignment fields do not become live RSI proof',()=>{
 const p=basePledge();for(const value of ['{','null','true','"sc"','["SC"]','["sc","sc"]','["sc","sq42","sc"]','{"sc":true}','["sc"]'+' '.repeat(101)]){p.sourceValues.gameAccessAssignment=value;assert.deepEqual(gameAccessAssignment(p,'rsi-dom-probe/1'),{state:'unknown',games:[]});}
});
test('The file adapter preserves explicit assignment metadata without upgrading file declarations into RSI proof',()=>{
 const raw=JSON.parse(fs.readFileSync('tests/fixtures/hangarlink-v2-synthetic.json','utf8'));raw.pledges[0].gameAccessAssignment=['sc'];
 const candidate=parseImport(JSON.stringify(raw)),p=candidate.document.pledges[0]!;assert.equal(p.sourceValues.gameAccessAssignment,'["sc"]');assert.equal(gameAccessAssignment(p,candidate.adapter).state,'declared');
 raw.pledges[0].gameAccessAssignment=['sc','sc'];assert.throws(()=>parseImport(JSON.stringify(raw)));
});
