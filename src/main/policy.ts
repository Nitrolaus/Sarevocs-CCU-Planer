export const RSI_ORIGIN = 'https://robertsspaceindustries.com';
export const RSI_HANGAR_URL = RSI_ORIGIN + '/account/pledges';
export const RSI_LOGIN_URL = RSI_ORIGIN + '/en/sign-in';
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
// The public RSI login client posts one Apollo batch entry. On a persisted-query
// retry it appends the printed document, keeping the same manifest ID and variables.
const captchaImageOperation = {
  operationName: 'captcha',
  variables: { size: 'm', action: 'signin' },
  extensions: { persistedQuery: { version: 1, sha256Hash: 'b2aea1c9a3c838fdfcfa5bd0af92fe551f2337dbf2592f61ecac78f26f958e51' } },
};
const captchaImageQuery = `mutation captcha($action: String!, $size: String!) {
  account_captcha(action: $action, size: $size) {
    data
    type
    encoding
    __typename
  }
}`;
const captchaImageBodies = [captchaImageOperation, { ...captchaImageOperation, query: captchaImageQuery }]
  .map(operation => JSON.stringify([operation]));

function rsiUploadBytes(uploadData: SessionRequest['uploadData']): Buffer | undefined {
  if (uploadData?.length !== 1) return;
  const part = uploadData[0];
  if (!part || typeof part !== 'object' || !('bytes' in part) || !Object.hasOwn(part, 'bytes') ||
      !Buffer.isBuffer(part.bytes)) return;
  // Electron exposes the rawData discriminator at runtime. Its UploadData type
  // also documents the bytes-only form. Neither may carry file or blob data.
  const keys = Object.keys(part);
  if (keys.length !== 1 && !(keys.length === 2 && keys.includes('type') && 'type' in part && part.type === 'rawData')) return;
  return part.bytes;
}

function isCaptchaImageUpload(bytes: Buffer): boolean {
  // Both expected bodies contain ASCII only. Reject other lengths before decoding.
  return captchaImageBodies.some(body => bytes.length === body.length && bytes.toString('utf8') === body);
}

const captchaSignInId = '676782b8f785e375e53d92061e9943e6445a92034f79f6b487e75f085150416b';
const emailCodeId = 'b445974966ca5ea454682c55ff4e8eeb88c7dc6200eba3059333a8b8cd6718cd';
const authUserFragment = `fragment AuthUserFragment on RsiAuthenticatedAccount {
  avatar
  displayname
  email
  hasGameAccess
  hasGamePackage
  referrerReferralCode
  status
  tmid
  username
  syncToken
  __typename
}`;
const captchaSignInQuery = `mutation signin($captcha_code: String, $captchaToken: String, $email: String!, $mark: String, $password: String!, $remember: Boolean) {
  account_signin(
    captcha_code: $captcha_code
    captcha_token: $captchaToken
    email: $email
    mark: $mark
    password: $password
    remember: $remember
  ) {
    ...AuthUserFragment
    __typename
  }
}

${authUserFragment}`;
const emailCodeQuery = `mutation multistep($code: String!, $deviceType: String!, $deviceName: String!, $duration: String!) {
  account_multistep(
    code: $code
    device_type: $deviceType
    device_name: $deviceName
    duration: $duration
  ) {
    ...AuthUserFragment
    __typename
  }
}

${authUserFragment}`;
const captchaSignInVariables = new Set(['email', 'password', 'captcha_code', 'remember', 'mark']);
const trustDurations = new Set(['session', 'day', 'week', 'month', 'year']);

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isCaptchaSignInVariables(variables: Record<string, unknown>): boolean {
  return Object.keys(variables).every(key => captchaSignInVariables.has(key)) &&
    typeof variables.email === 'string' && !!variables.email &&
    typeof variables.password === 'string' && !!variables.password &&
    typeof variables.captcha_code === 'string' && !!variables.captcha_code &&
    (!('remember' in variables) || typeof variables.remember === 'boolean') &&
    (!('mark' in variables) || typeof variables.mark === 'string');
}

function isEmailCodeVariables(variables: Record<string, unknown>): boolean {
  const { code, deviceName, deviceType, duration } = variables;
  return Object.keys(variables).length === 4 && deviceType === 'computer' &&
    typeof code === 'string' && code.length >= 6 && code.length <= 8 &&
    typeof deviceName === 'string' && deviceName.length >= 2 && deviceName.length <= 64 &&
    typeof duration === 'string' && trustDurations.has(duration);
}

function isManualAuthUpload(bytes: Buffer): boolean {
  if (bytes.length > 16 * 1024) return false;
  const body = bytes.toString('utf8');
  const signIn = body.startsWith('[{"operationName":"signin",');
  if (!signIn && !body.startsWith('[{"operationName":"multistep",')) return false;
  const batch: unknown = JSON.parse(body);
  if (!Array.isArray(batch) || batch.length !== 1 || !isJsonObject(batch[0])) return false;
  const operation = batch[0];
  const { variables, extensions, query } = operation;
  if (operation.operationName !== (signIn ? 'signin' : 'multistep') ||
      Object.keys(operation).length !== (query === undefined ? 3 : 4) ||
      (query !== undefined && query !== (signIn ? captchaSignInQuery : emailCodeQuery))) return false;
  if (!isJsonObject(extensions) || Object.keys(extensions).length !== 1 ||
      !isJsonObject(extensions.persistedQuery)) return false;
  const persisted = extensions.persistedQuery;
  if (Object.keys(persisted).length !== 2 || persisted.version !== 1 ||
      persisted.sha256Hash !== (signIn ? captchaSignInId : emailCodeId)) return false;
  if (!isJsonObject(variables) || !(signIn ? isCaptchaSignInVariables(variables) : isEmailCodeVariables(variables))) return false;
  // The RSI client serializes with JSON.stringify. An exact round trip excludes
  // duplicate keys and noncanonical encodings. Only a boolean leaves this check.
  return bytes.equals(Buffer.from(JSON.stringify(batch)));
}

const assetOrigins = new Set([RSI_ORIGIN, 'https://cdn.robertsspaceindustries.com',
  'https://media.robertsspaceindustries.com', 'https://static.robertsspaceindustries.com']);
const englishLoginNavigation = /^\/nav\/en\/(?:manifest|main\.[a-z0-9]{13}-[0-9]{10})\.json$/;
const rsiPasswordIcons = new Set([
  'https://cdn.robertsspaceindustries.com/orion-v3/icons/visibility-ecc8b45b.svg',
  'https://cdn.robertsspaceindustries.com/orion-v3/icons/visibilityOff-d487fc6e.svg',
]);
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
    if (phase === 'login' && method === 'POST' && resourceType === 'xhr' && request.url === RSI_ORIGIN + '/graphql') {
      const bytes = rsiUploadBytes(request.uploadData);
      if (bytes && (isCaptchaImageUpload(bytes) || isManualAuthUpload(bytes))) return allow;
    }
    if (phase === 'login' && read && resourceType === 'image' && rsiPasswordIcons.has(request.url)) return allow;
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
