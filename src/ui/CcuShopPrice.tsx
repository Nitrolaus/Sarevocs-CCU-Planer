import React from 'react';
import type { CatalogueShip } from '../market/model';
import type { ShopPair, ShopPrice } from '../market/shop-prices';
import { catalogueIdentity } from '../market/ship-values';
import { formatMinor } from '../pricing/money';
import { useText } from './i18n';

export function ccuShopPair(from: string, to: string, catalogue: readonly CatalogueShip[]): ShopPair | null {
  const fromId = catalogueIdentity(from, catalogue)?.id;
  const toId = catalogueIdentity(to, catalogue)?.id;
  return fromId && toId && fromId !== toId ? { fromId, toId } : null;
}

export type DisplayShopPrice = ShopPrice & { current: boolean };

export function CcuShopPrice({ prices, language }: { prices: readonly DisplayShopPrice[]; language: 'de' | 'en' }) {
  const t = useText();
  if (!prices.length) return <span>{t('Preis offen')}</span>;
  const time = new Intl.DateTimeFormat(language === 'de' ? 'de-DE' : 'en-GB', {
    dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Berlin',
  });
  return <div className="ccu-shop-price">
    {prices.map(price => {
      const checkedAt = time.format(price.checkedAt);
      return <div key={price.edition} title={`${t(price.current ? 'Geprüfter RSI-Shoppreis' : 'Zuletzt bestätigter RSI-Shoppreis')} · ${checkedAt}`}>
        <strong>{formatMinor(price.amount.minor, price.amount.currency, language)}</strong>
        <span>{price.edition === 'warbond' ? 'Warbond' : t('Standard')}</span>
        {!price.current && <small>{t('Letzter Stand')} · {checkedAt}</small>}
      </div>;
    })}
  </div>;
}
