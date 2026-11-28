import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { DisplaySettings } from '../pricing/model';
import type { PackageBasis } from '../planner/package-shares';
import { PackageShareDetails, usePackageShares } from './PackageShareDetails';
import { useText } from './i18n';
import './inventory-details.css';

export type InventoryDetail = { key: string; title: string; price: string | null; priceDetails: string; priceLabel?: string;
  facts: { label: string; value: string }[]; packageBasis?: PackageBasis | null; lookup?: () => void };
type Selection = { key: string; scope: string; left: number; top: number; view: 'menu' | 'origin' | 'price' };
export function useInventoryMenu(scope: string) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const anchor = useRef<HTMLElement | null>(null);
  useEffect(() => { setSelection(null); anchor.current = null; }, [scope]);
  function close() { setSelection(null); if (anchor.current?.isConnected) anchor.current.focus({ preventScroll: true }); }
  function open(event: React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>, key: string) {
    if ((event.target as Element).closest('input,textarea,select,button,a,[contenteditable="true"]')) return;
    if ('key' in event && event.key !== 'ContextMenu' && !(event.key === 'F10' && event.shiftKey)) return;
    event.preventDefault();
    anchor.current = (event.target as Element).closest<HTMLElement>('[tabindex]') ?? event.currentTarget.querySelector<HTMLElement>('[tabindex]');
    const rect = (anchor.current ?? event.currentTarget).getBoundingClientRect();
    const x = 'clientX' in event ? event.clientX : rect.left + 8, y = 'clientY' in event ? event.clientY : rect.bottom;
    setSelection({ key, scope, view: 'menu', left: Math.max(8, Math.min(x, window.innerWidth - 240)),
      top: Math.max(8, Math.min(y, window.innerHeight - 142)) });
  }
  return { selection: selection?.scope === scope ? selection : null, setSelection, open, close };
}

export function InventoryItemDetails({ menu, items, accountId, settings }: {
  menu: ReturnType<typeof useInventoryMenu>; items: ReadonlyMap<string, InventoryDetail>;
  accountId: string | null; settings: DisplaySettings;
}) {
  const t = useText(), popup = useRef<HTMLDivElement>(null), selected = menu.selection;
  const item = selected && items.get(selected.key);
  useEffect(() => {
    if (!selected || selected.view !== 'menu' || !item) return;
    popup.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => { if (!popup.current?.contains(event.target as Node)) menu.setSelection(null); };
    // Opening a menu may finish a pending focus/scroll-into-view operation. Only a new
    // user scroll or a window resize dismisses it, so distant rows keep their menu.
    const move = () => menu.setSelection(null);
    window.addEventListener('pointerdown', outside); window.addEventListener('wheel', move, true);
    window.addEventListener('touchmove', move, true); window.addEventListener('resize', move);
    return () => { window.removeEventListener('pointerdown', outside); window.removeEventListener('wheel', move, true);
      window.removeEventListener('touchmove', move, true); window.removeEventListener('resize', move); };
  }, [selected?.key, selected?.view, !!item]);
  if (!selected || !item) return null;
  if (selected.view !== 'menu') return <DetailWindow key={item.key} item={item} tab={selected.view}
    accountId={accountId} settings={settings} onClose={menu.close}
    onTab={view => menu.setSelection({ ...selected, view })} />;
  function keyDown(event: React.KeyboardEvent) {
    const buttons = [...popup.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'ArrowDown' ? (index + 1) % buttons.length : event.key === 'ArrowUp'
      ? (index - 1 + buttons.length) % buttons.length : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : -1;
    if (next >= 0) { event.preventDefault(); buttons[next]?.focus(); }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); menu.close(); }
    if (event.key === 'Tab') menu.setSelection(null);
  }
  return createPortal(<div ref={popup} className="inventory-item-menu" role="menu" aria-label={t('Bestandsdetails')}
    style={{ left: selected.left, top: selected.top }} onKeyDown={keyDown}>
    <button type="button" role="menuitem" onClick={() => menu.setSelection({ ...selected, view: 'origin' })}>{t('Details & Herkunft')}</button>
    <button type="button" role="menuitem" onClick={() => menu.setSelection({ ...selected, view: 'price' })}>{t('Kaufpreis aufschlüsseln')}</button>
    <button type="button" role="menuitem" disabled={!item.lookup} onClick={() => { menu.close(); item.lookup?.(); }}
      title={!item.lookup ? t('Für diesen Gegenstand ist kein zusätzlicher Hangar-Log-Abruf verfügbar.') : undefined}>{t('Hangar-Log prüfen')}</button>
  </div>, document.body);
}

function DetailWindow({ item, tab, accountId, settings, onClose, onTab }: {
  item: InventoryDetail; tab: 'origin' | 'price'; accountId: string | null; settings: DisplaySettings;
  onClose: () => void; onTab: (tab: 'origin' | 'price') => void;
}) {
  const t = useText(), dialog = useRef<HTMLDialogElement>(null), editor = usePackageShares(item.packageBasis ? accountId : null);
  useEffect(() => { const node = dialog.current!; node.showModal(); return () => node.close(); }, []);
  return createPortal(<dialog ref={dialog} className="inventory-item-details" aria-labelledby="inventory-item-title"
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <header><h2 id="inventory-item-title">{item.title}</h2><button type="button" aria-label={t('Schließen')} onClick={onClose}>×</button></header>
    <div className="inventory-detail-tabs" role="tablist" aria-label={t('Bestandsdetails')}>
      {(['price', 'origin'] as const).map(value => <button key={value} type="button" role="tab"
        aria-selected={tab === value} id={'inventory-detail-' + value} aria-controls="inventory-detail-panel"
        onClick={() => onTab(value)}>{t(value === 'price' ? 'Kaufpreis' : 'Herkunft & Inhalt')}</button>)}
    </div>
    <section id="inventory-detail-panel" role="tabpanel" aria-labelledby={'inventory-detail-' + tab}>
      {tab === 'origin' ? <dl>{item.facts.map(({ label, value }, i) => <React.Fragment key={i}><dt>{label}</dt><dd>{value || '—'}</dd></React.Fragment>)}</dl>
        : <><p className="inventory-price-detail">{item.priceDetails}</p>
          <dl className="inventory-detail-total"><dt>{t(item.priceLabel ?? 'Mein Kaufpreis')}</dt><dd>{item.price ?? '—'}</dd></dl>
          {item.packageBasis && <PackageShareDetails key={item.key} basis={item.packageBasis} settings={settings} editor={editor} />}</>}
    </section>
  </dialog>, document.body);
}
