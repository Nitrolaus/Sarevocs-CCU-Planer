import test from 'node:test';
import assert from 'node:assert/strict';
import { imageOperation, imageQuery, persistedImageBody, fallbackImageBody,
  confirmationOperation, confirmationQuery, persistedConfirmationBody, fallbackConfirmationBody } from './fixtures/rsi-captcha-image';
import { emailCodeOperation, emailCodeQuery, persistedEmailCodeBody, fallbackEmailCodeBody, passwordEyeUrls } from './fixtures/rsi-email-code';
import { blockedOperation, allowedRsiNavigation, evaluateOperation, evaluateRsiSessionRequest, OPERATION_BLOCK_DETAILS } from '../src/main/policy';

const asset = 'https://cdn.robertsspaceindustries.com/scripts/cart-widget.js';
const read = { method: 'GET', resourceType: 'script' };

test('Only the two wire forms of the sign-in image challenge can reach the exact GraphQL endpoint', () => {
  const url = 'https://robertsspaceindustries.com/graphql';
  for (const body of [persistedImageBody, fallbackImageBody]) {
    const request = { url, method: 'POST', resourceType: 'xhr', uploadData: [{ bytes: Buffer.from(body) }] };
    assert.equal(evaluateRsiSessionRequest(request, 'login').blocked, false);
    assert.equal(evaluateRsiSessionRequest({ ...request, uploadData: [{ type: 'rawData', bytes: Buffer.from(body) }] }, 'login').blocked, false);
    for (const phase of ['captcha', 'read', 'closed'] as const) assert.equal(evaluateRsiSessionRequest(request, phase).blocked, true);
    for (const method of ['GET', 'HEAD', 'PUT', 'OPTIONS', 'PATCH', 'DELETE']) {
      assert.equal(evaluateRsiSessionRequest({ ...request, method }, 'login').blocked, true);
    }
    for (const resourceType of ['mainFrame', 'subFrame', 'other', 'image', 'script']) {
      assert.equal(evaluateRsiSessionRequest({ ...request, resourceType }, 'login').blocked, true);
    }
    for (const other of [url + '?', url + '?a=1', url + '#', url + '#other', url + '/', url.replace('https:', 'http:'),
      url.replace('://', '://cdn.'), url.replace('://', '://user@'), url.replace('.com/', '.com:443/'),
      url.replace('/graphql', '/foo/../graphql'), url.replace('/graphql', '/%67raphql')]) {
      assert.equal(evaluateRsiSessionRequest({ ...request, url: other }, 'login').blocked, true);
    }
  }
});

test('The sign-in image exception rejects altered operations and ambiguous uploads', () => {
  const request = { url: 'https://robertsspaceindustries.com/graphql', method: 'POST', resourceType: 'xhr' };
  const upload = (bytes: Buffer) => [{ bytes }];
  const batch = (operation: unknown) => JSON.stringify([operation]);
  const invalidBodies = [
    JSON.stringify(imageOperation), JSON.stringify([imageOperation, imageOperation]),
    batch({ ...imageOperation, query: 'mutation { checkout }' }),
    batch({ ...imageOperation, query: imageQuery.replace('encoding', 'otherField') }),
    batch({ operationName: 'captcha', variables: imageOperation.variables, query: imageQuery }),
    batch({ ...imageOperation, operationName: 'other' }),
    ...['signup', 'checkout'].map(action => batch({ ...imageOperation, variables: { size: 'm', action } })),
    batch({ ...imageOperation, variables: { size: 'l', action: 'signin' } }),
    batch({ ...imageOperation, variables: { ...imageOperation.variables, password: 'synthetic' } }),
    batch({ ...imageOperation, extensions: { ...imageOperation.extensions, extra: true } }),
    batch({ ...imageOperation, extensions: { persistedQuery: { ...imageOperation.extensions.persistedQuery, version: 2 } } }),
    persistedImageBody.replace(imageOperation.extensions.persistedQuery.sha256Hash, '0'.repeat(64)),
    persistedImageBody.replace('"action":"signin"', '"action":"checkout","action":"signin"'),
    fallbackImageBody.replace('"query":', '"query":"mutation { gift }","query":'),
    persistedImageBody + ' ', '[]', 'invalid',
  ];
  for (const body of invalidBodies) {
    assert.equal(evaluateRsiSessionRequest({ ...request, uploadData: upload(Buffer.from(body)) }, 'login').blocked, true);
  }
  const bytes = Buffer.from(persistedImageBody);
  for (const uploadData of [undefined, [], [null], [bytes], [{ bytes: persistedImageBody }], [{ bytes: new Uint8Array(bytes) }],
    [{ file: 'fixture' }], [{ blobUUID: 'fixture' }], [{ bytes, file: 'fixture' }], [{ bytes, blobUUID: 'fixture' }],
    [{ type: 'file', bytes }], [{ type: 'rawData', bytes, file: 'fixture' }], [{ type: 'rawData', bytes, blobUUID: 'fixture' }],
    [...upload(bytes), ...upload(bytes)], upload(Buffer.alloc(65536))]) {
    assert.equal(evaluateRsiSessionRequest({ ...request, uploadData }, 'login').blocked, true);
  }
});

