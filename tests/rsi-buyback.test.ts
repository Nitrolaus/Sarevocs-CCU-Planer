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
  assert.equal(isBuybackListRead({ ...request, url: buybackPageUrl(170) }, buybackPageUrl(170)), true);
  assert.throws(() => buybackPageUrl(202));
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

test('reads a large multipage list and confirms a full last page with an explicit empty page', async () => {
  const ids = Array.from({ length: 250 }, (_, index) => String(index + 1));
  const pages: number[] = [];
  const read = await readBuybacks(async page => {
    pages.push(page);
    if (page < 170) return result([String(1000 + page)], true);
    if (page === 170) return result(ids);
    return result([]);
  }, () => {});
  assert.equal(pages.length, 171);
  assert.equal(read?.entries.length, 419);
  assert.equal(read?.observation.current, true);
});

test('reports unreadable and duplicate pages without using entry contents in diagnostics', async () => {
  const reasons: string[] = [];
  const report = (reason: string) => reasons.push(reason);
  assert.equal(await readBuybacks(async () => null, () => {}, report), null);
  assert.equal(await readBuybacks(async page => result(['123'], page === 1), () => {}, report), null);
  assert.deepEqual(reasons, ['buyback-page-unreadable', 'buyback-duplicate-entry']);
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
