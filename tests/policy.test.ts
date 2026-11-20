import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowedRsiNavigation, blockedOperation, isPledgesPage, isRsiLoginPage, rsiReturnCandidate } from '../src/main/policy';
import { commandSchema } from '../src/main/commands';
test('Hintergrund-Bridge erlaubt nur Profilaktionen und feste Revisionen, keine Authwerte oder freien Ziele', () => {
  const accountId = '56cb1f0c-fb2c-428f-9f85-bc350fd5ae2e';
  for (const action of ['rsi.background', 'rsi.refresh', 'account.select']) {
    assert.equal(commandSchema.safeParse({ action, accountId }).success, true);
    for (const extra of [{ url: 'https://example.invalid/' }, { password: 'SYNTHETIC' }, { token: 'SYNTHETIC' }, { script: 'SYNTHETIC' }]) {
      assert.equal(commandSchema.safeParse({ action, accountId, ...extra }).success, false);
    }
  }
  assert.equal(commandSchema.safeParse({ action: 'rsi.background', accountId, knownRevision: accountId }).success, true);
  assert.equal(commandSchema.safeParse({ action: 'rsi.background', accountId, knownRevision: '../foreign' }).success, false);
  assert.equal(commandSchema.safeParse({ action: 'rsi.authorize', accountId, remember: true }).success, true);
  assert.equal(commandSchema.safeParse({ action: 'rsi.authorize', accountId, remember: true, url: 'https://example.invalid/' }).success, false);
});
test('RSI-Navigation: nur geprüfte HTTPS-Ursprünge und Login/Hangar, keine Kaufpfade', () => {
  for (const s of ['https://robertsspaceindustries.com/', 'https://robertsspaceindustries.com/en/', 'https://robertsspaceindustries.com/connect', 'https://robertsspaceindustries.com/en/connect', 'https://robertsspaceindustries.com/account/pledges?page=2']) assert.ok(allowedRsiNavigation(s));
  for (const s of ['http://robertsspaceindustries.com/account', 'https://robertsspaceindustries.com.evil.test/account', 'javascript:evil()', 'file:///C:/test', 'https://robertsspaceindustries.com/pledge', 'https://robertsspaceindustries.com/account/buy-back-pledges', 'https://user:pass@robertsspaceindustries.com/account']) assert.equal(allowedRsiNavigation(s), false);
  assert.equal(isPledgesPage('https://robertsspaceindustries.com/en/account/pledges'), true);
  assert.equal(isPledgesPage('https://evil.test/account/pledges'), false);
  for (const s of ['checkout', 'apply-upgrade', 'reclaim', 'gift', 'buyback', 'cart']) assert.ok(blockedOperation('https://robertsspaceindustries.com/api/' + s));
});
test('Bridge: keine beliebigen Pfade, URLs, SQL oder JavaScript; Schema und Konto-UUID prüfen', () => {
  for (const value of [ { action: 'file.read', path: 'C:/test' }, { action: 'rsi.open', accountId: '../secret' },
    { action: 'state', sql: 'DROP TABLE items' }, { action: 'rsi.open', accountId: '56cb1f0c-fb2c-428f-9f85-bc350fd5ae2e', url: 'https://evil.test' },
    { action: 'import.commit', accountId: '56cb1f0c-fb2c-428f-9f85-bc350fd5ae2e', token: '56cb1f0c-fb2c-428f-9f85-bc350fd5ae2e', bindingConfirmed: true, reviewed: false } ]) assert.equal(commandSchema.safeParse(value).success, false);
});
test('Regionale Sprachpfade bleiben auf genaue Login-/Hangarrouten begrenzt', () => {
  for (const locale of ['en-US', 'de-DE', 'fr-fr']) {
    const base = 'https://robertsspaceindustries.com/' + locale;
    assert.equal(allowedRsiNavigation(base + '/connect'), true); assert.equal(isRsiLoginPage(base + '/connect'), true);
    assert.equal(allowedRsiNavigation(base + '/account/pledges?page=2'), true); assert.equal(isPledgesPage(base + '/account/pledges?page=2'), true);
    assert.equal(allowedRsiNavigation(base + '/account/gift'), false); assert.equal(isPledgesPage(base + '/account/gift'), false);
  }
  assert.equal(isPledgesPage('https://user:pass@robertsspaceindustries.com/account/pledges'), false);
});
test('Hangarrueckkehrsignal erweitert keine Ziel-Freigabe und ueberspringt keine Auth-/Aktionspfade', () => {
  const candidate = 'https://robertsspaceindustries.com/synthetic-return?token=SYNTHETIC_ONLY';
  assert.equal(rsiReturnCandidate(candidate), true); assert.equal(allowedRsiNavigation(candidate), false);
  for (const url of ['https://example.invalid/synthetic-return', 'http://robertsspaceindustries.com/synthetic-return',
    'https://robertsspaceindustries.com:8443/synthetic-return', 'https://user:pass@robertsspaceindustries.com/synthetic-return',
    'https://robertsspaceindustries.com/api/cart', 'https://robertsspaceindustries.com/%67ift',
    'https://robertsspaceindustries.com/connect/mfa', 'https://robertsspaceindustries.com/account/security',
    'https://robertsspaceindustries.com/en-US/reset-password', 'javascript:alert(1)', 'invalid']) assert.equal(rsiReturnCandidate(url), false, url);
});

test('RSI sign-in und bestaetigter Code-Schritt bleiben Anmeldeseiten ohne vorzeitige Hangarrueckkehr', () => {
  for (const locale of ['', 'en/', 'en-US/', 'de-DE/']) for (const route of ['sign-in', 'sign-in/', 'sign-in/send-confirmation-code']) {
    const url = 'https://robertsspaceindustries.com/' + locale + route;
    assert.equal(allowedRsiNavigation(url), true, url);
    assert.equal(isRsiLoginPage(url), true, url);
    assert.equal(rsiReturnCandidate(url), false, url);
    assert.equal(isPledgesPage(url), false, url);
  }
});

test('Authentifizierungsfreigabe umfasst keine Wiederherstellung, Registrierung, Kontowechsel oder beliebigen Unterrouten', () => {
  for (const route of ['sign-in/forgot-password', 'sign-in/send-confirmation-code/extra', 'sign-in/checkout',
    'sign-in/%2fcart', 'connect/mfa', 'account/recover', 'account/security', 'account/settings', 'enlist', 'enlist/change-email', 'oauth/device']) {
    const url = 'https://robertsspaceindustries.com/en/' + route;
    assert.equal(allowedRsiNavigation(url), false, url); assert.equal(isRsiLoginPage(url), false, url);
  }
  for (const url of ['http://robertsspaceindustries.com/sign-in', 'https://robertsspaceindustries.com.evil.test/sign-in',
    'https://user:pass@robertsspaceindustries.com/sign-in', 'https://robertsspaceindustries.com:8443/sign-in']) {
    assert.equal(allowedRsiNavigation(url), false); assert.equal(isRsiLoginPage(url), false);
  }
});