test('The official sign-in confirmation is allowed only from the login document with an image code', () => {
  const url = 'https://robertsspaceindustries.com/graphql';
  const variables = { email: 'example@example.invalid', password: 'synthetic \"ä\"', captcha_code: '1234' };
  const minimumBody = JSON.stringify([{ ...confirmationOperation, variables }]);
  for (const body of [persistedConfirmationBody, fallbackConfirmationBody, minimumBody]) {
    const request = { url, method: 'POST', resourceType: 'xhr', uploadData: [{ type: 'rawData', bytes: Buffer.from(body) }] };
    assert.equal(evaluateRsiSessionRequest(request, 'login').blocked, false);
    for (const phase of ['captcha', 'read', 'closed'] as const) {
      assert.equal(evaluateRsiSessionRequest(request, phase).blocked, true);
    }
    assert.equal(evaluateRsiSessionRequest({ ...request, method: 'PUT' }, 'login').blocked, true);
    assert.equal(evaluateRsiSessionRequest({ ...request, resourceType: 'subFrame' }, 'login').blocked, true);
    for (const other of [url + '?opt=1', url + '#', url + '/', url.replace('https:', 'http:'),
      url.replace('://', '://cdn.'), url.replace('/graphql', '/api/checkout')]) {
      assert.equal(evaluateRsiSessionRequest({ ...request, url: other }, 'login').blocked, true);
    }
  }
});

test('The sign-in confirmation cannot carry other operations or ambiguous JSON', () => {
  const operation = confirmationOperation;
  const variables = operation.variables;
  const request = { url: 'https://robertsspaceindustries.com/graphql', method: 'POST', resourceType: 'xhr' };
  const batch = (change: object) => JSON.stringify([{ ...operation, ...change }]);
  const rejected = [
    JSON.stringify(operation), JSON.stringify([operation, imageOperation]),
    batch({ operationName: 'account_signup' }),
    batch({ variables: { ...variables, captcha_code: undefined, captchaToken: 'synthetic' } }),
    ...['email', 'password', 'captcha_code'].flatMap(key => [undefined, null, '', true, {}]
      .map(value => batch({ variables: { ...variables, [key]: value } }))),
    batch({ variables: { ...variables, captchaToken: 'synthetic' } }),
    batch({ variables: { ...variables, mark: { extra: 1 } } }),
    batch({ variables: { ...variables, remember: 1 } }),
    batch({ variables: { ...variables, password: 'x'.repeat(16384) } }),
    batch({ query: confirmationQuery + ' mutation checkout { order }' }),
    batch({ query: confirmationQuery, extensions: undefined }),
    batch({ client: {} }),
    batch({ extensions: { persistedQuery: { version: 1, sha256Hash: 'a'.repeat(64) } } }),
    batch({ extensions: { persistedQuery: { ...operation.extensions.persistedQuery, extra: true } } }),
    batch({ extensions: { ...operation.extensions, extra: true } }),
    persistedConfirmationBody.replace('"email":', '"captcha_code":"other","email":'),
    persistedConfirmationBody.replace('"version":1', '"version":0,"version":1'),
    fallbackConfirmationBody.replace('"query":', '"query":"mutation { checkout }","query":'),
    persistedConfirmationBody.replace('{"operationName":', '{"operationName":"checkout","operationName":'),
    persistedConfirmationBody + ' ',
  ];
  for (const body of rejected) {
    assert.equal(evaluateRsiSessionRequest({ ...request, uploadData: [{ bytes: Buffer.from(body) }] }, 'login').blocked, true);
  }
  const bytes = Buffer.from(persistedConfirmationBody);
  const invalidUtf8 = Buffer.from(bytes);
  invalidUtf8[invalidUtf8.indexOf('local-confirmation')] = 0xff;
  for (const uploadData of [[{ bytes, file: 'fixture' }], [{ type: 'file', bytes }],
    [{ type: 'rawData', bytes, blobUUID: 'fixture' }], [{ bytes }, { bytes }], [{ bytes: invalidUtf8 }]]) {
    assert.equal(evaluateRsiSessionRequest({ ...request, uploadData }, 'login').blocked, true);
  }
});

