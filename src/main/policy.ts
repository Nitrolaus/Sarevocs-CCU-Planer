export const RSI_ORIGIN = 'https://robertsspaceindustries.com';
export const RSI_HANGAR_URL = RSI_ORIGIN + '/account/pledges';
// Current RSI sign-in and TWO_FA share sign-in; confirmation-code is a separate exact step.
// Recovery, registration, account settings and arbitrary authentication subroutes stay excluded.
const rsiLoginPath = /^\/(?:[a-z]{2}(?:-[A-Za-z]{2})?\/)?(?:connect|sign-in(?:\/send-confirmation-code)?)\/?$/;
export function insecureRsiTransport(value: string): boolean {
  try { return ['http:', 'ws:'].includes(new URL(value).protocol); } catch { return true; }
}
export function allowedRsiNavigation(value: string): boolean {
  try {
    const u = new URL(value);
    return u.origin === RSI_ORIGIN && !u.username && !u.password &&
      (rsiLoginPath.test(u.pathname) || /^\/(?:[a-z]{2}(?:-[A-Za-z]{2})?\/?)?$/.test(u.pathname) || /^\/(?:[a-z]{2}(?:-[A-Za-z]{2})?\/)?(?:account\/?|account\/pledges\/?)$/.test(u.pathname));
  } catch { return false; }
}
export function isPledgesPage(value: string): boolean {
  try { const u = new URL(value); return u.origin === RSI_ORIGIN && !u.username && !u.password && /^\/(?:[a-z]{2}(?:-[A-Za-z]{2})?\/)?account\/pledges\/?$/.test(u.pathname); }
  catch { return false; }
}
export function isRsiLoginPage(value: string): boolean {
  try { const u = new URL(value); return u.origin === RSI_ORIGIN && !u.username && !u.password && rsiLoginPath.test(u.pathname); }
  catch { return false; }
}
export function rsiReturnCandidate(value: string): boolean {
  try {
    const u = new URL(value), pathname = canonicalPath(u.pathname);
    if (u.origin !== RSI_ORIGIN || u.username || u.password || pathname === null || blockedOperation(value)) return false;
    // This is only a signal to load the fixed hangar after checking auth-cookie presence.
    // The unapproved target is never opened/read by the planner; auth/MFA paths are not skipped.
    return !/(?:^|\/)(?:connect|login|signin|sign-in|auth|authenticate|mfa|2fa|two-factor|password|reset-password|security|register|signup)(?:\/|$)/i.test(pathname);
  } catch { return false; }
}
type RequestContext = { method: string; resourceType: string };
export const OPERATION_BLOCK_DETAILS = ['invalid-url-or-path', 'request-context-missing', 'api-or-action-path',
  'non-read-method', 'unsupported-resource', 'untrusted-asset-origin', 'ambiguous-asset-encoding',
  'unknown-static-root', 'unsupported-file-name', 'query-limits', 'unsupported-query-key', 'unsupported-query-value',
  'session-closed', 'navigation-not-allowed'] as const;
