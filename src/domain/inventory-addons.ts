import type {Pledge} from './model';
import {gameAccessEvidence} from './game-access';
import {comparePledgeDates} from './pledge-date';
import {purchaseValue, RSI_LOG_PRICE} from '../pricing/inventory-values';

export const addonCategories = [
  ['modules', 'Module & Zubehör', 'Modules & accessories'],
  ['weapons', 'Waffen', 'Weapons'],
  ['armor', 'Rüstungen', 'Armor'],
  ['clothing', 'Kleidung', 'Clothing'],
  ['paints', 'Lackierungen', 'Paints'],
  ['decorations', 'Dekoration', 'Decorations'],
  ['collectibles', 'Sammlerstücke', 'Collectibles'],
  ['other', 'Sonstiges', 'Other'],
] as const;
export type AddonCategory = typeof addonCategories[number][0];
export type AddonInventorySource = {pledge: Pledge; source: string};
type Content = {title: string; kind: string};
export type InventoryAddon = {
  key: string;
  name: string;
  category: AddonCategory;
  relatedShips: string[];
  pledge: Pledge;
  source: string;
  originalKind: string;
  purchase: ReturnType<typeof purchaseValue>['value'];
};

const normalized = (text: string) => text.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');

function contents(raw: string | undefined): Content[] | null {
  if (raw === undefined) return [];
  if (raw.length > 4000) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value) || value.length > 100 || !value.every(item =>
      item && typeof item === 'object' && typeof item.title === 'string' &&
      item.title.trim().length > 0 && item.title.length <= 4000 &&
      (item.kind === undefined || typeof item.kind === 'string' && item.kind.length <= 4000))) return null;
    return value.map(item => ({title: item.title.trim(), kind: item.kind?.trim() ?? ''}));
  } catch {
    return null;
  }
}

function entitlement(item: Content): boolean {
  return /^(ship|vehicle|insurance|upgrade|game|game access|currency)$/i.test(item.kind) ||
    /^(?:Star Citizen|Squadron\s*42) (?:Digital Download|Game Access)$/i.test(item.title) ||
    /^(?:Lifetime|\d+\s+Months?) Insurance$/i.test(item.title) ||
    /^(?:\d[\d,.]*\s+(?:UEC|REC)|(?:UEC|REC)\s+\d[\d,.]*)$/i.test(item.title);
}

function category(item: Content): AddonCategory {
  const kind = normalized(item.kind);
  if (/^(?:skin|paint|livery|lackierung)$/.test(kind)) return 'paints';
  if (/^(?:(?:ship|vehicle) )?(?:module|component|accessory)$/.test(kind) ||
      /^(?:ship|vehicle) equipment$/.test(kind)) return 'modules';
  if (/^(?:fps )?weapons?$/.test(kind)) return 'weapons';
  if (/^(?:armor|armour)(?: set)?$/.test(kind)) return 'armor';
  if (/^(?:clothing|apparel|clothes)$/.test(kind)) return 'clothing';
  if (/^(?:decoration|decorations|hangar flair|poster)$/.test(kind)) return 'decorations';
  if (/^(?:collectible|collectibles|collectable|model)$/.test(kind)) return 'collectibles';
  // Preserve unresolved source kinds. Titles identify only explicit content types.
  if (/\b(?:paint|livery)\b/i.test(item.title)) return 'paints';
  if (/\b(?:module|schiffsmodul)\b/i.test(item.title)) return 'modules';
  return 'other';
}

function relatedShips(title: string, shipNames: readonly string[]): string[] {
  const name = normalized(title).replace(/[–—]/g, '-');
  const matches = shipNames.filter(ship => {
    const model = normalized(ship).replace(/[–—]/g, '-');
    return name.startsWith(model + ' - ') || name.startsWith(model + ' paint') ||
      name.startsWith(model + ' module');
  });
  // "MTC" must not also identify an explicitly named "MTC XL" item.
  return matches.filter(ship => !matches.some(other =>
    other.length > ship.length && normalized(other).startsWith(normalized(ship) + ' ')));
}

/** Display-only projection of preserved package contents. Never creates planner resources. */
export function inventoryAddons(rows: readonly AddonInventorySource[], catalogueNames: readonly string[] = []): InventoryAddon[] {
  const names = [...new Map([...catalogueNames, ...rows.flatMap(row => row.pledge.ships.map(ship => ship.modelName))]
    .map(name => [normalized(name), name])).values()].sort((a, b) => a.localeCompare(b, 'en'));
  return [...rows].sort((a, b) => comparePledgeDates(a.pledge, b.pledge)).flatMap(({pledge, source}) => {
    const primary = contents(pledge.sourceValues.items);
    const supplementary = contents(pledge.sourceValues.alsoContains);
    const primaryNames = new Set(primary?.map(item => normalized(item.title)));
    const shipNames = new Set(pledge.ships.map(ship => normalized(ship.modelName)));
    const items = [
      ...(primary ?? []).map((item, index) => ({item, key: 'item:' + index})),
      ...(supplementary ?? []).flatMap((item, index) => primaryNames.has(normalized(item.title))
        ? [] : [{item, key: 'extra:' + index}]),
    ].filter(({item}) => !entitlement(item) && !shipNames.has(normalized(item.title)));
    const access = gameAccessEvidence(pledge);
    const standalone = !pledge.ships.length && !pledge.ccus.length &&
      pledge.sourceValues.upgradeState !== 'unresolved' && !access.starCitizen && !access.squadron42;
    if (!items.length && standalone && !entitlement({title: pledge.name, kind: ''}) &&
        !primary?.length && !supplementary?.length) {
      items.push({item: {title: pledge.name, kind: ''}, key: 'pledge'});
    }
    const price = purchaseValue(pledge, source);
    const singleItem = standalone && primary !== null && supplementary !== null &&
      primary.length === 1 && items.length === 1;
    const purchase = singleItem && price.kind === 'recorded' && price.value?.evidence !== RSI_LOG_PRICE
      ? price.value : null;
    return items.map(({item, key}): InventoryAddon => ({
      key: pledge.pledgeId + ':' + key, name: item.title, originalKind: item.kind,
      category: category(item), relatedShips: relatedShips(item.title, names),
      pledge, source, purchase,
    }));
  });
}
