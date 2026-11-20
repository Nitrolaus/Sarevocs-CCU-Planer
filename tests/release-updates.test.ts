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

test('the release check shares requests, retains results offline and opens only the known GitHub release', async () => {
  let requests = 0;
  let now = 0;
  let offline = false;
  const entry = { ...release('v0.3.76-alpha'), html_url: 'https://example.invalid', assets: [{ browser_download_url: 'file:///test.exe' }] };
  const checker = new ReleaseUpdates('0.3.75', async signal => {
    assert.equal(signal.aborted, false);
    requests++;
    if (offline) throw new Error('offline');
    return [entry];
  }, () => now);
  const [result, same] = await Promise.all([checker.check(), checker.check()]);
  assert.equal(result, same);
  assert.equal(await checker.check(), result);
  assert.equal(requests, 1);
  assert.equal(result?.tag, entry.tag_name);

  offline = true;
  now += 60 * 60 * 1000;
  assert.equal(await checker.check(), result);
  assert.equal(await checker.check(), result);
  assert.equal(requests, 2);

  const opened: string[] = [];
  const open = async (url: string) => { opened.push(url); };
  assert.equal(await checker.open('v0.3.79', open), null);
  assert.deepEqual(await checker.open(entry.tag_name, open), { opened: true });
  assert.deepEqual(opened, ['https://github.com/Nitrolaus/Sarevocs-CCU-Planer/releases/tag/v0.3.76-alpha']);
  checker.close();
  assert.equal(await checker.check(), null);
  assert.equal(await checker.open(entry.tag_name, open), null);
});

test('update IPC accepts a tag but no renderer-supplied URL or additional request data', () => {
  assert.equal(commandSchema.safeParse({ action: 'help.checkUpdate' }).success, true);
  assert.equal(commandSchema.safeParse({ action: 'help.checkUpdate', accountId: 'data' }).success, false);
  assert.equal(commandSchema.safeParse({ action: 'help.openUpdate', tag: 'v0.3.76-alpha' }).success, true);
  assert.equal(commandSchema.safeParse({ action: 'help.openUpdate', tag: 'https://example.invalid/file.exe' }).success, false);
  assert.equal(commandSchema.safeParse({ action: 'help.openUpdate', tag: 'v0.3.76-alpha', url: 'https://example.invalid' }).success, false);
});
