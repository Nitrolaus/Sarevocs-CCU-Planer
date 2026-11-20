import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {PlannerDraftStore} from '../src/planner/draft-store';import {emptyDraft,draftSchema,type PlannerDraft} from '../src/planner/draft';import {commandSchema} from '../src/main/commands';
const root=path.resolve('work/temp/planner-draft-tests');fs.mkdirSync(root,{recursive:true});
const value=():PlannerDraft=>({...emptyDraft(),mode:'manual',initialized:true,baseKey:JSON.stringify(['base','ship']),anchors:[{kind:'owned',key:JSON.stringify(['pledge','ccu']),fromName:'A',toName:'B'},{kind:'purchase',fromKey:'matrix:2',toKey:'matrix:3',fromName:'B',toName:'Target'}]});

test('advisor batch updates every target atomically and rejects stale previews before changing any entry',()=>{
 const dir=fs.mkdtempSync(path.join(root,'batch-')),a=randomUUID(),s=new PlannerDraftStore(dir),old=value();s.save(a,1,old);s.save(a,2,old);
 const rows=[1,2].map(targetId=>({targetId,expected:old,draft:emptyDraft()})),file=path.join(dir,'plan-'+a+'.json'),before=fs.readFileSync(file),rename=fs.renameSync;
 try{fs.renameSync=()=>{throw Error('SYNTHETIC_RENAME_FAILURE');};assert.throws(()=>s.saveBatch(a,rows));}finally{fs.renameSync=rename;}
 assert.deepEqual(fs.readFileSync(file),before);assert.equal(fs.readdirSync(dir).some(f=>f.endsWith('.tmp')),false);
 s.saveBatch(a,rows);assert.deepEqual(new PlannerDraftStore(dir).load(a,1),emptyDraft());assert.deepEqual(s.load(a,2),emptyDraft());
 const committed=fs.readFileSync(file);assert.throws(()=>s.saveBatch(a,rows));assert.deepEqual(fs.readFileSync(file),committed);
 assert.equal(commandSchema.safeParse({action:'planner.batch',accountId:a,entries:rows}).success,true);assert.throws(()=>s.saveBatch(a,[rows[0],rows[0]]));
 assert.throws(()=>s.saveBatch(a,[...rows,...rows]));assert.equal(commandSchema.safeParse({action:'planner.batch',accountId:a,entries:rows,url:'https://invalid'}).success,false);
});
test('drafts persist exact order and mode across store restart, correction, target and profile switches',()=>{
 const dir=fs.mkdtempSync(path.join(root,'case-')),a=randomUUID(),b=randomUUID(),s=new PlannerDraftStore(dir),d=value();
 s.save(a,4,d);assert.deepEqual(new PlannerDraftStore(dir).load(a,4),d);assert.equal(s.load(b,4),null);assert.equal(s.load(a,5),null);
 const corrected={...d,anchors:[...d.anchors].reverse()};s.save(a,4,corrected);assert.deepEqual(s.load(a,4),corrected);s.save(a,5,emptyDraft());assert.deepEqual(s.load(a,4),corrected);
 s.save(a,4,{...corrected,mode:'auto'});assert.equal(s.load(a,4)!.mode,'auto');assert.deepEqual(s.load(a,4)!.anchors,corrected.anchors);
});
test('corrupt, foreign and newer files are preserved; failed atomic write keeps the previous plan',()=>{
 const dir=fs.mkdtempSync(path.join(root,'case-')),a=randomUUID(),b=randomUUID(),s=new PlannerDraftStore(dir),file=path.join(dir,'plan-'+a+'.json');
 for(const raw of ['{broken',JSON.stringify({schemaVersion:9,accountId:a,targets:[]}),JSON.stringify({schemaVersion:1,accountId:b,targets:[]})]){
  fs.writeFileSync(file,raw);assert.throws(()=>s.load(a,1));assert.throws(()=>s.save(a,1,value()));assert.equal(fs.readFileSync(file,'utf8'),raw);
 }
 fs.unlinkSync(file);s.save(a,1,value());const before=fs.readFileSync(file),rename=fs.renameSync;
 try{fs.renameSync=()=>{throw Error('SYNTHETIC_WRITE_FAILURE');};assert.throws(()=>s.save(a,1,emptyDraft()));}finally{fs.renameSync=rename;}
 assert.deepEqual(fs.readFileSync(file),before);assert.equal(fs.readdirSync(dir).filter(n=>n.endsWith('.tmp')).length,0);
});
test('strict IPC and draft boundaries reject extra fields, duplicate exemplars, invalid profile paths and excessive anchors',()=>{
 const accountId=randomUUID(),draft=value();assert.ok(commandSchema.safeParse({action:'planner.draft',accountId,targetId:4,draft}).success);
 for(const input of [{action:'planner.draft',accountId,targetId:4,url:'https://example.invalid'},{action:'planner.draft',accountId:'../outside',targetId:4},{action:'planner.draft',accountId,targetId:0},{action:'planner.draft',accountId,targetId:4,draft:{...draft,token:'SYNTHETIC_EXTRA'}}])assert.equal(commandSchema.safeParse(input).success,false);
 assert.equal(draftSchema.safeParse({...draft,anchors:[draft.anchors[0],draft.anchors[0]]}).success,false);
 assert.equal(draftSchema.safeParse({...draft,anchors:Array(101).fill(draft.anchors[1])}).success,false);
 assert.equal(draftSchema.safeParse({...draft,anchors:[{...draft.anchors[0],key:'../bad'}]}).success,false);
});
