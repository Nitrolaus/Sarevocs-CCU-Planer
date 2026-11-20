import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, type Session } from 'electron';
import { readPurchases, PURCHASE_LOG_URL, purchaseOrdersUrl } from '../../src/importers/rsi-purchases';
import { inventoryAcquisitionPrice, RSI_LOG_PRICE, RSI_ORDER_PRICE } from '../../src/pricing/inventory-values';
import { evaluateRsiSessionRequest } from '../../src/main/policy';
import { purchaseParserProbe } from '../../src/importers/rsi-purchase-data';
import { demoDocument } from '../fixtures';

const profile = process.env.CCU_TEST_PROFILE!;
app.setPath('userData', profile);
app.setPath('sessionData', profile);
app.on('window-all-closed', () => {});
const report = path.join(profile, 'result.json');
const owner = 'FixtureOwner', token = 'SYNTHETIC_TOKEN';
const title = 'Standalone Ships - Fixture Ship';
const names = [title, title, 'Package - Fixture Bundle', title, title, 'Standalone Ships - Original Fixture', title, title, title];
const pledges = names.map((name, index) => ({ ...demoDocument().pledges[0]!, pledgeId: String(700 + index), name,
  acquisitionCost: null, sourceValues: {pledgeValue:'$75.00 USD'} }));
const cookie = { name: 'Rsi-Token', value: token, domain: 'robertsspaceindustries.com', path: '/', secure: true, httpOnly: true, hostOnly: true, session: true };
const active = { cookies: { get: async () => [cookie] } } as unknown as Session;
const row = (id: number, name: string, detail: string) => `<div class="pledge-log-entry"><p>
   Nov 1 2026, 10:12 pm - <span class="important">${name}</span> #${id} - ${detail}</p></div>`;
const log = (id: number, order: string, value = '$88.00 USD', handle = owner) => row(id, names[id - 700]!,
  `Created by ${handle} - order #${order}, value: ${value}`);
const order = (id: string, name: string, total: string, discount = '€0.00 EUR', qty = '1', status = 'CLOSED') => `<li>
  <div class="basic-infos"><div class="col"><span>Order Id:</span> ${id}</div>
  <div class="col"><span>Status:</span> ${status}</div><div class="col"><span>Payment:</span> PAID</div>
  <div class="col"><span>Fulfillment:</span> DONE</div></div><table class="billing-summary"><tr>
  <td>${name}</td><td>${total}</td><td>${qty}</td><td>€0.00 EUR</td><td>${total}</td></tr></table>
  <div class="payment-wrapper"><div class="right-section"><strong>Additional Discount:</strong><span>${discount}</span><br>
  <strong>Credits used:</strong><span>€5.00 EUR</span></div><div class="address">SYNTHETIC_ADDRESS</div></div></li>`;

function fakeTransport(failOrders = false) {
  type Filter = (details: { url: string; method: string }, reply: (response: {cancel: boolean}) => void) => void;
  let guard: Filter, cleared = false;
  const reads: string[] = [];
  const permitted = (url: string, method: string) => {
    let allow = false;
    guard({url, method}, result => { allow = !result.cancel; });
    return allow;
  };
  const transport = {
    cookies: { set: async () => {} },
    webRequest: { onBeforeRequest: (listener: Filter) => { guard = listener; }, onBeforeRedirect: () => {} },
    clearStorageData: async () => { cleared = true; }, clearCache: async () => {}, closeAllConnections: async () => {},
    fetch: async (url: string, opts: RequestInit) => {
      const headers = new Headers(opts.headers);
      assert.equal(opts.redirect, 'error');
      assert.equal(permitted('https://fixture.invalid/', opts.method!), false);
      assert.equal(permitted(PURCHASE_LOG_URL + '/mutate', opts.method!), false);
      assert.equal(permitted(url, opts.method === 'GET' ? 'POST' : 'GET'), false);
      assert.equal(permitted(url, opts.method!), true);
      assert.equal(permitted(url, opts.method!), false);
      if (opts.method === 'POST') {
        assert.equal(url, PURCHASE_LOG_URL);
        assert.equal(headers.get('x-rsi-token'), token);
        const page = JSON.parse(opts.body as string).page;
        reads.push('log'+page);
        const html = page === 1 ? log(700,'FIXTURE01') + log(701,'FIXTURE02') + log(702,'FIXTURE03','$1,234.56 USD')
          + log(703,'FIXTURE04','$88.00 USD','OtherFixture') + log(704,'FIXTURE05')
          + log(706,'FIXTURE07') + log(707,'FIXTURE07') + log(708,'FIXTURE08') :
          row(704,title,'Claimed as a gift by FixtureOwner, value: $12.00 USD') + log(705,'FIXTURE06');
        return Response.json({success:1,data:{pagecount:'2',rendered:html}});
      }
      assert.equal(headers.has('x-rsi-token'), false);
      const page = new URL(url).searchParams.get('page');
      assert.equal(url, purchaseOrdersUrl(Number(page)));
      reads.push('order'+page);
      if (failOrders) throw Error('synthetic network failure');
      const html = page === '1' ? order('FIXTURE01','Standalone Ship - Fixture Ship','€72.41 EUR') + order('FIXTURE02',title,'€82.42 EUR','€10.00 EUR')
        + order('FIXTURE07',title,'€74.48 EUR','€0.00 EUR','2') + order('FIXTURE08',title,'€77.77 EUR','€0.00 EUR','1','CANCELLED') :
        order('FIXTURE06',names[5]!,'€67.23 EUR') + order('FIXTURE03',names[2]!,'€72.51 EUR','€0.00 EUR','2');
      return new Response('<img src="https://fixture.invalid/tracking"><script>throw Error("SCRIPT_EXECUTED")</script><ul class="orders-item">'+html+'</ul>',
        {headers:{'content-type':'text/html; charset=utf-8'}});
    },
  };
  return { create: () => transport as unknown as Session, reads, cleaned: () => cleared };
}

