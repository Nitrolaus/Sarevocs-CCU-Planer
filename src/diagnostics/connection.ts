import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { RSI_ORIGIN, OPERATION_BLOCK_DETAILS, isRsiLoginPage, type OperationBlockDetail } from '../main/policy';

const events = ['load-failed', 'request-failed', 'http-error', 'navigation-blocked', 'request-blocked',
  'hangar-not-ready', 'connection-timeout', 'observation-failed', 'login-return-pending', 'hangar-transition', 'hangar-observation'] as const;
export const HANGAR_OBSERVATIONS = ['consent', 'list-missing', 'pledge-fields', 'upgrade-fields', 'ready',
  'reading-pages', 'preview-ready', 'page-read-failed', 'duplicate-page',
  'purchase-orders-only', 'purchase-matched', 'purchase-no-match', 'purchase-log-unavailable', 'purchase-orders-unavailable', 'purchase-auth-changed'] as const;
const targets = ['login', 'hangar', 'account', 'rsi-other', 'rsi-service', 'external', 'local', 'invalid'] as const;
const resources = ['mainFrame', 'subFrame', 'xhr', 'script', 'other'] as const;
const reasons = ['insecure-transport', 'protected-operation', 'read-only', 'navigation-policy'] as const;
const networkCodes = {
  '-2': 'ERR_FAILED', '-3': 'ERR_ABORTED', '-7': 'ERR_TIMED_OUT', '-10': 'ERR_ACCESS_DENIED',
  '-20': 'ERR_BLOCKED_BY_CLIENT', '-21': 'ERR_NETWORK_CHANGED', '-27': 'ERR_BLOCKED_BY_RESPONSE',
  '-100': 'ERR_CONNECTION_CLOSED', '-101': 'ERR_CONNECTION_RESET', '-102': 'ERR_CONNECTION_REFUSED',
  '-103': 'ERR_CONNECTION_ABORTED', '-104': 'ERR_CONNECTION_FAILED', '-105': 'ERR_NAME_NOT_RESOLVED',
  '-106': 'ERR_INTERNET_DISCONNECTED', '-107': 'ERR_SSL_PROTOCOL_ERROR', '-109': 'ERR_ADDRESS_UNREACHABLE',
  '-111': 'ERR_TUNNEL_CONNECTION_FAILED', '-118': 'ERR_CONNECTION_TIMED_OUT', '-130': 'ERR_PROXY_CONNECTION_FAILED',
  '-138': 'ERR_NETWORK_ACCESS_DENIED', '-200': 'ERR_CERT_COMMON_NAME_INVALID', '-201': 'ERR_CERT_DATE_INVALID',
  '-202': 'ERR_CERT_AUTHORITY_INVALID', '-324': 'ERR_EMPTY_RESPONSE',
} as const;
type NetworkError = typeof networkCodes[keyof typeof networkCodes] | 'ERR_OTHER';
export type ConnectionEvent = {
  event: typeof events[number]; target: typeof targets[number]; resource: typeof resources[number];
  code?: number; networkError?: NetworkError; httpStatus?: number; reason?: typeof reasons[number]; blockDetail?: OperationBlockDetail;
  observation?: typeof HANGAR_OBSERVATIONS[number];
};
type StoredEvent = ConnectionEvent & { at: string; appVersion?: string };
export interface DiagnosticSink { record(event: ConnectionEvent): boolean }
export const MAX_DIAGNOSTIC_EVENTS = 80;
export const MAX_DIAGNOSTIC_BYTES = 64 * 1024;
let warningsProtected = false;
export function protectNavigationWarnings(): void {
  if (warningsProtected) return;
  warningsProtected = true;
  const original = process.emitWarning.bind(process) as (...args: unknown[]) => void;
  // Electron itself emits the complete failing URL to stderr before did-fail-load.
  // Replace only that known warning; no URL, original Error or stack is forwarded.
  process.emitWarning = ((warning: unknown, ...args: unknown[]) => {
    const type = typeof args[0] === 'object' && args[0] !== null ? (args[0] as { type?: unknown }).type : args[0];
    if (type === 'electron' && typeof warning === 'string' && warning.startsWith('Failed to load URL: ')) {
      original('Navigation fehlgeschlagen. Technischen Fehlercode im lokalen Diagnoseprotokoll pruefen.', 'electron');
    } else original(warning, ...args);
  }) as typeof process.emitWarning;
}