export type OperationBlockDetail = typeof OPERATION_BLOCK_DETAILS[number];
export type OperationDecision = { blocked: false } | { blocked: true; detail: OperationBlockDetail };
const operationWords = /(?:checkout|reclaim|apply[-_/]?upgrade|gift|buyback|buy-back|cart|payment)/i;
const actionOrApiSegment = /^(?:api|graphql|rpc|ajax|store|account|pledges?|checkout|reclaim|gift|buyback|buy-back(?:-pledges)?|cart|payments?|apply[-_]?upgrade)$/i;
function canonicalPath(pathname: string): string | null {
  if (pathname.length > 4096) return null;
  let decoded = pathname;
  // Interpret encoded separators/actions conservatively, including bounded nested encoding.
  for (let i = 0; i < 4 && decoded.includes('%'); i++) decoded = decodeURIComponent(decoded);
  if (decoded.includes('%') || /[\u0000-\u001f\u007f]/.test(decoded)) return null;
  const parts: string[] = [];
  for (const part of decoded.replaceAll('\\', '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop(); else parts.push(part);
  }
  return '/' + parts.join('/');
}
function staticReadExclusion(url: URL, pathname: string, request: RequestContext): OperationBlockDetail | null {
  const parts = pathname.split('/').filter(Boolean);
  // All conditions are unchanged. Report the specific API/action condition before generic asset-root exclusion.
  if (parts.some(part => actionOrApiSegment.test(part))) return 'api-or-action-path';
  if (!['GET', 'HEAD'].includes(request.method)) return 'non-read-method';
  if (!['script', 'stylesheet', 'image', 'font', 'media', 'xhr', 'other'].includes(request.resourceType)) return 'unsupported-resource';
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
    !(url.hostname === 'robertsspaceindustries.com' || url.hostname.endsWith('.robertsspaceindustries.com'))) return 'untrusted-asset-origin';
  // Do not grant an exception through ambiguous separators or nested escaping.
  if (/%(?:2f|5c|25)/i.test(url.pathname)) return 'ambiguous-asset-encoding';
  // Neither a filename suffix alone nor a CDN hostname exempts an API/action path.
  if (!/^\/(?:assets|static|cache|scripts|styles|images|fonts|media|js|css|plt-client)\//i.test(pathname) && !/^\/rsi\/static\//i.test(pathname)) return 'unknown-static-root';
  if (!/^[a-z0-9][a-z0-9._-]*\.(?:js|mjs|css|json|map|wasm|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|otf|mp4|webm)$/i.test(parts.at(-1) ?? '')) return 'unsupported-file-name';
  // Cache-busting is supported; action/query parameters never get the exception.
  const cacheKeys = ['v', 'ver', 'version', 'hash', 'build', 'rev', 't', '_', 'cb', 'cache'];
  if (url.search.length > 1024 || [...url.searchParams].length > 8) return 'query-limits';
  for (const [key, value] of url.searchParams) {
    if (!cacheKeys.includes(key)) return 'unsupported-query-key';
    if (!/^[a-z0-9._~-]{0,128}$/i.test(value)) return 'unsupported-query-value';
  }
  return null;
}
export function evaluateOperation(value: string, request?: RequestContext): OperationDecision {
  try {
    const url = new URL(value), pathname = canonicalPath(url.pathname);
    if (pathname === null) return { blocked: true, detail: 'invalid-url-or-path' };
    if (!operationWords.test(pathname)) return { blocked: false };
    const detail = request ? staticReadExclusion(url, pathname, request) : 'request-context-missing';
    return detail ? { blocked: true, detail } : { blocked: false };
  } catch { return { blocked: true, detail: 'invalid-url-or-path' }; }
}
export function blockedOperation(value: string, request?: RequestContext): boolean {
  return evaluateOperation(value, request).blocked;
}

type SessionRequest = RequestContext & { url: string; uploadData?: readonly unknown[] };
const assetOrigins = new Set([RSI_ORIGIN, 'https://cdn.robertsspaceindustries.com',
  'https://media.robertsspaceindustries.com', 'https://static.robertsspaceindustries.com']);
const englishLoginNavigation = /^\/nav\/en\/(?:manifest|main\.[a-z0-9]{13}-[0-9]{10})\.json$/;
const recaptcha = 'https://www.recaptcha.net';
const captchaFrame = /^\/recaptcha\/enterprise\/(?:anchor|bframe)$/;
export function rsiCaptchaFrame(value: string): boolean {
  try {
    const url = new URL(value);
    return url.origin === recaptcha && !url.username && !url.password && captchaFrame.test(url.pathname);
  } catch { return false; }
}

/** The auth document can submit only the verified authentication routes. Read traffic is allowlisted in every phase. */
export function evaluateRsiSessionRequest(request: SessionRequest, phase: 'login' | 'captcha' | 'read' | 'closed'): OperationDecision {
  const deny = (detail: OperationBlockDetail): OperationDecision => ({ blocked: true, detail });
  const allow = { blocked: false } as const;
  if (phase === 'closed') return deny('session-closed');
  try {
    const url = new URL(request.url);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.port) return deny('invalid-url-or-path');
    const { pathname, origin } = url, { method, resourceType } = request;
    const read = ['GET', 'HEAD'].includes(method) && !request.uploadData?.length;
    if (phase === 'login' && method === 'POST' && origin === RSI_ORIGIN && rsiLoginPath.test(pathname) && !url.search &&
        ['mainFrame', 'xhr'].includes(resourceType)) return allow;
    if (phase === 'login' || phase === 'captcha') {
      if (origin === recaptcha) {
        if (read && ((resourceType === 'script' && pathname === '/recaptcha/enterprise.js') ||
            (resourceType === 'subFrame' && captchaFrame.test(pathname)))) return allow;
        if (phase === 'captcha' && method === 'POST' && resourceType === 'xhr' &&
            /^\/recaptcha\/enterprise\/(?:reload|userverify|clr)$/.test(pathname)) return allow;
      }
      if (read && origin === 'https://www.gstatic.com' && ['script', 'stylesheet', 'image'].includes(resourceType) &&
          /^\/recaptcha\/releases\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+\.(?:js|css|png)$/.test(pathname)) return allow;
    }
    const operation = evaluateOperation(request.url, request);
    if (operation.blocked) return operation;
    if (!read) return deny('non-read-method');
    if (resourceType === 'mainFrame' || (resourceType === 'xhr' && isPledgesPage(request.url))) {
      if (!allowedRsiNavigation(request.url)) return deny('navigation-not-allowed');
      if (isRsiLoginPage(request.url)) return resourceType === 'mainFrame' && url.search.length <= 2048 ? allow : deny('navigation-not-allowed');
      if (!url.search || (isPledgesPage(request.url) && /^\?page=[1-9]\d{0,3}&pagesize=10$/.test(url.search) &&
          Number(url.searchParams.get('page')) <= 5000)) return allow;
      return deny('unsupported-query-key');
    }
    if (resourceType === 'script') {
      if (origin === RSI_ORIGIN && pathname === '/cookie-consent/script.js' &&
          (!url.search || (phase === 'login' && url.search === '?async=1'))) return allow;
      if (origin === 'https://consent.cookiebot.com' && pathname === '/uc.js' && !url.search) return allow;
    }
    // The English sign-in header reads this manifest and its versioned main menu.
    if (phase === 'login' && resourceType === 'xhr' && origin === 'https://static.robertsspaceindustries.com' &&
        request.url === origin + pathname && englishLoginNavigation.test(pathname)) return allow;
    if (!assetOrigins.has(origin)) return deny('untrusted-asset-origin');
    const path = canonicalPath(pathname);
    if (!path) return deny('invalid-url-or-path');
    const detail = staticReadExclusion(url, path, request);
    return detail ? deny(detail) : allow;
  } catch { return deny('invalid-url-or-path'); }
}