void app.whenReady().then(async () => {
  try {
    const parser = new BrowserWindow({show:false});
    await parser.loadURL('about:blank');
    assert.deepEqual(await parser.webContents.executeJavaScript(purchaseParserProbe('log', log(700,'FIXTURE01'), ['700'])),
      [{id:'700',title,owner,order:'FIXTURE01',value:'$88.00 USD'}]);
    assert.deepEqual(await parser.webContents.executeJavaScript(purchaseParserProbe('order', '<ul class="orders-item">'+order('FIXTURE01',title,'€72.41 EUR')+'</ul>', ['FIXTURE01'])),
      [{id:'FIXTURE01',paid:true,discount:'€0.00 EUR',lines:[{title,quantity:'1',total:'€72.41 EUR'}]}]);
    parser.destroy();
    const readPhase = (url: string, method: string, resourceType = 'xhr') => evaluateRsiSessionRequest({url, method, resourceType}, 'read').blocked;
    assert.equal(readPhase(PURCHASE_LOG_URL, 'POST'), true);
    assert.equal(readPhase(purchaseOrdersUrl(1), 'GET', 'mainFrame'), true);
    const fixture = fakeTransport();
    const result = await readPurchases(active, pledges, owner, () => {}, fixture.create);
    assert.equal(fixture.cleaned(), true);
    const recorded = (minor: number, currency: 'EUR' | 'USD', source: 'log' | 'order') => ({ status:'documented', source, currency, minor });
    assert.deepEqual(result.get('700'), recorded(7241,'EUR','order'));
    assert.deepEqual(result.get('701'), recorded(8800,'USD','log'));
    assert.deepEqual(result.get('702'), recorded(123456,'USD','log'));
    for (const id of ['703','704','708']) assert.deepEqual(result.get(id), {status:'excluded'});
    assert.deepEqual(result.get('705'), recorded(6723,'EUR','order'));
    for (const id of ['706','707']) assert.deepEqual(result.get(id), recorded(3724,'EUR','order'));
    assert.deepEqual(fixture.reads, ['log1','log2','order1','order2']);
    const captured = JSON.stringify([...result]);
    assert.doesNotMatch(captured, /FIXTURE0|FixtureOwner|OtherFixture|SYNTHETIC_ADDRESS|SYNTHETIC_TOKEN/);
    assert.equal(inventoryAcquisitionPrice({...pledges[0]!,rsiPurchase:result.get('700')!},'rsi-dom-probe/1').value?.evidence, RSI_ORDER_PRICE);
    assert.equal(inventoryAcquisitionPrice({...pledges[1]!,rsiPurchase:result.get('701')!},'rsi-dom-probe/1').value?.evidence, RSI_LOG_PRICE);
    assert.equal(inventoryAcquisitionPrice({...pledges[4]!,rsiPurchase:result.get('704')!},'rsi-dom-probe/1').value, null);
    const ordersOnly = fakeTransport();
    const withoutHandle = await readPurchases(active, pledges, null, () => {}, ordersOnly.create);
    assert.deepEqual(withoutHandle.get('700'), recorded(7241,'EUR','order'));
    assert.deepEqual(withoutHandle.get('705'), recorded(6723,'EUR','order'));
    for (const id of ['701','702','703']) assert.equal(withoutHandle.has(id), false);
    for (const id of ['706','707']) assert.deepEqual(withoutHandle.get(id), recorded(3724,'EUR','order'));
    for (const id of ['704','708']) assert.deepEqual(withoutHandle.get(id), {status:'excluded'});
    const interrupted = fakeTransport(true);
    const problems: string[] = [];
    assert.deepEqual((await readPurchases(active, pledges, owner, () => {}, interrupted.create, problem => problems.push(problem))).get('700'), recorded(8800,'USD','log'));
    assert.deepEqual(problems, ['purchase-orders-unavailable']);
    assert.equal((await readPurchases(active, pledges, null, () => {}, fakeTransport(true).create)).has('700'), false);
    assert.equal(interrupted.cleaned(), true);
    const unopened = fakeTransport();
    const emptySession = {cookies:{get:async()=>[]}} as unknown as Session;
    assert.equal((await readPurchases(emptySession, pledges, owner, () => {}, unopened.create)).size, 0);
    assert.deepEqual(unopened.reads, []);
    fs.writeFileSync(report, JSON.stringify({status:'PASS', checks:['session scope','read-only routes','two log pages','two billing pages','price evidence','multiple identical units','cent rounding','missing handle','private fields','fallback','cleanup']}));
    app.exit(0);
  } catch (error) { fs.writeFileSync(report, JSON.stringify({status:'FAIL', error:String(error)})); app.exit(1); }
});
