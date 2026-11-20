import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Account, Pledge } from '../src/domain/model';
import type { LastSeen } from '../src/storage/last-seen';
import { HistoryTooltipCache, MAX_HISTORY_TOOLTIPS, historyKey, upgradeHistoryTitle } from '../src/ui/upgrade-history';

const account: Account = { id: '11111111-1111-4111-8111-111111111111', name: 'SYNTHETIC', mode: 'real', reference: null,
  identityKind: null, identityStatus: 'unbound', lastComplete: null };
const revision = '22222222-2222-4222-8222-222222222222';
const view = { accountId: account.id, revision } as LastSeen;
const pledge: Pledge = { pledgeId: '1001', name: 'Standalone Ships - Synthetic Alpha',
  insurance: { kind: 'unknown', reason: 'SYNTHETIC' }, originalDescription: 'SYNTHETIC',
  ships: [{ childId: 'synthetic-child', modelName: 'Synthetic Gamma', modelId: null, identity: 'unresolved', role: 'unverified' }],
  ccus: [], protected: true, baseReleased: false, restrictions: [], acquisitionCost: null, unknownCostReason: 'SYNTHETIC', meltValue: null, sourceValues: {} };
const key = { accountId: account.id, revision, pledgeId: pledge.pledgeId };

test('History-Tooltip ist nur für beobachtete aktuelle Schiffpledges mit sicherer ID geeignet', () => {
  assert.deepEqual(historyKey(pledge, account, view), key);
  for (const [p, a, v] of [
    [pledge, { ...account, mode: 'demo' }, view], [pledge, account, null],
    [pledge, account, { ...view, accountId: '33333333-3333-4333-8333-333333333333' }],
    [pledge, account, { ...view, revision: 'not-a-revision' }],
    [{ ...pledge, ships: [] }, account, view], [{ ...pledge, sourceValues: { upgradeState: 'unresolved' } }, account, view],
    [{ ...pledge, ccus: [{}] }, account, view],
  ] as [Pledge, Account, LastSeen | null][]) assert.equal(historyKey(p, a, v), null);
  for (const pledgeId of ['0', '01', '-1', '1.5', 'synthetic-pledge', '9007199254740992', '1'.repeat(17)]) {
    assert.equal(historyKey({ ...pledge, pledgeId }, account, view), null);
  }
});

test('Tooltip bewahrt Pledge und aktuelle Modelle, echte Reihenfolge und RSI-Zeit ohne UTC-Umrechnung', () => {
  const title = upgradeHistoryTitle(pledge, true, { status: 'loaded', partial: false, steps: [
    { from: 'Synthetic Alpha', to: 'Synthetic Beta', appliedAt: '2026-11-01 23:30' },
    { from: 'Synthetic Beta', to: 'Synthetic Gamma', appliedAt: '2026-11-02 00:15' },
  ] });
  assert.ok(title.startsWith('Pledge: Standalone Ships - Synthetic Alpha\nAktuell: Synthetic Gamma\n'));
  assert.ok(title.includes('Synthetic Alpha → Synthetic Beta · 01.11.2026 23:30'));
  assert.ok(title.includes('Synthetic Beta → Synthetic Gamma · 02.11.2026 00:15'));
  assert.ok(title.indexOf('Alpha →') < title.indexOf('Beta →'));
  assert.ok(!title.includes('UTC') && !title.includes('nicht verfügbar'));
  assert.equal(upgradeHistoryTitle(pledge, false), 'Pledge: ' + pledge.name);
});

test('Paket- und Partialhinweise ergänzen keine erfundene durchgehende Kette', () => {
  const multiple = { ...pledge, ships: [...pledge.ships, { ...pledge.ships[0]!, childId: 'other', modelName: 'Synthetic Delta' }] };
  const title = upgradeHistoryTitle(multiple, true, { status: 'loaded', partial: true,
    steps: [{ from: 'Synthetic Alpha', to: 'Synthetic Beta', appliedAt: null }, { from: 'Synthetic Delta', to: 'Synthetic Epsilon', appliedAt: null }] });
  assert.ok(title.includes('Pledge-Protokoll, Zuordnung zu Paketkindern ungeprüft.'));
  assert.ok(title.includes('Unvollständiges RSI-Pledge-Protokoll.'));
  assert.ok(title.includes('Datum unbekannt'));
  assert.ok(!title.includes('Synthetic Beta → Synthetic Delta'));
});

