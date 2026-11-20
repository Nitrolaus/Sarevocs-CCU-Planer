import type { PricingSnapshot } from '../pricing/model';
import { euroRateIsStale, matchesShopAmount } from '../pricing/money';
import { translate } from './i18n';

export function planningRateLabel(display: PricingSnapshot): string {
  const { language } = display.settings;
  const hasShopPrice = display.shopPrices?.some(row => matchesShopAmount(display.settings, row.amount));
  if (!display.rate || euroRateIsStale(display.rate)) return translate(language, hasShopPrice ? 'RSI-Shoppreis' : 'Euro-Kurs fehlt');
  const locale = language === 'de' ? 'de-DE' : 'en-GB';
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' })
    .format(new Date(display.rate.sourceDate + 'T00:00:00Z'));
  const source = translate(language, hasShopPrice ? 'RSI-Shoppreis, sonst EZB-Richtwert' : 'EZB-Richtwert');
  return source + ' · ' + date;
}
