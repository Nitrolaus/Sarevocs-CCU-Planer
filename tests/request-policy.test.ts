import test from 'node:test';
import assert from 'node:assert/strict';
import { blockedOperation, allowedRsiNavigation, evaluateOperation, evaluateRsiSessionRequest, OPERATION_BLOCK_DETAILS } from '../src/main/policy';

const asset = 'https://cdn.robertsspaceindustries.com/scripts/cart-widget.js';
const read = { method: 'GET', resourceType: 'script' };

test('RSI session grants authentication submissions only in their matching phase', () => {
  const submit = (url: string) => ({ url, method: 'POST', resourceType: 'xhr' });
  const signIn = submit('https://robertsspaceindustries.com/en/sign-in');
  const mfa = submit('https://robertsspaceindustries.com/en/sign-in/send-confirmation-code');
  const captcha = submit('https://www.recaptcha.net/recaptcha/enterprise/reload');
  for (const request of [signIn, mfa]) {
    assert.equal(evaluateRsiSessionRequest(request, 'login').blocked, false);
    for (const phase of ['read', 'captcha', 'closed'] as const) assert.equal(evaluateRsiSessionRequest(request, phase).blocked, true);
  }
  assert.equal(evaluateRsiSessionRequest(captcha, 'captcha').blocked, false);
  for (const phase of ['read', 'login', 'closed'] as const) assert.equal(evaluateRsiSessionRequest(captcha, phase).blocked, true);
});

test('RSI session permits bounded hangar and static reads and rejects unlisted traffic in every phase', () => {
  const hangar = { url: 'https://robertsspaceindustries.com/de/account/pledges?page=2&pagesize=10', method: 'GET', resourceType: 'xhr' };
  for (const phase of ['login', 'captcha', 'read'] as const) {
    assert.equal(evaluateRsiSessionRequest(hangar, phase).blocked, false);
    assert.equal(evaluateRsiSessionRequest({ ...read, url: asset }, phase).blocked, false);
    for (const request of [{ ...hangar, method: 'POST' }, { ...hangar, url: hangar.url + '&extra=1' },
      { ...hangar, url: 'https://robertsspaceindustries.com/unlisted', method: 'POST' },
      { ...read, url: 'https://example.invalid/static/style.js' }]) {
      assert.equal(evaluateRsiSessionRequest(request, phase).blocked, true);
    }
  }
  assert.equal(evaluateRsiSessionRequest(hangar, 'closed').blocked, true);
});

test('Every exclusion has a fixed non-sensitive diagnostic category', () => {
  const cases = [
    ['invalid', read, 'invalid-url-or-path'],
    [asset, undefined, 'request-context-missing'],
    ['https://robertsspaceindustries.com/api/cart', read, 'api-or-action-path'],
    [asset, { ...read, method: 'POST' }, 'non-read-method'],
    [asset, { ...read, resourceType: 'mainFrame' }, 'unsupported-resource'],
    [asset.replace('cdn.robertsspaceindustries.com', 'example.invalid'), read, 'untrusted-asset-origin'],
    [asset.replace('cart-widget.js', 'cart%252ejs'), read, 'ambiguous-asset-encoding'],
    [asset.replace('/scripts/', '/unknown/'), read, 'unknown-static-root'],
    [asset.replace('.js', '.bin'), read, 'unsupported-file-name'],
    [asset + '?v=' + '1'.repeat(1025), read, 'query-limits'],
    [asset + '?SYNTHETIC_PRIVATE_KEY=SYNTHETIC_PRIVATE_VALUE', read, 'unsupported-query-key'],
    [asset + '?v=SYNTHETIC%20PRIVATE%20VALUE', read, 'unsupported-query-value'],
  ] as const;
  const sessionOnly = ['session-closed', 'navigation-not-allowed'];
  assert.deepEqual(new Set([...cases.map(([, , detail]) => detail), ...sessionOnly]), new Set(OPERATION_BLOCK_DETAILS));
  assert.deepEqual(evaluateRsiSessionRequest({ ...read, url: asset }, 'closed'), { blocked: true, detail: 'session-closed' });
  assert.deepEqual(evaluateRsiSessionRequest({ method: 'GET', resourceType: 'mainFrame', url: 'https://example.invalid/' }, 'read'),
    { blocked: true, detail: 'navigation-not-allowed' });
  for (const [url, context, detail] of cases) assert.deepEqual(evaluateOperation(url, context), { blocked: true, detail });
  assert.deepEqual(evaluateOperation(asset, read), { blocked: false });
  assert.deepEqual(evaluateOperation('https://robertsspaceindustries.com/en/connect', { method: 'POST', resourceType: 'xhr' }), { blocked: false });
});

