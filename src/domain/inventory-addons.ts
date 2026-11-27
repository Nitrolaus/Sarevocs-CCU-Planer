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
  sharedPurchase: boolean;
  parentPurchase: ReturnType<typeof purchaseValue>['value'];
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
  const kind=normalized(item.kind),title=normalized(item.title);
  return /^(ship|vehicle|insurance|upgrade|game|game access|currency|credits)$/i.test(kind) ||
    /^(?:Star Citizen|Squadron\s*42) (?:Digital Download|Game Access)$/i.test(title) ||
    /^(?:Lifetime|\d+\s+Months?) Insurance$/i.test(title) ||
    /^(?:\d[\d,.]*\s+(?:UEC|REC)|(?:UEC|REC)\s+\d[\d,.]*)$/i.test(title);
}

function category(item: Content, armorSet = false): AddonCategory {
  const kind = normalized(item.kind);
  if (/^(?:skin|paint|livery|lackierung)$/.test(kind)) return 'paints';
  if (/^(?:(?:ship|vehicle) )?(?:module|component|accessory)$/.test(kind) ||
      /^(?:ship|vehicle) equipment$/.test(kind)) return 'modules';
  if (/^(?:fps )?weapons?$/.test(kind)) return 'weapons';
  if (/^(?:armor|armour)(?: set)?$/.test(kind)) return 'armor';
  if (/^(?:clothing|apparel|clothes)$/.test(kind)) return 'clothing';
  if (/^(?:decoration|decorations|hangar flair|poster)$/.test(kind)) return 'decorations';
  if (/^(?:collectible|collectibles|collectable|model)$/.test(kind)) return 'collectibles';
  const title = normalized(item.title).replace(/[\u2010-\u2015]/g, '-');
  // RSI commonly supplies only "FPS Equipment"; supplementary items may have no kind at all.
  // Use explicit object names, retaining unrecognized equipment rather than guessing from brand/model codes.
  if (/\b(?:paint|livery)\b/.test(title)) return 'paints';
  if (/\b(?:module|schiffsmodul)\b/.test(title)) return 'modules';
  if (kind && !/^(?:fps equipment|equipment|subscriber flair|hangar decoration)$/.test(kind)) return 'other';
  // Decorative replicas of weapons or armor must not become usable gear in the filters.
  if (/\b(?:poster|pennant|flag|lamp|neon light|hologram display|nightstand|planter|throne|locker|(?:weapon|gun|rifle) rack)\b/.test(title)) return 'decorations';
  if (/\b(?:miniature|figurine|replica|trophy|statue|coin|plushie|envelope)\b|\bmodel$/.test(title)) return 'collectibles';
  if (/\b(?:rifle|pistol|shotgun|smg|lmg|knife|dagger|sword|grenade launcher)\b/.test(title) ||
      kind === 'fps equipment' && /\bblade$/.test(title)) return 'weapons';
  if (/\b(?:helmet|armor|armour|undersuit|(?:exploration|flight|hazard|combat|space) suit|(?:hazard|purifier|respirator) mask|backpack)\b/.test(title) ||
      (kind === 'fps equipment' || armorSet) && /\b(?:core|arms|legs)$/.test(title)) return 'armor';
  if (/\b(?:jacket|t-?shirt|shirt|glasses|beanie|hat|cap|sweater|hoodie|pants|trousers|boots|shoes|gloves|jumpsuit|overalls)\b/.test(title)) return 'clothing';
  if (kind === 'hangar decoration') return 'decorations';
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
    ].filter(({item}) => !entitlement(item) && !shipNames.has(normalized(item.title)) &&
      !(pledge.ccus.length > 0 && normalized(item.title) === normalized(pledge.name)));
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
    const recorded = price.kind === 'recorded' && price.value?.evidence !== RSI_LOG_PRICE ? price.value : null;
    const purchase = singleItem ? recorded : null;
    const sharedPurchase = !standalone || items.length > 1 || (primary?.length ?? 0) > 1 || (supplementary?.length ?? 0) > 1;
    const armorSet = items.some(({item}) => category(item) === 'armor');
    return items.map(({item, key}): InventoryAddon => ({
      key: pledge.pledgeId + ':' + key, name: item.title, originalKind: item.kind,
      category: category(item, armorSet), relatedShips: relatedShips(item.title, names),
      pledge, source, purchase, sharedPurchase: !purchase && sharedPurchase, parentPurchase: purchase ? null : recorded,
    }));
  });
}
