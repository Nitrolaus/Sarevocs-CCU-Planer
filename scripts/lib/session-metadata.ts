import { z } from 'zod';
import { officialCookie } from '../../src/security/session-vault';
// Format v1 is deliberately fixed. Unknown formats fail closed, never print parsing details.
const capsule = z.object({ schemaVersion: z.literal(1), accountId: z.uuid(),
  issuer: z.literal('https://robertsspaceindustries.com'), cookies: z.array(z.object({
    name: z.string().min(1).max(1024), value: z.string().max(65536), domain: z.string().max(255), path: z.string().max(2048),
    secure: z.literal(true), httpOnly: z.boolean(), hostOnly: z.boolean(), session: z.boolean(),
    expirationDate: z.number().finite().optional(), sameSite: z.enum(['unspecified', 'no_restriction', 'lax', 'strict']),
  })).max(500) }).strict();
const names = new Set(['Rsi-Token', 'Rsi-Access-Token', 'Rsi-Refresh-Token']);
const protectionNames = new Set(['__cf_bm', '_cfuvid', 'cf_clearance']);
export function capsuleMetadata(input: unknown, expectedAccountId: string, now = Date.now() / 1000) {
  const parsed = capsule.safeParse(input);
  const result = { readable: false, cookieCount: 0, activeKnownAuthCookies: 0, expiredKnownAuthCookies: 0, mfaDeviceCookiePresent: false,
    consentCookies: 0, protectionCookies: 0, otherCookies: 0 };
  if (!parsed.success || parsed.data.accountId !== expectedAccountId) return result;
  result.readable = true;
  for (const c of parsed.data.cookies) {
    if (!officialCookie({ ...c, expirationDate: undefined })) continue;
    result.cookieCount++;
    if (c.name === 'CookieConsent') result.consentCookies++;
    else if (protectionNames.has(c.name)) result.protectionCookies++;
    else if (!names.has(c.name) && c.name !== '_rsi_device') result.otherCookies++;
    const expired = c.expirationDate !== undefined && c.expirationDate <= now;
    if (names.has(c.name) && c.value.length > 0) {
      if (expired) result.expiredKnownAuthCookies++; else result.activeKnownAuthCookies++;
    }
    if (c.name === '_rsi_device' && c.value.length > 0 && !expired) result.mfaDeviceCookiePresent = true;
  }
  return result;
}
