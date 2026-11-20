import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { buybackPageUrl, isBuybackListRead, readBuybacks } from '../src/importers/rsi-buyback';
import { allowedRsiNavigation, blockedOperation, RSI_ORIGIN } from '../src/main/policy';
import { parseImport } from '../src/importers/files';
import { LastSeenStore } from '../src/storage/last-seen';
import type { Account } from '../src/domain/model';
import { demoDocument } from './fixtures';

const entry = (id: string) => ({ entryId: id, name: 'Synthetic Pledge', description: '', currentPrice: null, availability: 'unverified' });
const result = (ids: string[], hasNext = false) => ({ buybacks: ids.map(entry), token: 'unknown', hasNext });

test('only the expected listing XHR GET is allowed by the scoped exception', () => {
  const url = buybackPageUrl(1), request = { method: 'GET', resourceType: 'xhr', url };
  assert.equal(isBuybackListRead(request, url), true);
  for (const changed of [{ ...request, method: 'POST' }, { ...request, method: 'HEAD' }, { ...request, resourceType: 'mainFrame' },
    { ...request, uploadData: [{}] }, { ...request, url: buybackPageUrl(2) }]) assert.equal(isBuybackListRead(changed, url), false);
  for (const other of [url + '&action=buy', RSI_ORIGIN + '/en/account/buy-back-pledges/41', url.replace('/en/', '/'),
    url.replace('robertsspaceindustries.com', 'example.invalid'), url.replace('250', '1')]) {
    assert.equal(isBuybackListRead({ ...request, url: other }, other), false);
  }
  assert.equal(isBuybackListRead(request), false);
  assert.equal(allowedRsiNavigation(url), false);
  assert.equal(blockedOperation(url, request), true);
  assert.throws(() => buybackPageUrl(21));
});

test('only a complete listing produces an observation, and a recognized empty list is distinct from failure', async () => {
  const pages: number[] = [];
  const read = await readBuybacks(async page => {
    pages.push(page);
    return page === 1 ? { ...result(['101'], true), token: 'available' } : result(['102']);
  }, () => {});
  assert.deepEqual(pages, [1, 2]);
  assert.deepEqual(read?.entries.map(e => e.entryId), ['101', '102']);
  assert.equal(read?.observation.token, 'available');
  assert.equal(read?.observation.current, true);
  assert.deepEqual((await readBuybacks(async () => result([]), () => {}))?.entries, []);
  assert.equal(await readBuybacks(async () => null, () => {}), null);
  assert.equal(await readBuybacks(async page => page === 1 ? result(['101'], true) : result(['101']), () => {}), null);
  assert.equal(await readBuybacks(async page => page === 1 ? result(['101'], true) : result([]), () => {}), null);
});

test('a missing listing refresh keeps old entries with a noncurrent token and a confirmed empty reply replaces them', () => {
  const account: Account = { id: randomUUID(), name: 'Synthetic', mode: 'real', reference: null, identityKind: null,
    identityStatus: 'unbound', lastComplete: null };
  const store = new LastSeenStore(path.resolve('work/temp/buyback-tests', account.id));
  const doc = demoDocument();
  doc.dataMode = 'real';
  doc.account = { reference: 'SYNTHETIC_BUYBACK', identityKind: 'rsi-handle' };
  const observedAt = new Date().toISOString();
  store.save(account, parseImport(JSON.stringify({ ...doc, buybackObservation: { observedAt, token: 'available', current: true } })));
  const missing = store.save(account, parseImport(JSON.stringify({ ...doc, buybacks: [] })));
  assert.deepEqual(missing.document.buybacks, doc.buybacks);
  assert.deepEqual(missing.document.buybackObservation, { observedAt, token: 'available', current: false });
  const empty = store.save(account, parseImport(JSON.stringify({ ...doc, buybacks: [], buybackObservation: { observedAt, token: 'unknown', current: true } })));
  assert.deepEqual(empty.document.buybacks, []);
  assert.equal(empty.document.buybackObservation?.current, true);
});
