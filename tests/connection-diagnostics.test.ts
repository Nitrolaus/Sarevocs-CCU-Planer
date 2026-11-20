import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { ConnectionDiagnostics, connectionTarget, connectionResource, diagnosticLabel, networkErrorName,
  MAX_DIAGNOSTIC_BYTES, MAX_DIAGNOSTIC_EVENTS, type ConnectionEvent } from '../src/diagnostics/connection';

const root = fs.mkdtempSync(path.resolve('work/temp/connection-unit-'));
const canary = 'SYNTHETIC_SECRET_MUST_NEVER_REACH_DIAGNOSTICS';
const failure: ConnectionEvent = { event: 'load-failed', target: 'login', resource: 'mainFrame', code: -102, networkError: 'ERR_CONNECTION_REFUSED' };
function logger(name: string) { return new ConnectionDiagnostics(path.join(root, name), '0.3.5'); }

test('Request diagnostics bound disk writes across resource types while lifecycle failures still persist', () => {
  let now = 100;
  const log = new ConnectionDiagnostics(path.join(root, 'request-limit'), '0.3.5', () => now);
  const blocked: ConnectionEvent = { event: 'request-blocked', target: 'external', resource: 'xhr' };
  for (let i = 0; i < 30; i++) assert.equal(log.record(blocked), i < 6);
  assert.equal(log.record({ event: 'http-error', target: 'login', resource: 'mainFrame', httpStatus: 429 }), false);
  assert.equal(log.record(failure), true);
  now += 1000;
  assert.equal(log.record(blocked), true);
  assert.equal(JSON.parse(fs.readFileSync(log.file, 'utf8')).events.length, 8);
});