test('Read-only static RSI assets may contain action words in their filenames', () => {
  const fixtures = [
    [asset + '?v=1.2', 'script'],
    ['https://robertsspaceindustries.com/rsi/static/checkout.abc.mjs', 'script'],
    ['https://cdn.robertsspaceindustries.com/assets/css/payment-status.css', 'stylesheet'],
    ['https://media.robertsspaceindustries.com/cache/images/cart-preview.png', 'image'],
    ['https://cdn.robertsspaceindustries.com/fonts/gift-icons.woff2', 'font'],
    ['https://cdn.robertsspaceindustries.com/assets/cart-data.json', 'xhr'],
    ['https://cdn.robertsspaceindustries.com/scripts/reclaim-widget.js', 'other'],
  ];
  for (const [url, resourceType] of fixtures) for (const method of ['GET', 'HEAD']) {
    assert.equal(blockedOperation(url!, { method, resourceType: resourceType! }), false, `${method} ${url}`);
  }
});
test('Purchase and change routes remain blocked for every method and resource type', () => {
  for (const operation of ['checkout', 'reclaim', 'apply-upgrade', 'apply_upgrade', 'gift', 'buyback', 'buy-back', 'cart', 'payment']) {
    for (const method of ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE']) for (const resourceType of ['script', 'xhr', 'other', 'mainFrame']) {
      assert.equal(blockedOperation('https://robertsspaceindustries.com/api/' + operation, { method, resourceType }), true);
    }
  }
});
test('A file extension cannot exempt API/action routes, redirects or disguised namespaces', () => {
  for (const pathname of ['/api/cart.js', '/api/store/checkout/style.css', '/store/checkout.js', '/account/pledges/reclaim.js',
    '/scripts/cart/reclaim.js', '/assets/api/gift.js', '/scripts/graphql/payment.json', '/cache/checkout/cart-widget.js',
    '/assets/../api/cart.js', '/scripts/..%2fapi/%63art.js', '/scripts/%252e%252e%252fapi/cart.js',
    '/api%2f..%2fscripts/cart.js', '/api%5c..%5cscripts/cart.js', '/scripts/cart.js;reclaim']) {
    assert.equal(blockedOperation('https://cdn.robertsspaceindustries.com' + pathname, read), true, pathname);
  }
  assert.equal(allowedRsiNavigation(asset), false);
  assert.equal(allowedRsiNavigation('https://robertsspaceindustries.com/store/checkout'), false);
});
test('Static-file exception requires trusted HTTPS location, read method and subresource context', () => {
  for (const url of [asset.replace('https:', 'http:'), asset.replace('cdn.', 'cdn.robertsspaceindustries.com.evil.test/'),
    asset.replace('cdn.robertsspaceindustries.com', 'evil.test'), asset.replace('https://', 'https://user:pass@'),
    asset.replace('.com/', '.com:8443/'), asset.replace('/scripts/', '/unknown/'), asset + '?action=checkout',
    asset + '?operation=gift', asset + '?token=not-a-cache-key', 'invalid']) assert.equal(blockedOperation(url, read), true, url);
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) assert.equal(blockedOperation(asset, { ...read, method }), true);
  for (const resourceType of ['mainFrame', 'subFrame', 'webSocket', 'unknown']) assert.equal(blockedOperation(asset, { ...read, resourceType }), true);
  assert.equal(blockedOperation(asset), true, 'Without request context keep the conservative rule');
});
test('Encoded action paths and invalid encodings remain blocked', () => {
  for (const pathname of ['/%63art', '/%2563art', '/%252563art', '/assets/%2e%2e/%63art', '/api/%67ift',
    '/scripts/cart%00.js', '/scripts/cart%ZZ.js', '/scripts/%2525252563art.js']) {
    assert.equal(blockedOperation('https://robertsspaceindustries.com' + pathname, read), true, pathname);
  }
});