test('The official E-mail code operation is restricted to its exact authentication context', () => {
  const url = 'https://robertsspaceindustries.com/graphql';
  const bodyFor = (duration: string) => JSON.stringify([{ ...emailCodeOperation,
    variables: { ...emailCodeOperation.variables, duration } }]);
  for (const body of [persistedEmailCodeBody, fallbackEmailCodeBody, ...['day', 'week', 'month', 'year'].map(bodyFor)]) {
    const request = { url, method: 'POST', resourceType: 'xhr', uploadData: [{ type: 'rawData', bytes: Buffer.from(body) }] };
    assert.equal(evaluateRsiSessionRequest(request, 'login').blocked, false);
    for (const phase of ['captcha', 'read', 'closed'] as const) {
      assert.equal(evaluateRsiSessionRequest(request, phase).blocked, true);
    }
    for (const other of [url + '/', url + '?', url + '#', url.replace('https:', 'http:'),
      url.replace('://', '://cdn.'), url.replace('/graphql', '/api/checkout')]) {
      assert.equal(evaluateRsiSessionRequest({ ...request, url: other }, 'login').blocked, true);
    }
    for (const method of ['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE']) {
      assert.equal(evaluateRsiSessionRequest({ ...request, method }, 'login').blocked, true);
    }
    for (const resourceType of ['mainFrame', 'subFrame', 'script', 'other']) {
      assert.equal(evaluateRsiSessionRequest({ ...request, resourceType }, 'login').blocked, true);
    }
  }
});

test('E-mail code submission rejects mixed operations, altered documents and out-of-form values', () => {
  const request = { url: 'https://robertsspaceindustries.com/graphql', method: 'POST', resourceType: 'xhr' };
  const op = emailCodeOperation;
  const batch = (change: object) => JSON.stringify([{ ...op, ...change }]);
  const variables = (change: object) => batch({ variables: { ...op.variables, ...change } });
  const bodies = [
    JSON.stringify(op), JSON.stringify([op, confirmationOperation]), JSON.stringify([op, op]),
    batch({ operationName: 'account_recovery' }), batch({ query: emailCodeQuery.replace('account_multistep', 'account_recovery') }),
    batch({ query: emailCodeQuery + ' mutation checkout { order }' }), batch({ query: emailCodeQuery, extensions: undefined }),
    batch({ extensions: confirmationOperation.extensions }), batch({ trace: true }),
    variables({ code: undefined }), variables({ code: 'short' }), variables({ code: 'x'.repeat(9) }), variables({ code: 111111 }),
    variables({ deviceName: 'x' }), variables({ deviceName: 'x'.repeat(65) }), variables({ deviceType: 'phone' }),
    variables({ duration: 'permanent' }), variables({ duration: { value: 'session' } }), variables({ password: 'synthetic' }),
    variables({ deviceName: undefined, other: 'synthetic' }),
    persistedEmailCodeBody.replace('"duration":', '"duration":"year","duration":'),
    fallbackEmailCodeBody.replace('"query":', '"query":"mutation { checkout }","query":'),
    persistedEmailCodeBody + ' ',
  ];
  for (const body of bodies) {
    assert.equal(evaluateRsiSessionRequest({ ...request, uploadData: [{ bytes: Buffer.from(body) }] }, 'login').blocked, true);
  }
  const bytes = Buffer.from(persistedEmailCodeBody);
  for (const uploadData of [[{ bytes, file: 'fixture' }], [{ type: 'blob', bytes }],
    [{ type: 'rawData', bytes, blobUUID: 'fixture' }], [{ bytes }, { bytes }]]) {
    assert.equal(evaluateRsiSessionRequest({ ...request, uploadData }, 'login').blocked, true);
  }
});

test('Only the two exact official password eye assets can load as bodyless images during login', () => {
  for (const url of passwordEyeUrls) {
    const request = { url, method: 'GET', resourceType: 'image' };
    assert.equal(evaluateRsiSessionRequest(request, 'login').blocked, false);
    assert.equal(evaluateRsiSessionRequest({ ...request, method: 'HEAD' }, 'login').blocked, false);
    for (const phase of ['captcha', 'read', 'closed'] as const) {
      assert.equal(evaluateRsiSessionRequest(request, phase).blocked, true);
    }
    for (const other of [url + '?v=1', url + '#', url.replace('cdn.', 'static.'),
      url.replace('https:', 'http:'), url.replace(/-[a-z0-9]+\.svg$/, '-123.svg')]) {
      assert.equal(evaluateRsiSessionRequest({ ...request, url: other }, 'login').blocked, true);
    }
    assert.equal(evaluateRsiSessionRequest({ ...request, method: 'POST' }, 'login').blocked, true);
    assert.equal(evaluateRsiSessionRequest({ ...request, resourceType: 'script' }, 'login').blocked, true);
    assert.equal(evaluateRsiSessionRequest({ ...request, uploadData: [{ bytes: Buffer.from('synthetic') }] }, 'login').blocked, true);
  }
});

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

