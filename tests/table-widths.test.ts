import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {commandSchema} from '../src/main/commands';
import {TableWidthStore} from '../src/main/table-widths';

test('table widths persist independently of the UI session and ignore unsupported IPC shapes',()=>{
 const temporary=path.resolve('work/temp');fs.mkdirSync(temporary,{recursive:true});
 const directory=fs.mkdtempSync(path.join(temporary,'table-widths-test-'));
 const file=path.join(directory,'table-widths-v1.json');
 try{
  const before=new TableWidthStore(directory),inventory=[310,180,100,170,130,160,135],paints=[170,100,90,120,110,110];
  assert.equal(before.get('inventory'),null);
  assert.deepEqual(before.get('inventory',inventory),inventory);
  assert.deepEqual(before.get('paints',paints),paints);
  const after=new TableWidthStore(directory);
  assert.deepEqual(after.get('inventory'),inventory);
  assert.deepEqual(after.get('paints'),paints);
  assert.equal(after.get('loaners'),null);
  assert.equal(commandSchema.safeParse({action:'table.widths',table:'inventory',widths:[20,80]}).success,false);
  assert.equal(commandSchema.safeParse({action:'table.widths',table:'../profile',widths:inventory}).success,false);
  assert.equal(commandSchema.safeParse({action:'table.widths',table:'inventory',widths:inventory}).success,true);
 }finally{
  if(fs.existsSync(file))fs.unlinkSync(file);
  fs.rmdirSync(directory);
 }
});
