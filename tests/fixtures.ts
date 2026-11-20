import type { InventoryDocument, Pledge } from '../src/domain/model';
export function basePledge(pledgeId = 'demo-base-alpha'): Pledge {
  return { pledgeId, name: pledgeId === 'demo-base-alpha' ? 'Demo-Basisschiff Alpha' : 'Demo-Basisschiff Beta',
    insurance: { kind: 'lti', evidence: 'Synthetischer Test: Lifetime Insurance' }, originalDescription: 'Synthetischer Einzelpledge',
    ships: [{ childId: 'ship-1', modelName: pledgeId === 'demo-base-alpha' ? 'Demo Alpha' : 'Demo Beta', modelId: null, identity: 'unresolved', role: 'unverified' }],
    ccus: [], protected: true, baseReleased: false, restrictions: [], acquisitionCost: null,
    unknownCostReason: 'Synthetischer unbekannter Preis', meltValue: null, sourceValues: {} };
}
export function demoDocument(): InventoryDocument {
  const bases = [basePledge(), basePledge('demo-base-beta')];
  const upgrades = ['demo-ccu-1', 'demo-ccu-2', 'demo-ccu-3'].map((instanceId, i): Pledge => ({
    ...basePledge(instanceId), name: i === 2 ? 'Demo Gamma → Demo Delta' : 'Demo Alpha → Demo Gamma',
    ships: [], insurance: { kind: 'unknown', reason: 'Kein eigener Versicherungsnachweis auf dem Test-CCU' },
    ccus: [{ instanceId, from: i === 2 ? 'Demo Gamma' : 'Demo Alpha', to: i === 2 ? 'Demo Delta' : 'Demo Gamma',
      status: 'unused', applicability: 'unverified', insurance: { kind: 'unknown', reason: 'Kein eigener Nachweis' } }],
  }));
  return { type: 'sarevocs-ccu-inventory', schemaVersion: 1, appVersion: '0.1.0', createdAt: '2026-11-14T09:00:00Z',
    dataMode: 'demo', account: { reference: 'demo-account-alpha', identityKind: 'manual-reference' },
    scope: { kind: 'full-hangar', exportComplete: true, expectedPledges: 5, pagesExpected: 1, pagesRead: 1 },
    pledges: [...bases, ...upgrades], buybacks: [{ entryId: 'demo-buyback-1', name: 'Demo-Buyback – keine freie Ressource',
      description: 'Synthetischer Buyback ohne aktuellen Preis', currentPrice: null, availability: 'unverified' }] };
}
export function foreignDocument() {
  return { type: 'hangarexport', version: 2, handle: 'SYNTHETIC_HANDLE', pledgesPagesize: 10, pledgesLastPage: 1,
    pledges: [{ pledgeId: 'fixture-100', pledgeName: 'Demo package', pledgeValue: '3500', pledgeConfigurationValue: '4000',
      date: 'SYNTHETIC DATE', contains: 'Synthetic package contents', page: 1, giftable: false, meltable: true,
      items: [{ title: 'Demo Alpha', kind: 'Ship', liner: 'Synthetic', itemCustomName: '' },
        { title: 'Demo Beta', kind: 'Ship', liner: 'Synthetic', itemCustomName: '' }],
      alsoContains: [{ title: 'Lifetime Insurance' }] },
    { pledgeId: 'fixture-101', pledgeName: 'Upgrade - Demo Alpha to Demo Gamma', pledgeValue: '', items: [], alsoContains: [], page: 1 }],
    buybacks: [{ pledgeId: '', pledgeName: 'Synthetic buyback', contains: 'Synthetic',
      buybackHref: '/account/buy-back-pledges/80001', date: 'SYNTHETIC DATE', page: 1 }] };
}
