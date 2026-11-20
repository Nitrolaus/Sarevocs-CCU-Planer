import test from 'node:test';
import assert from 'node:assert/strict';
import type { Session } from 'electron';
import { parseStoreCredit } from '../src/domain/store-credit';
import { CREDIT_URL, CREDIT_BODY, readStoreCredit } from '../src/importers/rsi-credit';

const at = '2026-11-17T17:05:00Z';
const response = (value: unknown, currency='USD') => [{data:{customer:{ledger:{amount:{value,currency:{code:currency}}}}}}];
const cookie = {name: 'Rsi-Token', value:'SYNTHETIC_AUTH', domain:'robertsspaceindustries.com', secure:true, path:'/'};
test('store-credit amount is in whole minor units; an actual zero is distinct from failed reads',()=>{
  assert.equal(parseStoreCredit(response(12500),at)?.minor,12500);
  assert.equal(parseStoreCredit(response(0),at)?.minor,0);
  assert.equal(parseStoreCredit(response('12500','EUR'),at)?.currency,'EUR');
  for(const raw of [null,[],[{errors:[{message:'synthetic'}],...response(0)[0]}],response(-1),response(1.5),response('1e3'),response(100000001),response(12,'UEC'),response(12,'REC'),[{data:{customer:null}}]]) assert.equal(parseStoreCredit(raw,at),null);
  assert.equal(parseStoreCredit(response(1),'not-a-date'),null);
});

test('only a fixed one-shot ledger read is allowed in the headless partition; the result contains the balance',async()=>{
  let cleanups=0;
  const transport = {
    cookies: {set: async () => {}},
    webRequest: {onBeforeRedirect: () => {}, onBeforeRequest: (guard: Function) => {
      for (const [method,url,allow] of [['POST',CREDIT_URL+'?other',false], ['GET',CREDIT_URL,false], ['POST',CREDIT_URL,true], ['POST',CREDIT_URL,false]]) {
        guard({method,url}, ({cancel}:{cancel:boolean}) => assert.equal(!cancel,allow));
      }
    }},
    fetch: async (url:string, init:RequestInit) => {
      assert.equal(url,CREDIT_URL); assert.equal(init.body,CREDIT_BODY); assert.equal(init.redirect,'error');
      assert.equal(init.method,'POST'); assert.equal(init.credentials,'include');
      assert.equal(new Headers(init.headers).get('x-rsi-token')===cookie.value,true);
      return Response.json(response(12500));
    },
    clearStorageData: async () => {cleanups++}
  };
  const result = await readStoreCredit([cookie],'SYNTHETIC_CSRF',async()=>transport as unknown as Session);
  assert.equal(result?.minor,12500); assert.equal(JSON.stringify(result).includes('SYNTHETIC'),false); assert.equal(cleanups,1);
});

test('invalid credentials cannot create a transport; oversized and failed responses yield unknown',async()=>{
  const noTransport=async ():Promise<Session>=>assert.fail('unexpected transport');
  assert.equal(await readStoreCredit([cookie],'',noTransport),null);
  assert.equal(await readStoreCredit([cookie,{...cookie,value:'SECOND'}],'csrf',noTransport),null);
  assert.equal(await readStoreCredit([{...cookie,domain:'example.invalid'}],'csrf',noTransport),null);
  for(const reply of [new Response('{}',{status:403}),new Response(' '.repeat(16385),{headers:{'Content-Type':'application/json'}}),Response.json({})]) {
    let cleared=false;
    const transport = {webRequest:{onBeforeRequest:()=>{},onBeforeRedirect:()=>{}},cookies:{set:async()=>{}},fetch:async()=>reply,clearStorageData:async()=>{cleared=true}};
    assert.equal(await readStoreCredit([cookie],'csrf',async()=>transport as unknown as Session),null);
    assert.equal(cleared,true);
  }
});
