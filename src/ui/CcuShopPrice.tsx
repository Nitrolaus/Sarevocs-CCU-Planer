import React, { useEffect, useState } from 'react';
import type { CatalogueShip } from '../market/model';
import { SHOP_PRICE_MAX_AGE, type ShopPair, type ShopPrice } from '../market/shop-prices';
import { catalogueIdentity } from '../market/ship-values';
import { formatMinor } from '../pricing/money';
import { useText } from './i18n';

export function ccuShopPair(from: string, to: string, catalogue: readonly CatalogueShip[]): ShopPair | null {
  const fromId = catalogueIdentity(from, catalogue)?.id;
  const toId = catalogueIdentity(to, catalogue)?.id;
  return fromId && toId && fromId !== toId ? { fromId, toId } : null;
}

export function CcuShopPrice({ pair, language }: { pair: ShopPair; language: 'de' | 'en' }) {
  const t = useText();
  const [pending, setPending] = useState(false);
  const [prices, setPrices] = useState<ShopPrice[]>();
  useEffect(() => {
    if (!prices?.length) return;
    const expires = Math.min(...prices.map(price => price.checkedAt + SHOP_PRICE_MAX_AGE));
    const timer = setTimeout(() => setPrices(undefined), Math.max(0, expires - Date.now()));
    return () => clearTimeout(timer);
  }, [prices]);
  async function checkPrice() {
    setPending(true);
    try {
      const response = await window.ccu.request({ action: 'market.ccuQuote', pair });
      const checked = response.ok && Array.isArray(response.data) ? response.data as ShopPrice[] : [];
      setPrices(checked.filter(price => price.fromId === pair.fromId && price.toId === pair.toId));
    } catch { setPrices([]); }
    finally { setPending(false); }
  }
  if (prices?.length) return <div className="ccu-shop-price" title={t('Geprüfter RSI-Shoppreis')}>
    {prices.map(price => <div key={price.edition}>
      <strong>{formatMinor(price.amount.minor, price.amount.currency, language)}</strong>
      <span>{price.edition === 'warbond' ? 'Warbond' : t('Standard')}</span>
    </div>)}
  </div>;
  return <button type="button" className="ccu-price-check" disabled={pending}
    title={prices ? t('Preis erneut prüfen') : undefined} onClick={() => void checkPrice()}>
    {t(pending ? 'Preis wird geprüft …' : prices ? 'Preis offen' : 'Preis prüfen')}
  </button>;
}
