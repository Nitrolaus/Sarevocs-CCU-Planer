import test from 'node:test';
import assert from 'node:assert/strict';
import {fleetDraftOptions,emptyPrice,emptyDate,emptyShipDraft} from '../src/ui/fleetyards-options';
const flags={includeLti:false,includeWarbond:false,includePackageNames:false};

test('empty or malformed replacement prices cannot silently become a zero disclosure',()=>{
 for(const amount of ['',' ','1,234','12.345','-1','1e2','1,000.00','1000000.01']){
  assert.deepEqual(fleetDraftOptions({...emptyPrice('custom'),amount},emptyDate('hidden'),new Map(),flags),{ok:false,field:'price'});
 }
 for(const [amount,minor]of [['12,34',1234],['12.34',1234],['0',0],['0,1',10],['1000000',100000000]] as const){
  const result=fleetDraftOptions({...emptyPrice('custom'),amount,currency:'GBP'},emptyDate('hidden'),new Map(),flags);
  assert.ok(result.ok);assert.deepEqual(result.options.price,{mode:'custom',value:{minor,currency:'GBP'}});
 }
});

test('invalid individual dates block saving and identify the exact copy; inherited fields remain inherited',()=>{
 const ship={...emptyShipDraft(),date:{mode:'custom' as const,value:'2026-02-30'}};
 assert.deepEqual(fleetDraftOptions(emptyPrice('hidden'),emptyDate('hidden'),new Map([['copy-2',ship]]),flags),{ok:false,field:'date',key:'copy-2'});
 const result=fleetDraftOptions(emptyPrice('known'),emptyDate('hidden'),new Map([['copy-1',emptyShipDraft()],['copy-2',{...ship,date:emptyDate('hidden')}]]),flags);
 assert.ok(result.ok);assert.deepEqual(result.options.overrides,[{key:'copy-2',price:undefined,date:{mode:'hidden'}}]);
 assert.deepEqual(result.options.price,{mode:'known'});
});