test('Only the RSI login document can read the exact observed consent-script query', () => {
  const script = 'https://robertsspaceindustries.com/cookie-consent/script.js';
  const cookiebot = 'https://consent.cookiebot.com/uc.js';
  const url = script + '?async=1';
  for (const method of ['GET', 'HEAD']) {
    const request = { ...read, url, method };
    assert.equal(evaluateRsiSessionRequest(request, 'login').blocked, false);
    for (const phase of ['read', 'captcha', 'closed'] as const) assert.equal(evaluateRsiSessionRequest(request, phase).blocked, true);
    assert.equal(evaluateRsiSessionRequest({ ...request, uploadData: [{}] }, 'login').blocked, true);
  }
  for (const phase of ['read', 'captcha', 'login'] as const) {
    for (const url of [script, cookiebot]) assert.equal(evaluateRsiSessionRequest({ ...read, url }, phase).blocked, false);
  }
  for (const other of [cookiebot + '?async=1', script + '?async', script + '?async=', script + '?async=0',
    script + '?async=%31', script + '?async=1&async=1', script + '?async=1&extra=1', url + '#x',
    url.replace('https:', 'http:'), url.replace('https://', 'https://user@'), url.replace('.com/', '.com:8443/'),
    url.replace('://', '://cdn.'), url.replace('script.js', 'other.js')]) {
    assert.equal(evaluateRsiSessionRequest({ ...read, url: other }, 'login').blocked, true, other);
  }
  for (const method of ['OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE']) assert.equal(evaluateRsiSessionRequest({ ...read, url, method }, 'login').blocked, true, method);
  for (const resourceType of ['xhr', 'mainFrame', 'subFrame', 'stylesheet', 'other']) assert.equal(evaluateRsiSessionRequest({ ...read, url, resourceType }, 'login').blocked, true, resourceType);
});

test('Only the login document may read the English navigation manifest and versioned main menu', () => {
  const origin = 'https://static.robertsspaceindustries.com';
  const directory = origin + '/nav/en/';
  const main = 'main.12imzqx676lkw-1772208661.json';
  const xhr = { method: 'GET', resourceType: 'xhr' };
  for (const name of ['manifest.json', main, 'main.abc123def456g-1790000000.json']) {
    const url = directory + name;
    for (const method of ['GET', 'HEAD']) {
      const request = { ...xhr, method, url };
      assert.equal(evaluateRsiSessionRequest(request, 'login').blocked, false, url);
      for (const phase of ['read', 'captcha', 'closed'] as const) {
        assert.equal(evaluateRsiSessionRequest(request, phase).blocked, true, phase);
      }
      assert.equal(evaluateRsiSessionRequest({ ...request, uploadData: [{}] }, 'login').blocked, true);
    }
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      assert.equal(evaluateRsiSessionRequest({ ...xhr, method, url }, 'login').blocked, true, method);
    }
    for (const resourceType of ['script', 'mainFrame', 'subFrame', 'other', 'image']) {
      assert.equal(evaluateRsiSessionRequest({ ...xhr, resourceType, url }, 'login').blocked, true, resourceType);
    }
    for (const other of [url + '?v=1', url + '?', url + '#x', url + '#', url.replace('https:', 'http:'),
      url.replace('static.', 'cdn.'), url.replace('.com/', '.com:8443/'), url.replace('://', '://user@'),
      url.replace('/en/', '/de/'), url.replace('/en/', '/other/../en/'), url.replace('/en/', '/en%2f')]) {
      assert.equal(evaluateRsiSessionRequest({ ...xhr, url: other }, 'login').blocked, true, other);
    }
  }
  for (const name of ['shop.12imzqx676lkw-1772208661.json', 'main.json', 'main.short-1772208661.json',
    'main.12imzqx676lkw-177220866.json', main + '.js', 'store/' + main]) {
    assert.equal(evaluateRsiSessionRequest({ ...xhr, url: directory + name }, 'login').blocked, true, name);
  }
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
