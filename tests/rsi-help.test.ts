import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commandSchema } from '../src/main/commands';
import { openRsiHelp, rsiHelpTopicSchema } from '../src/main/rsi-help';
import { helpDocumentSchema, helpResourceSchema, openHelpResource, readHelpDocument } from '../src/main/help-resources';

test('help accepts only fixed official topics and refuses extra links or account arguments', () => {
  for (const topic of rsiHelpTopicSchema.options) {
    assert.ok(commandSchema.safeParse({ action: 'help.openRsi', topic }).success);
  }
  assert.equal(commandSchema.safeParse({ action: 'help.openRsi', topic: 'https://example.org' }).success, false);
  assert.equal(commandSchema.safeParse({ action: 'help.openRsi', topic: 'upgrades', url: 'https://example.org' }).success, false);
  assert.equal(commandSchema.safeParse({ action: 'help.openRsi', topic: 'upgrades', accountId: 'not-a-profile' }).success, false);
});

test('each topic opens its assigned official help article once and reports browser errors', async () => {
  const opened: string[] = [];
  for (const topic of rsiHelpTopicSchema.options) {
    assert.deepEqual(await openRsiHelp(topic, async url => { opened.push(url); }), { opened: true });
  }
  assert.deepEqual(opened.map(url => new URL(url).pathname.split('/').at(-1)?.split('-')[0]), ['360037490754', '115010056848', '115013173287', '360042825053']);
  assert.ok(opened.every(url => new URL(url).origin === 'https://support.robertsspaceindustries.com'));
  await assert.rejects(openRsiHelp('upgrades', async () => { throw new Error('BROWSER'); }), /BROWSER/);
});

test('help can request only predefined public links and bundled documents', async () => {
  const opened: string[] = [];
  for (const resource of helpResourceSchema.options) {
    assert.equal(commandSchema.safeParse({ action: 'help.openResource', resource }).success, true);
    await openHelpResource(resource, async url => { opened.push(url); });
  }
  assert.deepEqual(opened.map(url => new URL(url).origin), [
    'https://robertsspaceindustries.com', 'https://robertsspaceindustries.com',
    'https://robertsspaceindustries.com', 'https://www.twitch.tv', 'https://erkul.games',
    'https://support.robertsspaceindustries.com', 'https://learn.microsoft.com', 'https://ko-fi.com', 'https://www.paypal.com',
    'https://github.com', 'https://github.com',
  ]);
  assert.equal(opened[7], 'https://ko-fi.com/sarevoc');
  assert.match(opened[8]!, /^https:\/\/www\.paypal\.com\/ncp\/payment\/[A-Z0-9]{10,20}$/);
  assert.deepEqual(opened.slice(9), [
    'https://github.com/Nitrolaus/Sarevocs-CCU-Planer/issues/new?template=fehler.yml',
    'https://github.com/Nitrolaus/Sarevocs-CCU-Planer/issues/new?template=bug-report.yml',
  ]);
  assert.equal(commandSchema.safeParse({ action: 'help.openResource', resource: 'bugReportEn', title: 'Unexpected issue data' }).success, false);
  assert.equal(commandSchema.safeParse({ action: 'help.openResource', resource: 'paypal', url: 'https://example.invalid' }).success, false);
  assert.equal(commandSchema.safeParse({ action: 'help.openResource', resource: 'kofi', url: 'https://example.invalid' }).success, false);
  for (const document of helpDocumentSchema.options) {
    assert.equal(commandSchema.safeParse({ action: 'help.readDocument', document }).success, true);
  }
  assert.equal(commandSchema.safeParse({ action: 'help.openResource', resource: 'https://example.invalid' }).success, false);
  assert.equal(commandSchema.safeParse({ action: 'help.openResource', resource: 'erkul', url: 'https://example.invalid' }).success, false);
  assert.equal(commandSchema.safeParse({ action: 'help.readDocument', document: '../package.json' }).success, false);
  assert.equal(commandSchema.safeParse({ action: 'help.readDocument', document: 'terms', path: '../package.json' }).success, false);
  assert.match(await readHelpDocument('terms', 'docs/public'), /Nutzungsbedingungen der kostenlosen Fan-Testversion/);
  assert.match(await readHelpDocument('privacy', 'docs/public'), /Lokale Daten und Schutzgrenzen/);
});