export function connectionTarget(value: string): ConnectionEvent['target'] {
  try {
    const u = new URL(value);
    if (['file:', 'about:', 'data:'].includes(u.protocol)) return 'local';
    if (!['https:', 'http:', 'wss:', 'ws:'].includes(u.protocol)) return 'invalid';
    if (u.origin === RSI_ORIGIN) {
      if (isRsiLoginPage(value)) return 'login';
      if (/^\/(?:[a-z]{2}\/)?account\/pledges\/?$/.test(u.pathname)) return 'hangar';
      if (/^\/(?:[a-z]{2}\/)?account\/?$/.test(u.pathname)) return 'account';
      return 'rsi-other';
    }
    return u.hostname === 'robertsspaceindustries.com' || u.hostname.endsWith('.robertsspaceindustries.com') ? 'rsi-service' : 'external';
  } catch { return 'invalid'; }
}
export function connectionResource(value: string): ConnectionEvent['resource'] {
  return resources.find(r => r === value) ?? 'other';
}
export function networkErrorName(value: unknown): NetworkError {
  if (typeof value === 'number') return networkCodes[String(value) as keyof typeof networkCodes] ?? 'ERR_OTHER';
  // Exact allowlist; never persist arbitrary descriptions, even strings beginning with ERR_.
  return Object.values(networkCodes).find(name => value === name || value === 'net::' + name) ?? 'ERR_OTHER';
}
function allowedEvent(value: unknown): ConnectionEvent | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const event = events.find(x => x === v.event), target = targets.find(x => x === v.target), resource = resources.find(x => x === v.resource);
  if (!event || !target || !resource) return null;
  // Reconstruct every property. No spreads, raw Electron events, URLs, headers, bodies or error objects.
  const clean: ConnectionEvent = { event, target, resource };
  if (typeof v.code === 'number' && Number.isInteger(v.code) && v.code >= -1000 && v.code < 0) clean.code = v.code;
  if (v.networkError !== undefined) clean.networkError = networkErrorName(v.networkError);
  if (typeof v.httpStatus === 'number' && Number.isInteger(v.httpStatus) && v.httpStatus >= 400 && v.httpStatus <= 599) clean.httpStatus = v.httpStatus;
  const reason = reasons.find(x => x === v.reason); if (reason) clean.reason = reason;
  const blockDetail = OPERATION_BLOCK_DETAILS.find(x => x === v.blockDetail);
  if (event === 'request-blocked' && (reason === 'protected-operation' || reason === 'read-only') && blockDetail) clean.blockDetail = blockDetail;
  const observation = HANGAR_OBSERVATIONS.find(x => x === v.observation);
  if (event === 'hangar-observation' && observation) clean.observation = observation;
  return clean;
}
export function diagnosticLabel(event: ConnectionEvent): string {
  const clean = allowedEvent(event);
  if (!clean) return 'DIAGNOSTIC_ERROR';
  if (clean.networkError) return clean.networkError;
  if (clean.httpStatus) return 'HTTP_' + clean.httpStatus;
  return clean.event.toUpperCase().replaceAll('-', '_');
}

export class ConnectionDiagnostics implements DiagnosticSink {
  readonly file: string;
  private networkWindow = Number.NEGATIVE_INFINITY;
  private networkWrites = 0;
  constructor(private directory: string, private version: string, private now = () => performance.now()) {
    if (!path.isAbsolute(directory) || !/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(version)) throw new Error('Invalid diagnostic configuration');
    this.file = path.join(directory, 'rsi-verbindung.json');
  }
  record(value: ConnectionEvent): boolean {
    let temporary: string | undefined;
    try {
      const clean = allowedEvent(value); if (!clean) return false;
      if (['request-blocked', 'request-failed', 'http-error'].includes(clean.event)) {
        const now = this.now();
        if (now - this.networkWindow >= 1000) { this.networkWindow = now; this.networkWrites = 0; }
        if (this.networkWrites >= 6) return false;
        this.networkWrites++;
      }
      fs.mkdirSync(this.directory, { recursive: true });
      if (fs.lstatSync(this.directory).isSymbolicLink()) return false;
      const history: StoredEvent[] = [];
      if (fs.existsSync(this.file)) {
        const stat = fs.lstatSync(this.file);
        if (!stat.isFile() || stat.isSymbolicLink()) return false;
        if (stat.size <= MAX_DIAGNOSTIC_BYTES) {
          try {
            const previous = JSON.parse(fs.readFileSync(this.file, 'utf8'));
            if (previous.schemaVersion === 1 && Array.isArray(previous.events)) {
              for (const old of previous.events.slice(-(MAX_DIAGNOSTIC_EVENTS - 1))) {
                const safe = allowedEvent(old);
                if (safe && typeof old.at === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(old.at)) {
                  const oldVersion = typeof old.appVersion === 'string' && /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(old.appVersion) ? old.appVersion : undefined;
                  history.push({ ...safe, at: old.at, ...(oldVersion ? { appVersion: oldVersion } : {}) });
                }
              }
            }
          } catch { /* Malformed old diagnostics never enter the new log or block the connection. */ }
        }
      }
      history.push({ ...clean, at: new Date().toISOString(), appVersion: this.version });
      const bytes = Buffer.from(JSON.stringify({ schemaVersion: 1, appVersion: this.version, events: history }, null, 2) + '\n');
      if (bytes.length > MAX_DIAGNOSTIC_BYTES) return false;
      const candidate = this.file + '.' + randomUUID() + '.tmp';
      const descriptor = fs.openSync(candidate, 'wx', 0o600);
      temporary = candidate;
      try { fs.writeFileSync(descriptor, bytes); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
      fs.renameSync(temporary, this.file); temporary = undefined;
      return true;
    } catch { return false; }
    finally { if (temporary) { try { fs.unlinkSync(temporary); } catch { /* Only our own temporary file. */ } } }
  }
}
