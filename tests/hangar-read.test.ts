import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {readHangarPages} from '../src/importers/hangar-read';import {LastSeenStore} from '../src/storage/last-seen';import {BackgroundInventory} from '../src/main/background-inventory';import type {Account} from '../src/domain/model';
const pledge=(n:number)=>({pledgeId:'synthetic-'+n,pledgeName:'SYNTHETIC CCU '+n,pledgeValue:'$5.00 USD',date:'Created: November 1, 2025',items:[],alsoContains:[],upgrade:{from:'Synthetic A',to:'Synthetic B'}});
const page=(start:number,count=10,handle:string|null='SYNTHETIC')=>({ok:true as const,handle,pledges:Array.from({length:count},(_,i)=>pledge(start+i))});
const accountId='11111111-1111-4111-8111-111111111111';
test('5000 pledges read sequentially through 501 pages, even beyond a simulated minute, without a partial success claim',async()=>{
 let elapsed=0,inFlight=0,maxInFlight=0;const calls:number[]=[],progress:number[]=[];
 const result=await readHangarPages({accountId,initial:page(1),restartAtFirst:false,assertActive:()=>{},sleep:async ms=>{elapsed+=ms;},loadPage:async n=>{inFlight++;maxInFlight=Math.max(maxInFlight,inFlight);calls.push(n);await Promise.resolve();inFlight--;return n<=500?page((n-1)*10+1):page(1,0);},onProgress:p=>progress.push(p.pledgesRead)});
 assert.equal(result.candidate.document.pledges.length,5000);assert.equal(result.pagesRead,501);assert.equal(new Set(result.candidate.document.pledges.map(p=>p.pledgeId)).size,5000);assert.equal(maxInFlight,1);assert.ok(elapsed>60000);assert.equal(progress.at(-1),5000);assert.equal(result.candidate.completeness,'partial');assert.equal(result.candidate.document.scope.exportComplete,false);
});
test('240 pages with a full final page continue beyond one minute and only retry the slow page', async () => {
  const lastPage = 240;
  const slowPage = 183;
  let elapsed = 0, waits = 0;
  const requested: number[] = [];
  const result = await readHangarPages({
    accountId, initial: page(1), restartAtFirst: false, assertActive: () => {},
    sleep: async milliseconds => { elapsed += milliseconds; },
    loadPage: async number => {
      elapsed += 550;
      requested.push(number);
      if (number === slowPage && requested.at(-2) !== slowPage) return { ok: false, retryable: true, retryAfterMs: 4000 };
      return { ...page((number - 1) * 10 + 1), totalPages: lastPage, activePage: number,
        navigation: number === lastPage ? 'last' : 'next' };
    },
    onProgress: progress => {
      if (progress.waiting) {
        waits++;
        assert.equal(progress.page, slowPage);
        assert.equal(progress.pagesRead, slowPage - 1);
        assert.equal(progress.pledgesRead, (slowPage - 1) * 10);
        assert.equal(progress.totalPages, lastPage);
      }
    },
  });
  assert.ok(elapsed > 60_000);
  assert.equal(waits, 1);
  assert.deepEqual(requested, Array.from({ length: lastPage }, (_, index) => index + 1)
    .flatMap(number => number === slowPage ? [number, number] : [number]));
  assert.equal(result.pagesRead, lastPage);
  assert.equal(result.candidate.document.pledges.length, lastPage * 10);
  assert.deepEqual(result.candidate.hangarRead, { kind: 'reached-end', pagesRead: lastPage, pledgesRead: lastPage * 10 });
});
test('Only explicitly transient failures retry the same page with bounded backoff',async()=>{
 const calls:number[]=[],waits:number[]=[];let failures=0;const result=await readHangarPages({accountId,initial:page(1),restartAtFirst:false,assertActive:()=>{},sleep:async ms=>{waits.push(ms);},loadPage:async n=>{calls.push(n);if(n===2&&failures++<2)return {ok:false,retryable:true,retryAfterMs:500};return n===1?page(1):page(11,2);}});
 assert.deepEqual(calls,[1,2,2,2]);assert.equal(result.candidate.document.pledges.length,12);assert.equal(waits.reduce((a,b)=>a+b,0),4150);
});
test('A verified full final page ends the read without requesting a nonexistent page', async () => {
  const requested: number[] = [];
  const result = await readHangarPages({
    accountId, initial: page(1), restartAtFirst: false, assertActive: () => {}, sleep: async () => {},
    loadPage: async number => {
      requested.push(number);
      if (number === 29) return { ok: false, reason: 'unexpected-response' };
      return { ...page((number - 1) * 10 + 1), navigation: number === 28 ? 'last' : 'next' };
    },
  });
  assert.deepEqual(requested, Array.from({ length: 28 }, (_, index) => index + 1));
  assert.equal(result.candidate.document.pledges.length, 280);
  assert.equal(result.candidate.completeness, 'partial');
});
test('An empty page with a verified next link rejects the scan instead of saving partial data', async () => {
  await assert.rejects(() => readHangarPages({
    accountId, initial: page(1), restartAtFirst: false, assertActive: () => {}, sleep: async () => {},
    loadPage: async number => ({ ...page((number - 1) * 10 + 1, number === 2 ? 0 : 10), navigation: 'next' }),
  }), /Seitenfolge/);
});
test('Permanent errors stop immediately and exhausted transient errors do not return a partial candidate',async()=>{
 for(const retryable of [false,true]){let calls=0;await assert.rejects(()=>readHangarPages({accountId,initial:page(1),restartAtFirst:false,assertActive:()=>{},sleep:async()=>{},loadPage:async n=>{calls++;return n===1?page(1):{ok:false,retryable};}}),/nicht sicher gelesen/);assert.equal(calls,retryable?4:2);}
});
test('Cancellation interrupts server-requested pauses without issuing another fetch',async()=>{
 let active=true,calls=0;await assert.rejects(()=>readHangarPages({accountId,initial:page(1),restartAtFirst:false,assertActive:()=>{if(!active)throw Error('CANCELLED');},sleep:async()=>{active=false;},loadPage:async()=>{calls++;return {ok:false,retryable:true,retryAfterMs:60000};}}),/CANCELLED/);assert.equal(calls,1);
});
test('Repeating full pages, overlapping identities and account changes are failures rather than successful page endings',async()=>{
 for(const end of [page(1),page(10,2),page(11,2,'OTHER')])await assert.rejects(()=>readHangarPages({accountId,initial:page(1),restartAtFirst:false,assertActive:()=>{},sleep:async()=>{},loadPage:async n=>n===1?page(1):end}));
});
test('The normalized cache budget is checked incrementally rather than after an unbounded read',async()=>{
 let fetched=0;await assert.rejects(()=>readHangarPages({accountId,initial:page(1),restartAtFirst:false,assertActive:()=>{},sleep:async()=>{},loadPage:async n=>{fetched++;const p=page((n-1)*10+1);return {...p,pledges:p.pledges.map(p=>({...p,contains:'x'.repeat(3800),pledgeConfigurationValue:'y'.repeat(3800)}))};}}),/20 MiB/);assert.ok(fetched<500);
});
test('A failed large background scan preserves the last valid cache and revision',async()=>{
 const directory=path.resolve('work/temp/hangar-read-tests',randomUUID());fs.mkdirSync(directory,{recursive:true});const account:Account={id:accountId,name:'SYNTHETIC',mode:'real',reference:null,identityKind:null,identityStatus:'unbound',lastComplete:null};
 const cache=new LastSeenStore(directory),initial=await readHangarPages({accountId,initial:page(1,2,null),restartAtFirst:false,assertActive:()=>{},loadPage:async()=>{throw Error('NOT_EXPECTED');}}),before=cache.save(account,initial.candidate);
 const bytes=fs.readFileSync(path.join(directory,accountId+'.json')),background=new BackgroundInventory(cache,()=>account,async()=>{await readHangarPages({accountId,initial:page(1),restartAtFirst:false,assertActive:()=>{},sleep:async()=>{},loadPage:async()=>page(1)});throw Error('MUST_NOT_PUBLISH');},async()=>{});
 await background.refresh(accountId);assert.equal(background.snapshot(accountId).status,'unavailable');assert.equal(background.snapshot(accountId).revision,before.revision);assert.deepEqual(fs.readFileSync(path.join(directory,accountId+'.json')),bytes);
});
