import { z } from 'zod';
import { createHmac, randomBytes } from 'node:crypto';
export const cookieSchema = z.object({ name: z.string().min(1).max(1024), value: z.string().max(65536),
  domain: z.string().max(255), path: z.string().max(2048), secure: z.literal(true), httpOnly: z.boolean(),
  hostOnly: z.boolean(), session: z.boolean(), expirationDate: z.number().finite().optional(),
  sameSite: z.enum(['unspecified', 'no_restriction', 'lax', 'strict']) });
export type StoredCookie = z.infer<typeof cookieSchema>;
export type CookieInput = { name: string; value: string; domain?: string; path?: string; secure?: boolean;
  httpOnly?: boolean; hostOnly?: boolean; session?: boolean; expirationDate?: number; sameSite?: StoredCookie['sameSite'] };
const authenticationNames = new Set(['Rsi-Token', 'Rsi-Access-Token', 'Rsi-Refresh-Token']);
export function isAuthenticationCookieName(name: string) { return authenticationNames.has(name); }
export function officialCookie(cookie: { domain?: string; secure?: boolean; path?: string; expirationDate?: number }) {
  if (typeof cookie.domain !== 'string' || typeof cookie.path !== 'string') return false;
  const domain = cookie.domain.replace(/^\./, '');
  return cookie.secure === true && (domain === 'robertsspaceindustries.com' || domain.endsWith('.robertsspaceindustries.com')) &&
    cookie.path.startsWith('/') && !/[\r\n]/.test(cookie.path) && (cookie.expirationDate === undefined || cookie.expirationDate > Date.now() / 1000);
}
export function captureRsiCookie(cookie: CookieInput): StoredCookie | null {
  // First-party cookies received over HTTPS may omit Secure. Persist only their HTTPS-only form.
  const parsed = cookieSchema.safeParse({ ...cookie, secure: true, httpOnly: cookie.httpOnly ?? false,
    hostOnly: cookie.hostOnly ?? false, session: cookie.session ?? cookie.expirationDate === undefined,
    sameSite: cookie.sameSite ?? 'unspecified' });
  return parsed.success && officialCookie(parsed.data) ? parsed.data : null;
}
export function hasAuthenticationCookie(cookies: readonly CookieInput[]) {
  return cookies.some(c => officialCookie(c) && isAuthenticationCookieName(c.name) && c.value.length > 0);
}

const processKey = randomBytes(32);
/** Ephemeral comparison of the authentication values and their scope, never a stored identity. */
export function purchaseSessionProof(cookies: readonly StoredCookie[]): string | undefined {
  const auth = cookies.filter(cookie => isAuthenticationCookieName(cookie.name));
  if (!auth.length || auth.some(cookie => !officialCookie(cookie) || !cookie.value)) return;
  const scoped = auth.map(c => JSON.stringify([c.name, c.domain, c.hostOnly, c.path, c.value])).sort();
  return createHmac('sha256', processKey).update(JSON.stringify(scoped)).digest('hex');
}
export async function activePurchaseSessionProof(session: Electron.Session): Promise<string | undefined> {
  const cookies = (await session.cookies.get({})).map(captureRsiCookie).filter(cookie => cookie !== null);
  return purchaseSessionProof(cookies);
}
