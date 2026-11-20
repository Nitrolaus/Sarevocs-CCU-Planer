import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capsuleMetadata } from '../scripts/lib/session-metadata';
const id = 'b5a061d3-28ca-4c8b-bb89-3f79106e6e5d';
const secret = 'SYNTHETIC_SECRET_MUST_NEVER_LEAVE_METADATA';
const cookie = (name: string, extra = {}) => ({ name, value: secret, domain: 'robertsspaceindustries.com', path: '/',
  secure: true, httpOnly: true, hostOnly: true, session: true, sameSite: 'lax', ...extra });
const file = (cookies: unknown[]) => ({ schemaVersion: 1, accountId: id, issuer: 'https://robertsspaceindustries.com', cookies });
function privacy(result: ReturnType<typeof capsuleMetadata>) {
  const text = JSON.stringify(result);
  for (const prohibited of [secret, id, 'Rsi-Token', 'robertsspaceindustries.com']) assert.equal(text.includes(prohibited), false);
  assert.deepEqual(Object.keys(result).sort(), ['readable', 'cookieCount', 'activeKnownAuthCookies', 'expiredKnownAuthCookies', 'mfaDeviceCookiePresent', 'consentCookies', 'protectionCookies', 'otherCookies'].sort());
}
test('Nur Geraete-Cookie ist keine nachgewiesene gespeicherte Anmeldung', () => {
  const r = capsuleMetadata(file([cookie('_rsi_device')]), id, 1000);
  assert.equal(r.readable, true); assert.equal(r.cookieCount, 1); assert.equal(r.mfaDeviceCookiePresent, true); assert.equal(r.activeKnownAuthCookies, 0); privacy(r);
});
test('Bekannte Anmeldetokens werden nur als lokal vorhanden gezaehlt, ohne Werte', () => {
  const r = capsuleMetadata(file([cookie('Rsi-Token'), cookie('Rsi-Refresh-Token')]), id, 1000);
  assert.equal(r.activeKnownAuthCookies, 2); assert.equal(r.expiredKnownAuthCookies, 0); privacy(r);
});
test('Lokal abgelaufene Tokens werden von noch vorhandenen getrennt', () => {
  const r = capsuleMetadata(file([cookie('Rsi-Token', { expirationDate: 999 }), cookie('Rsi-Access-Token', { expirationDate: 2000 })]), id, 1000);
  assert.equal(r.activeKnownAuthCookies, 1); assert.equal(r.expiredKnownAuthCookies, 1); privacy(r);
});
test('Falsches Format oder Profil wird ohne Inhalts-/Fehlerdetails abgewiesen', () => {
  for (const data of [{ ...file([]), accountId: secret }, { ...file([]), schemaVersion: 99 }, { password: secret }]) {
    const r = capsuleMetadata(data, id); assert.equal(r.readable, false); privacy(r);
  }
});
test('Fremde Domains, leere Tokens und beliebige Namen erzeugen keinen Anmeldenachweis', () => {
  const r = capsuleMetadata(file([cookie('Rsi-Token', { value: '' }), cookie('Rsi-Token', { domain: 'example.test' }), cookie(secret)]), id, 1000);
  assert.equal(r.activeKnownAuthCookies, 0); assert.equal(r.cookieCount, 2); privacy(r);
});
test('Website-Zustimmung und Zugriffsschutz werden nur als Kategorien gezaehlt', () => {
  const r = capsuleMetadata(file([cookie('CookieConsent'), cookie('__cf_bm'), cookie(secret)]), id, 1000);
  assert.equal(r.consentCookies, 1); assert.equal(r.protectionCookies, 1); assert.equal(r.otherCookies, 1);
  assert.equal(r.activeKnownAuthCookies, 0); privacy(r);
});
