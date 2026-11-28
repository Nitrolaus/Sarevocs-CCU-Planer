import React, {useEffect, useMemo} from 'react';
import {addonCategories, type AddonCategory, type InventoryAddon} from '../domain/inventory-addons';
import {inventorySearch} from '../market/search';
import {pledgeDateLabel} from '../domain/pledge-date';
import type {PricingSnapshot} from '../pricing/model';
import {convertPurchaseValue} from '../pricing/inventory-values';
import {formatMinor} from '../pricing/money';
import {ResizableTable} from './ResizableTable';
import {useText} from './i18n';
import './addons.css';
import {InventoryItemDetails,useInventoryMenu,type InventoryDetail} from './InventoryItemDetails';

export function AddonFilters({items, category, ship, onCategory, onShip}: {
  items: readonly InventoryAddon[];
  category: AddonCategory | '';
  ship: string;
  onCategory: (category: AddonCategory | '') => void;
  onShip: (ship: string) => void;
}) {
  const t = useText();
  const ships = useMemo(() => [...new Set(items.flatMap(item => item.relatedShips))].sort((a,b) => a.localeCompare(b)), [items]);
  return <>
    <select className="addon-filter" aria-label={t('Gegenstandsart')} value={category}
      onChange={event => onCategory(event.currentTarget.value as AddonCategory | '')}>
      <option value="">{t('Alle Arten')}</option>
      {addonCategories.map(([id, label]) => <option key={id} value={id}>{t(label)}</option>)}
    </select>
    <select className="addon-filter" aria-label={t('Zugehöriges Schiff')} value={ship} onChange={event => onShip(event.currentTarget.value)}>
      <option value="">{t('Alle Schiffe')}</option>
      <option value="none">{t('Ohne Schiff')}</option>
      {ships.map(name => <option key={name} value={name}>{name}</option>)}
    </select>
  </>;
}

export function AddonsTable({items, query, category, ship, display, demo, onSearchCount, accountId}: {
  items: readonly InventoryAddon[];
  query: string;
  category: AddonCategory | '';
  ship: string;
  display: PricingSnapshot;
  demo: boolean;
  onSearchCount: (shown: number, total: number) => void;
  accountId:string;
}) {
  const t = useText();
  const language = display.settings.language;
  const detailMenu=useInventoryMenu(JSON.stringify([accountId,query,category,ship]));
  const detailItems=new Map<string,InventoryDetail>();
  const visible = useMemo(() => {
    const match = inventorySearch(query);
    return items.filter(item => (!category || item.category === category) &&
      (!ship || (ship === 'none' ? !item.relatedShips.length : item.relatedShips.includes(ship))) &&
      match(item.name, item.pledge.name, item.originalKind, ...item.relatedShips,
        ...addonCategories.find(([id]) => id === item.category)!.slice(1)));
  }, [items, query, category, ship]);
  useEffect(() => onSearchCount(visible.length, items.length), [visible.length, items.length, onSearchCount]);
  const columns = ['Gegenstand', 'Art', 'Zuordnung', 'Enthalten in', 'Mein Kaufpreis', 'Herkunft / Datum'].map((label,index) => ({
    label: t(label),
    min: [140,90,90,130,100,90][index]!,
    preferred: [250,140,140,240,145,145][index]!,
    autoLimit: [700,260,450,700,300,400][index]!,
  }));
  return <><ResizableTable columns={columns} storageKey="addons"
    className="inventory-table ship-value-table addons-table" label={t('Add-ons & Gear')}>
    <tbody>{visible.map(item => {
      const date = pledgeDateLabel(item.pledge, language, true);
      const converted = convertPurchaseValue(item.purchase, display);
      const price = item.purchase ? (converted.approximate && converted.minor !== null ? '≈ ' : '') +
        formatMinor(converted.minor ?? item.purchase.minor,
          converted.minor === null ? item.purchase.currency : display.settings.currency, language)
        : t(item.sharedPurchase ? 'Im Paket' : 'Nicht belegt');
      const kind = addonCategories.find(([id]) => id === item.category)!;
      const origin = (demo ? 'DEMO · ' : '') + (item.source === 'rsi-dom-probe/1' ? 'RSI' : t('Import'));
      const priceTitle = item.purchase
        ? t('Belegter persönlicher Kaufpreis dieses Gegenstands.') + '\n' +
          formatMinor(item.purchase.minor, item.purchase.currency, language) +
          (converted.approximate && converted.minor !== null ? '\n' + t('Währungsumrechnung ist ein Richtwert.') : '')
        : [
          t('Für diesen Gegenstand ist kein persönlicher Einzelpreis belegt.'),
          item.parentPurchase
            ? t('Belegter Preis der übergeordneten Kaufposition:') + ' ' + formatMinor(item.parentPurchase.minor, item.parentPurchase.currency, language)
            : t('Für die übergeordnete Kaufposition liegt kein Preisbeleg vor.'),
          item.parentPurchase ? t('Dieser Betrag gilt für den gesamten Kauf und wird nicht auf die enthaltenen Teile verteilt.') : '',
        ].filter(Boolean).join('\n');
      if(detailMenu.selection?.key===item.key)detailItems.set(item.key,{key:item.key,title:item.name,price:item.purchase?price:null,priceDetails:priceTitle,facts:[
        {label:t('Art'),value:t(kind[1])},{label:t('Zuordnung'),value:item.relatedShips.join(', ')||'—'},
        {label:t('Enthalten in'),value:item.pledge.name},{label:t('Herkunft / Datum'),value:origin+'\n'+(pledgeDateLabel(item.pledge,language)||'')},
      ]});
      return <tr key={item.key} data-pledge={item.pledge.pledgeId} data-addon={item.key} data-addon-category={item.category} onContextMenu={event=>detailMenu.open(event,item.key)} onKeyDown={event=>detailMenu.open(event,item.key)}>
        <td tabIndex={0} title={item.name}>{item.name}</td>
        <td title={item.originalKind || t(kind[1])}>{t(kind[1])}</td>
        <td title={item.relatedShips.length ? item.relatedShips.join(', ') : t('Keine eindeutige Schiffszuordnung in den Quelldaten.')}>
          {item.relatedShips.join(', ') || '—'}
        </td>
        <td title={item.pledge.name}>{item.pledge.name}</td>
        <td className="ship-price" title={priceTitle}>{item.purchase ? <strong>{price}</strong>
          : <span className="addon-price-info">{price}</span>}</td>
        <td className="ship-source" title={origin + '\n' + (pledgeDateLabel(item.pledge, language) || '')}>
          {origin}{date && ' · ' + date}
        </td>
      </tr>;
    })}
    {!visible.length && <tr><td colSpan={6} className="empty">
      {t(items.length ? 'Keine passenden Einträge gefunden.' : 'Keine Add-ons oder Gear im gespeicherten Bestand erkannt.')}
    </td></tr>}
    </tbody>
  </ResizableTable><InventoryItemDetails menu={detailMenu} items={detailItems} accountId={accountId} settings={display.settings}/></>;
}