test('Nur erfolgreich leeres Protokoll behauptet keine gefundenen Upgrade-Schritte', () => {
  const empty = upgradeHistoryTitle(pledge, true, { status: 'loaded', steps: [], partial: false });
  assert.ok(empty.includes('Keine Upgrade-Schritte im abgerufenen RSI-Protokoll.'));
  for (const status of ['unavailable', 'auth-required', 'cancelled'] as const) {
    const title = upgradeHistoryTitle(pledge, true, { status, steps: [], partial: false });
    assert.ok(!title.includes('Keine Upgrade-Schritte'));
  }
  assert.ok(upgradeHistoryTitle(pledge, true, { status: 'loading' }).includes('wird geladen'));
});

test('Abweichendes Protokollende wird markiert und nicht zum aktuellen Modell ergänzt', () => {
  const title = upgradeHistoryTitle(pledge, true, { status: 'loaded', partial: false,
    steps: [{ from: 'Synthetic Alpha', to: 'Synthetic Beta', appliedAt: null }] });
  assert.ok(title.includes('Protokollende passt nicht eindeutig zum aktuellen Modell.'));
  assert.ok(!title.includes('Synthetic Beta → Synthetic Gamma'));
  assert.ok(title.includes('RSI-Pledge-Protokoll'));
});

test('History-Tooltip-Cache führt je Schlüssel nur einen offenen oder gespeicherten Abruf', () => {
  const cache = new HistoryTooltipCache(); cache.activate(account.id, revision);
  const ticket = cache.begin(key)!;
  assert.ok(ticket); assert.equal(cache.begin(key), null); assert.equal(cache.get(key)?.status, 'loading');
  assert.equal(cache.finish(ticket, { status: 'loaded', steps: [], partial: false }), true);
  assert.equal(cache.begin(key), null); assert.equal(cache.get(key)?.status, 'loaded');
  assert.equal(cache.finish(ticket, { status: 'unavailable', steps: [], partial: false }), false);
});

test('Profil- oder Revisionswechsel verwirft offene Antworten und vorherige Cachewerte', () => {
  for (const [id, rev] of [[account.id, '33333333-3333-4333-8333-333333333333'], ['44444444-4444-4444-8444-444444444444', revision]]) {
    const cache = new HistoryTooltipCache(); cache.activate(account.id, revision);
    const ticket = cache.begin(key)!; cache.activate(id!, rev!);
    assert.equal(cache.finish(ticket, { status: 'loaded', steps: [], partial: false }), false);
    assert.equal(cache.get(key), undefined);
    cache.activate(account.id, revision); assert.ok(cache.begin(key));
  }
});

test('Explizites Leeren invalidiert offene Anfragen und erlaubt einen späteren neuen Versuch', () => {
  const cache = new HistoryTooltipCache(); cache.activate(account.id, revision);
  const ticket = cache.begin(key)!; cache.clear();
  assert.equal(cache.finish(ticket, { status: 'loaded', steps: [], partial: false }), false);
  assert.ok(cache.begin(key));
});

test('History-Tooltip-Cache bleibt begrenzt und verwirft Antworten verdrängter Einträge', () => {
  const cache = new HistoryTooltipCache(); cache.activate(account.id, revision);
  const first = { ...key, pledgeId: '1' }, ticket = cache.begin(first)!;
  for (let n = 2; n <= MAX_HISTORY_TOOLTIPS + 1; n++) assert.ok(cache.begin({ ...key, pledgeId: String(n) }));
  assert.equal(cache.get(first), undefined);
  assert.equal(cache.finish(ticket, { status: 'loaded', steps: [], partial: false }), false);
  assert.ok(cache.begin(first));
});
