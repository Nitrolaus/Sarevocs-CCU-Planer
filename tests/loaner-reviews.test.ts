import test,{mock} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';
import {LoanerReviews} from '../src/loaners/reviews';import {loanerReviewBasis,loanerReviewKey} from '../src/loaners/review-model';import {deriveLoaners} from '../src/loaners/derive';import type {LoanerCache} from '../src/loaners/model';import {commandSchema} from '../src/main/commands';import {basePledge} from './fixtures';
const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222',key='a'.repeat(64),other='b'.repeat(64),at='2026-11-16T12:00:00Z';
function dir(){const root=path.resolve('work/temp/loaner-review-unit');fs.mkdirSync(root,{recursive:true});return fs.mkdtempSync(path.join(root,'case-'));}
test('Self reports persist across restart, remain profile-specific and can be corrected and reset',()=>{
 const folder=dir(),s=new LoanerReviews(folder,()=>at);assert.deepEqual(fs.readdirSync(folder),[]);assert.equal(s.snapshot(a).readable,true);assert.deepEqual(fs.readdirSync(folder),[]);
 assert.equal(s.set(a,key,'present').entries[key]!.state,'present');assert.deepEqual(s.snapshot(b).entries,{});
 const again=new LoanerReviews(folder,()=>at);assert.deepEqual(again.snapshot(a).entries[key],{state:'present',updatedAt:at});
 again.set(b,key,'absent');again.set(a,key,'absent');again.set(a,other,'present');assert.equal(again.snapshot(a).entries[key]!.state,'absent');
 again.set(a,key,'unconfirmed');assert.equal(again.snapshot(a).entries[key],undefined);assert.equal(again.snapshot(a).entries[other]!.state,'present');assert.equal(again.snapshot(b).entries[key]!.state,'absent');
 assert.deepEqual(fs.readdirSync(folder).sort(),['loaner-'+a+'.json','loaner-'+b+'.json']);
});
test('Malformed, oversized, wrong-profile and newer-version review data are preserved and never silently overwritten',()=>{
 for(const content of ['{bad',JSON.stringify({schemaVersion:2,accountId:a,entries:{}}),JSON.stringify({schemaVersion:1,accountId:b,entries:{}}),' '.repeat(385*1024)]){
  const folder=dir(),file=path.join(folder,'loaner-'+a+'.json');fs.writeFileSync(file,content);const s=new LoanerReviews(folder);
  assert.equal(s.snapshot(a).readable,false);assert.throws(()=>s.set(a,key,'present'));assert.equal(fs.readFileSync(file,'utf8'),content);
 }
});
test('A failed atomic write preserves the prior saved confirmation and removes only its own temporary file',()=>{
 const folder=dir(),s=new LoanerReviews(folder,()=>at);s.set(a,key,'present');const file=path.join(folder,'loaner-'+a+'.json'),before=fs.readFileSync(file,'utf8');
 const rename=mock.method(fs,'renameSync',()=>{throw Error('SYNTHETIC_RENAME_FAILURE');});try{assert.throws(()=>s.set(a,key,'absent'));}finally{rename.mock.restore();}
 assert.equal(fs.readFileSync(file,'utf8'),before);assert.deepEqual(fs.readdirSync(folder),['loaner-'+a+'.json']);assert.equal(s.snapshot(a).entries[key]!.state,'present');
});
test('Account, fingerprint, state and command fields are bounded; confirmations are never RSI authentication payloads',()=>{
 const s=new LoanerReviews(dir());for(const id of ['../outside','x','a/'.repeat(50)])assert.throws(()=>s.snapshot(id));
 assert.throws(()=>s.set(a,'../bad','present'));assert.throws(()=>s.set(a,key,'confirmed' as never));
 assert.equal(commandSchema.safeParse({action:'loaners.review',accountId:a,key,state:'present'}).success,true);
 assert.equal(commandSchema.safeParse({action:'loaners.reviews',accountId:a}).success,true);
 for(const field of ['url','token','cookie','price','confirmedByRsi','updatedAt'])assert.equal(commandSchema.safeParse({action:'loaners.review',accountId:a,key,state:'present',[field]:'synthetic'}).success,false);
});
test('Review fingerprints bind to the actual granting ships and rule meaning, not refresh timestamps or array order',async()=>{
 const p=basePledge('synthetic');p.ships[0]!.modelName='Expanse';
 const cache:LoanerCache={schemaVersion:1,loaners:{articleId:360003093114,updatedAt:at,fetchedAt:at,rows:[{parent:'Expanse',children:[{name:'Prospector',replaces:null}]}]},included:{articleId:4408770370455,updatedAt:at,fetchedAt:at,rows:[{parent:'Other',children:[{name:'Example',replaces:null}]}]}};
 const row=deriveLoaners([p],cache).rows[0]!,basis=loanerReviewBasis(row),fingerprint=await loanerReviewKey(basis);assert.equal(fingerprint,createHash('sha256').update(basis).digest('hex'));
 const reordered=structuredClone(row);reordered.origins.reverse();assert.equal(await loanerReviewKey(loanerReviewBasis(reordered)),fingerprint);
 for(const change of [(r:typeof row)=>{r.origins[0]!.pledgeId='different';},(r:typeof row)=>{r.origins[0]!.childId='other-child';},(r:typeof row)=>{r.origins[0]!.publishedParent='Other variant';},(r:typeof row)=>{r.origins[0]!.replaces='Other';}]){const next=structuredClone(row);change(next);assert.notEqual(await loanerReviewKey(loanerReviewBasis(next)),fingerprint);}
 const s=new LoanerReviews(dir(),()=>at);s.set(a,fingerprint,'present');assert.equal(row.accountVerification,'unconfirmed');assert.equal(deriveLoaners([p],cache).rows[0]!.accountVerification,'unconfirmed');
});
