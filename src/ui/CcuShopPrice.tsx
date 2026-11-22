import React from 'react';
import type { CatalogueShip } from '../market/model';
import type { ShopPair, ShopPrice } from '../market/shop-prices';
import { catalogueIdentity } from '../market/ship-values';
import { displayShopMinor, formatMinor, type EuroRate } from '../pricing/money';
import type { DisplaySettings } from '../pricing/model';
import { useText } from './i18n';

export function ccuShopPair(from: string, to: string, catalogue: readonly CatalogueShip[]): ShopPair | null {
  const fromId = catalogueIdentity(from, catalogue)?.id;
  const toId = catalogueIdentity(to, catalogue)?.id;
  return fromId && toId && fromId !== toId ? { fromId, toId } : null;
}

export type DisplayShopPrice = ShopPrice & { current: boolean };

export function CcuShopPrice({ prices, settings, rate }: {
  prices: readonly DisplayShopPrice[];
  settings: DisplaySettings;
  rate: EuroRate | null;
}) {
  const t = useText();
  if (!prices.length) return <span>{t('Preis offen')}</span>;
  const { language, currency } = settings;
  const time = new Intl.DateTimeFormat(language === 'de' ? 'de-DE' : 'en-GB', {
    dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Berlin',
  });
  return <div className="ccu-shop-price">
    {(['standard', 'warbond'] as const).map(edition => {
      const entries = prices.filter(price => price.edition === edition).map(price => ({
        price,
        converted: price.amount.currency !== currency,
        minor: displayShopMinor(price.amount, settings, rate),
      }));
      entries.sort((a, b) => Number(a.minor === null) - Number(b.minor === null) ||
        Number(b.price.current) - Number(a.price.current) || Number(a.converted) - Number(b.converted));
      const selected = entries[0];
      if (!selected) return null;
      const { price, converted, minor } = selected;
      const checkedAt = time.format(price.checkedAt);
      const original = formatMinor(price.amount.minor, price.amount.currency, language);
      const source = t(price.current ? 'Geprüfter RSI-Shoppreis' : 'Zuletzt bestätigter RSI-Shoppreis');
      const rateNote = minor === null ? t('EZB-Kurs nicht verfügbar') : t('EZB-Richtwert');
      return <div key={edition} data-ecb-estimate={converted && minor !== null ? '' : undefined}
        title={`${source} · ${original} · ${checkedAt}${converted ? ' · ' + rateNote : ''}`}>
        <strong>{minor === null ? t('Preis offen') : (converted ? '≈ ' : '') + formatMinor(minor, currency, language)}</strong>
        <span>{edition === 'warbond' ? 'Warbond' : t('Standard')}</span>
        {!price.current && <small>{t('Letzter Stand')} · {checkedAt}</small>}
      </div>;
    })}
  </div>;
}
