import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureRsiCookie, hasAuthenticationCookie, officialCookie } from '../src/security/rsi-cookies';
import { insecureRsiTransport } from '../src/main/policy';
const base = { name: 'Rsi-Token', value: 'SYNTHETIC_ONLY', domain: '.robertsspaceindustries.com', path: '/account',
  secure: false, httpOnly: true, hostOnly: false, session: false, sameSite: 'strict' as const, expirationDate: Date.now() / 1000 + 3600 };
test('HTTPS-Cookie ohne Secure wird vollstaendig fuer HTTPS-Wiederherstellung uebernommen', () => {
  const saved = captureRsiCookie(base);
  assert.deepEqual(saved, { ...base, secure: true }); assert.equal(base.secure, false);
  assert.equal(officialCookie(saved!), true); assert.equal(hasAuthenticationCookie([saved!]), true);
});
test('Fremddomain, Ablauf und ungueltige Cookieattribute bleiben gesperrt', () => {
  for (const input of [{ ...base, domain: 'robertsspaceindustries.com.evil.test' }, { ...base, expirationDate: 1 },
    { ...base, path: '/\r\n' }, { ...base, expirationDate: Infinity }, { ...base, domain: undefined }]) assert.equal(captureRsiCookie(input), null);
});
test('Zustimmung und Geraetemerker zaehlen nicht als Anmeldung', () => {
  const saved = { ...base, secure: true };
  for (const c of [{ ...saved, name: 'CookieConsent' }, { ...saved, name: '_rsi_device' }, { ...saved, value: '' }, { ...saved, expirationDate: 1 }]) assert.equal(hasAuthenticationCookie([c]), false);
  assert.equal(hasAuthenticationCookie([{ ...saved, name: 'Rsi-Refresh-Token' }]), true);
});
test('Unverschluesselte HTTP- und WebSocket-Anfragen sind gesperrt', () => {
  for (const url of ['http://robertsspaceindustries.com/', 'ws://robertsspaceindustries.com/', 'invalid']) assert.equal(insecureRsiTransport(url), true);
  for (const url of ['https://robertsspaceindustries.com/', 'wss://robertsspaceindustries.com/']) assert.equal(insecureRsiTransport(url), false);
});
