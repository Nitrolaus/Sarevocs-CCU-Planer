import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { rsiFetchPageProbe, RSI_PAGE_PROBE, RSI_HANDLE_PROBE } from '../src/importers/rsi-page';

const origin = 'https://robertsspaceindustries.com';

test('gleicher Kontoname in mehreren Layouts zählt als eine Identität, unterschiedliche bleiben unklar',()=>{
 for(const [labels,expected] of [
  [[],null],[[''],null],[['   '],null],[['OWNER'],'OWNER'],[['OWNER','OWNER'],'OWNER'],
  [[' OWNER ','','OWNER'],'OWNER'],[['OWNER','OTHER'],null],[['','OWNER','OTHER'],null],
 ] as const){
  const nodes=labels.map(textContent=>({textContent}));
  const list={children:[{tagName:'LI',querySelector:(selector:string)=>selector==='.empty-list'?{}:null}]};
  const document={querySelectorAll:(selector:string)=>selector==='.c-account-sidebar__profile-info-handle'?nodes:selector==='.list-items'?[list]:[],
   querySelector:(selector:string)=>selector==='.c-account-sidebar__profile-info-handle'?nodes[0]??null:null};
  const context={document,location:{href:origin+'/account/pledges'},URL};
  assert.equal(runInNewContext(RSI_HANDLE_PROBE,context),expected,JSON.stringify(labels));
  const page=runInNewContext(RSI_PAGE_PROBE,context);
  assert.equal(page.ok,true);assert.equal(page.handle,expected,JSON.stringify(labels));
 }
});

test('Folgeseiten überschreiten Leselimit nicht und geben den Stream frei', async () => {
  const chunk = new Uint8Array(4 * 1024 * 1024 + 1);
  let reads = 0, released = false, signal: AbortSignal | undefined;
  const result = await runInNewContext(rsiFetchPageProbe(2, origin + '/en/account/pledges'), {
    AbortController, TextDecoder, setTimeout, clearTimeout,
    fetch: async (_url: string, options: RequestInit) => {
      signal = options.signal ?? undefined;
      return { ok: true, headers: { get: () => 'text/html' }, body: { getReader: () => ({
        read: async () => { reads++; return { done: false, value: chunk }; },
        releaseLock: () => { released = true; },
      }) } };
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'page-read-failed');
  assert.equal(reads, 2);
  assert.equal(signal?.aborted, true);
  assert.equal(released, true);
});
test('Folgeseiten verwenden die geprüfte Hangarsprache und festen Query ohne URL-Nutzlast', () => {
  for (const [source, expected] of [
    ['/account/pledges', '/en/account/pledges'],
    ['/account/pledges/', '/en/account/pledges'],
    ['/en/account/pledges', '/en/account/pledges'],
    ['/de/account/pledges/', '/de/account/pledges'],
    ['/fr/account/pledges', '/fr/account/pledges'],
    ['/en-US/account/pledges', '/en-US/account/pledges'],
  ]) {
    const script = rsiFetchPageProbe(2, origin + source + '?page=99&apply_upgrade=SYNTHETIC_QUERY_CANARY#SYNTHETIC_HASH_CANARY');
    assert.ok(script.includes('fetch(' + JSON.stringify(origin + expected + '?page=2&pagesize=10')));
    assert.ok(!script.includes('SYNTHETIC_QUERY_CANARY') && !script.includes('SYNTHETIC_HASH_CANARY'));
    assert.ok(!script.includes('apply_upgrade=') && !script.includes('page=99'));
    assert.ok(script.includes("method: 'GET', credentials: 'same-origin', redirect: 'error', cache: 'no-store'"));
    assert.doesNotThrow(() => new Function('return ' + script));
  }
});

test('Folgeseiten weisen fremde, unsichere, Anmelde- und Aktionsziele vor Skripterzeugung ab', () => {
  for (const source of [
    'http://robertsspaceindustries.com/en/account/pledges',
    'https://example.invalid/en/account/pledges',
    'https://robertsspaceindustries.com.example.invalid/en/account/pledges',
    'https://support.robertsspaceindustries.com/en/account/pledges',
    'https://robertsspaceindustries.com:444/en/account/pledges',
    'https://synthetic:fixture@robertsspaceindustries.com/en/account/pledges',
    origin + '/en/connect', origin + '/en/sign-in', origin + '/en/account/pledges/apply-upgrade',
    origin + '/en/account/pledges%2f', origin + '/english/account/pledges',
    'not-a-url', '',
  ]) assert.throws(() => rsiFetchPageProbe(1, source));
});

test('Folgeseiten erlauben nur begrenzte ganzzahlige Seitennummern', () => {
  for (const page of [0, -1, 5001, 1.5, Number.NaN, Infinity, -Infinity]) {
    assert.throws(() => rsiFetchPageProbe(page, origin + '/en/account/pledges'));
  }
  for (const page of [1, 5000]) {
    assert.ok(rsiFetchPageProbe(page, origin + '/en/account/pledges').includes('?page=' + page + '&pagesize=10'));
  }
});