test('Diagnostic targets discard usernames, hostnames, paths, queries and fragments', () => {
  assert.equal(connectionTarget(`https://robertsspaceindustries.com/en/connect?password=${canary}#${canary}`), 'login');
  assert.equal(connectionTarget(`https://robertsspaceindustries.com/en/sign-in?token=${canary}`), 'login');
  assert.equal(connectionTarget(`https://robertsspaceindustries.com/en-US/sign-in/send-confirmation-code?email=${canary}`), 'login');
  assert.equal(connectionTarget('https://robertsspaceindustries.com/sign-in/forgot-password'), 'rsi-other');
  assert.equal(connectionTarget(`https://robertsspaceindustries.com/account/pledges?token=${canary}`), 'hangar');
  assert.equal(connectionTarget(`https://robertsspaceindustries.com/account/${canary}`), 'rsi-other');
  assert.equal(connectionTarget(`https://id.robertsspaceindustries.com/${canary}`), 'rsi-service');
  assert.equal(connectionTarget(`https://${canary}:${canary}@example.invalid/${canary}`), 'external');
  assert.equal(connectionTarget(`file:///C:/${canary}`), 'local');
  assert.equal(connectionTarget(canary), 'invalid');
  assert.equal(connectionResource(canary), 'other');
});
test('Network diagnostics accept only exact known names and numeric errors', () => {
  assert.equal(networkErrorName(-102), 'ERR_CONNECTION_REFUSED');
  assert.equal(networkErrorName('net::ERR_CONNECTION_REFUSED'), 'ERR_CONNECTION_REFUSED');
  for (const value of [canary, 'ERR_' + canary, 'ERR_CONNECTION_REFUSED ' + canary, { message: canary }, -999]) assert.equal(networkErrorName(value), 'ERR_OTHER');
});
test('Writer reconstructs allowed fields and never serializes supplied secrets', () => {
  const log = logger('privacy');
  const malicious = { ...failure, password: canary, token: canary, url: 'https://example.invalid/' + canary,
    description: canary, headers: { Authorization: canary }, body: canary, accountId: canary, error: new Error(canary) };
  assert.equal(log.record(malicious), true);
  assert.equal(log.record({ ...failure, networkError: ('ERR_' + canary) as never }), true);
  const bytes = fs.readFileSync(log.file, 'utf8'); assert.equal(bytes.includes(canary), false);
  const stored = JSON.parse(bytes);
  assert.deepEqual(Object.keys(stored).sort(), ['appVersion', 'events', 'schemaVersion']);
  assert.deepEqual(Object.keys(stored.events[0]).sort(), ['appVersion', 'at', 'code', 'event', 'networkError', 'resource', 'target']);
  assert.equal(stored.events[0].code, -102); assert.equal(stored.events[1].networkError, 'ERR_OTHER');
  assert.equal(log.record({ ...failure, target: canary as never }), false);
  assert.equal(fs.readFileSync(log.file, 'utf8'), bytes);
});
test('Existing diagnostic data is sanitized again on restart, not copied verbatim', () => {
  const log = logger('restart'); assert.equal(log.record(failure), true);
  const old = JSON.parse(fs.readFileSync(log.file, 'utf8'));
  old.token = canary; old.events[0].password = canary;
  old.events.push({ ...failure, at: canary });
  fs.writeFileSync(log.file, JSON.stringify(old));
  assert.equal(logger('restart').record({ event: 'http-error', target: 'login', resource: 'xhr', httpStatus: 429 }), true);
  const bytes = fs.readFileSync(log.file, 'utf8'); assert.equal(bytes.includes(canary), false);
  assert.equal(JSON.parse(bytes).events.length, 2);
});
test('Retention remains bounded after multiple instances and malformed or oversized history', () => {
  const log = logger('bounded');
  for (let i = 0; i < 120; i++) assert.equal(log.record(failure), true);
  assert.equal(logger('bounded').record(failure), true);
  assert.equal(JSON.parse(fs.readFileSync(log.file, 'utf8')).events.length, MAX_DIAGNOSTIC_EVENTS);
  assert.ok(fs.statSync(log.file).size < MAX_DIAGNOSTIC_BYTES);
  fs.writeFileSync(log.file, canary.repeat(MAX_DIAGNOSTIC_BYTES));
  assert.equal(log.record(failure), true); assert.equal(JSON.parse(fs.readFileSync(log.file, 'utf8')).events.length, 1);
  fs.writeFileSync(log.file, '{' + canary);
  assert.equal(log.record(failure), true); assert.equal(fs.readFileSync(log.file, 'utf8').includes(canary), false);
});
test('Invalid codes cannot inject data; write failures are isolated', () => {
  const log = logger('codes');
  assert.equal(log.record({ ...failure, code: Number.NaN, httpStatus: 9000, reason: canary as never }), true);
  const entry = JSON.parse(fs.readFileSync(log.file, 'utf8')).events[0];
  assert.equal(entry.code, undefined); assert.equal(entry.httpStatus, undefined); assert.equal(entry.reason, undefined);
  const blocked = path.join(root, 'not-a-directory'); fs.writeFileSync(blocked, 'fixture');
  assert.equal(new ConnectionDiagnostics(blocked, '0.3.3').record(failure), false);
  assert.equal(diagnosticLabel({ event: 'http-error', target: 'login', resource: 'xhr', httpStatus: 403 }), 'HTTP_403');
  assert.equal(diagnosticLabel({ ...failure, networkError: canary as never }), 'ERR_OTHER');
  assert.throws(() => new ConnectionDiagnostics('relative', '0.3.3'));
  assert.throws(() => new ConnectionDiagnostics(root, canary));
});
test('Block detail accepts only fixed values on request policy blocks, never raw metadata', () => {
  const log = logger('block-details');
  const block: ConnectionEvent = { event: 'request-blocked', target: 'rsi-service', resource: 'other', reason: 'protected-operation', blockDetail: 'api-or-action-path' };
  assert.equal(log.record({ ...block, url: canary, token: canary, queryKey: canary, method: canary } as ConnectionEvent), true);
  assert.equal(log.record({ ...block, blockDetail: canary as never }), true);
  assert.equal(log.record({ ...block, event: 'http-error' }), true);
  assert.equal(log.record({ ...block, reason: 'read-only', blockDetail: 'non-read-method' }), true);
  const bytes = fs.readFileSync(log.file, 'utf8'), entries = JSON.parse(bytes).events;
  assert.equal(bytes.includes(canary), false);
  assert.equal(entries[0].blockDetail, 'api-or-action-path');
  for (const entry of entries.slice(1, 3)) assert.equal(entry.blockDetail, undefined);
  assert.equal(entries[3].blockDetail, 'non-read-method');
});
test('Hangar observations accept fixed states only on their own event and discard URLs and secrets', () => {
  const log = logger('hangar-observations');
  const known = ['consent', 'list-missing', 'pledge-fields', 'upgrade-fields', 'ready',
    'reading-pages', 'preview-ready', 'page-read-failed', 'duplicate-page'] as const;
  const observation: ConnectionEvent = { event: 'hangar-observation', target: 'hangar', resource: 'mainFrame' };
  for (const state of known) assert.equal(log.record({ ...observation, observation: state }), true);
  for (const value of [canary, `https://example.invalid/${canary}`, `ready ${canary}`]) {
    assert.equal(log.record({ ...observation, observation: value as never }), true);
  }
  assert.equal(log.record({ ...failure, observation: 'ready' }), true);
  const bytes = fs.readFileSync(log.file, 'utf8'), entries = JSON.parse(bytes).events;
  assert.equal(bytes.includes(canary), false);
  assert.deepEqual(entries.slice(0, known.length).map((e: ConnectionEvent) => e.observation), [...known]);
  for (const entry of entries.slice(known.length)) assert.equal(entry.observation, undefined);
});

test('Per-event versions survive restart; legacy history is never relabelled as the new version', () => {
  const log = logger('event-versions'); fs.mkdirSync(path.dirname(log.file), { recursive: true });
  const at = '2026-11-14T12:00:00.000Z';
  fs.writeFileSync(log.file, JSON.stringify({ schemaVersion: 1, appVersion: '0.3.4', events: [
    { ...failure, at }, { ...failure, at, appVersion: '0.3.4' }, { ...failure, at, appVersion: canary },
  ] }));
  assert.equal(log.record(failure), true);
  const bytes = fs.readFileSync(log.file, 'utf8'), data = JSON.parse(bytes);
  assert.equal(bytes.includes(canary), false); assert.equal(data.appVersion, '0.3.5');
  assert.deepEqual(data.events.map((e: { appVersion?: string }) => e.appVersion), [undefined, '0.3.4', undefined, '0.3.5']);
});
