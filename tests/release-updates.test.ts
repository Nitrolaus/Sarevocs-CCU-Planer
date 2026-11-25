import assert from 'node:assert/strict';
import test from 'node:test';
import { commandSchema } from '../src/main/commands';
import { findReleaseUpdate, ReleaseUpdates } from '../src/main/release-updates';

const release = (tag_name: string, body = '') => ({
  tag_name,
  body,
  draft: false,
  published_at: '2026-01-01T00:00:00Z',
});

test('only a higher published version is offered; localized notes are plain text', () => {
  const body = [
    '## Deutsch', 'Einleitung', '### Was ist neu?', '- **Kettenvergleich** verbessert.',
    '- [Anleitung](https://example.invalid)', '### Lizenz', 'Lizenztext',
    '## English', 'Introduction', '### What’s new?', '- Improved chain comparison.',
    '![](https://example.invalid/pixel.png)', '<img src=x onerror=run()>',
  ].join('\n');
  const listed = [release('v0.3.9-alpha'), release('v0.3.75-alpha'),
    { ...release('v0.4.1-alpha'), draft: true }, release('v0.3.100-alpha', body),
    release('v0.9.0/../../other'), release('v0.9.0\n')];
  assert.equal(findReleaseUpdate(listed, '0.3.100'), null);
  assert.deepEqual(findReleaseUpdate(listed, '0.3.75'), {
    tag: 'v0.3.100-alpha',
    version: '0.3.100 Alpha',
    notes: { de: ['Kettenvergleich verbessert.', 'Anleitung'], en: ['Improved chain comparison.'] },
  });
  assert.deepEqual(findReleaseUpdate([release('v0.4.0', '## Deutsch\nNur auf Deutsch')], '0.3.75')?.notes.en, []);
  assert.equal(findReleaseUpdate([release('v0.4.0', 'a'.repeat(1_000))], '0.3.75')?.notes.de[0]?.length, 238);
});

test('startup reads releases once and opens only the known GitHub release', async () => {
  let requests = 0;
  const entry = { ...release('v0.3.76-alpha'), html_url: 'https://example.invalid', assets: [{ browser_download_url: 'file:///test.exe' }] };
  const checker = new ReleaseUpdates('0.3.75', async signal => {
    assert.equal(signal.aborted, false);
    requests++;
    return [entry];
  });
  const [result, same] = await Promise.all([checker.check(), checker.check()]);
  assert.equal(result, same);
  assert.equal(await checker.check(), result);
  assert.equal(requests, 1);
  assert.equal(result?.tag, entry.tag_name);

  const opened: string[] = [];
  const open = async (url: string) => { opened.push(url); };
  assert.equal(await checker.open('v0.3.79', open), null);
  assert.deepEqual(await checker.open(entry.tag_name, open), { opened: true });
  assert.deepEqual(opened, ['https://github.com/Nitrolaus/Sarevocs-CCU-Planer/releases/tag/v0.3.76-alpha']);
  checker.close();
  assert.equal(await checker.check(), null);
  assert.equal(await checker.open(entry.tag_name, open), null);
});

test('an offline startup is not retried before a new program run', async () => {
  let requests = 0;
  const read = async () => {
    if (++requests === 1) throw new Error('offline');
    return [release('v0.3.76-alpha')];
  };
  const firstRun = new ReleaseUpdates('0.3.75', read);
  assert.equal(await firstRun.check(), null);
  assert.equal(await firstRun.check(), null);
  assert.equal(requests, 1);
  firstRun.close();
  const nextRun = new ReleaseUpdates('0.3.75', read);
  assert.equal((await nextRun.check())?.tag, 'v0.3.76-alpha');
  assert.equal(requests, 2);
});

test('opening GitHub requires confirmation and respects a cancel or shutdown', async () => {
  const tag = 'v0.3.120-alpha';
  const checker = new ReleaseUpdates('0.3.119', async () => [release(tag)]);
  await checker.check();
  let prompts = 0, opens = 0;
  const open = async () => { opens++; };
  assert.equal(await checker.open('v0.3.121-alpha', open, async () => { prompts++; return true; }), null);
  assert.deepEqual(await checker.open(tag, open, async () => { prompts++; return false; }), { opened: false });
  assert.equal(prompts, 1);
  assert.equal(opens, 0);
  await assert.rejects(checker.open(tag, async () => { throw new Error('browser unavailable'); }, async () => true));
  assert.equal(await checker.open(tag, open, async () => { checker.close(); return true; }), null);
  assert.equal(opens, 0);
});

test('update IPC accepts a tag but no renderer-supplied URL or additional request data', () => {
  assert.equal(commandSchema.safeParse({ action: 'help.checkUpdate' }).success, true);
  assert.equal(commandSchema.safeParse({ action: 'help.checkUpdate', accountId: 'data' }).success, false);
  assert.equal(commandSchema.safeParse({ action: 'help.openUpdate', tag: 'v0.3.76-alpha' }).success, true);
  assert.equal(commandSchema.safeParse({ action: 'help.openUpdate', tag: 'https://example.invalid/file.exe' }).success, false);
  assert.equal(commandSchema.safeParse({ action: 'help.openUpdate', tag: 'v0.3.76-alpha', url: 'https://example.invalid' }).success, false);
});
