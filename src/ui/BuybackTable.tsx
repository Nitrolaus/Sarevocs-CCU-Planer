import React from 'react';
import type { Buyback, BuybackObservation } from '../domain/model';
import type { StoreCredit } from '../domain/store-credit';
import { convertPurchaseValue } from '../pricing/inventory-values';
import type { PricingSnapshot } from '../pricing/model';
import { formatMinor } from '../pricing/money';
import { useText } from './i18n';
import './buyback.css';

export function BuybackTable({ entries, observation, display, balance }: {
  entries: readonly Buyback[]; observation?: BuybackObservation; display: PricingSnapshot; balance?: StoreCredit;
}) {
  const t = useText();
  const { language, currency } = display.settings;
  const token = observation?.current ? observation.token : 'unknown';
  const tokenLabel = token === 'available' ? 'Token verfügbar' : token === 'unavailable' ? 'Kein Token verfügbar' : 'Tokenstatus offen';
  const source = observation ? new Intl.DateTimeFormat(language === 'de' ? 'de-DE' : 'en-GB', {
    dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Berlin',
  }).format(new Date(observation.observedAt)) : null;
  const creditLabel = token === 'unavailable' ? 'Nur Frischgeld' : token === 'available'
    ? balance?.minor === 0 ? 'Kein Guthaben' : 'Ja, mit Token' : 'Offen';

  return <section className="buyback-view" aria-labelledby="buyback-heading">
    <div className="buyback-head">
      <div><h2 id="buyback-heading">Buy Back</h2><small>{entries.length} {t(entries.length === 1 ? 'Rückkaufeintrag' : 'Rückkaufeinträge')}
        {source && <> · {t(observation?.current ? 'Gelesen' : 'Letzter gelesener Stand')} {source}</>}</small></div>
      <span className={'badge' + (token === 'available' ? '' : ' unknown')}>{t(tokenLabel)}</span>
    </div>
    {entries.length === 0 ? <div className="buyback-empty" role="status">
      <strong>{t(observation ? 'Keine Rückkaufeinträge gefunden' : 'Rückkaufliste noch nicht eingelesen')}</strong>
      <p>{t(observation?.current ? 'Die gelesene RSI-Rückkaufliste für dieses Profil ist leer.' : observation
        ? 'Die zuletzt gelesene RSI-Rückkaufliste war leer.' : 'Aktualisiere den Bestand mit einer vorhandenen RSI-Sitzung oder importiere eine Datei mit Rückkaufeinträgen.')}</p>
    </div> : <>
      <div className="table-scroll"><table className="buyback-table" aria-label={t('Rückkaufeinträge')}>
        <thead><tr><th scope="col">{t('Schiff / Paket')}</th><th scope="col">{t('Versicherung')}</th><th scope="col">{t('Rückkaufpreis')}</th><th scope="col">Store Credits</th></tr></thead>
        <tbody>{entries.map(entry => {
          const price = entry.currentPrice, converted = convertPurchaseValue(price, display);
          const ships = entry.originalShips?.join(', ');
          const taxLabel = price ? t(price.taxBasis === 'net' ? 'vor Steuer' : price.taxBasis === 'gross' ? 'brutto' : 'Steuerbasis unbekannt') : '';
          const amount = price ? formatMinor(price.minor, price.currency, language) : '';
          return <tr key={entry.entryId}>
            <td><strong>{ships || entry.name}</strong>{ships && ships !== entry.name && <small>{entry.name}</small>}</td>
            <td>{entry.insurance?.kind === 'lti' ? <span className="badge">LTI</span>
              : entry.insurance?.kind === 'months' ? `${entry.insurance.months} ${t('Monate')}` : <span className="buyback-open">{t('Offen')}</span>}</td>
            <td>{price ? <><strong className="buyback-price">{converted.minor === null || price.currency === currency ? amount
              : `≈ ${formatMinor(converted.minor, currency, language)}`}</strong><small>{price.currency !== currency && converted.minor !== null && <>{amount} · </>}{taxLabel}</small></>
              : <span className="buyback-open">{t('Preis offen')}</span>}</td>
            <td><span className={'badge' + (creditLabel === 'Ja, mit Token' ? '' : ' unknown')}>{t(creditLabel)}</span>
              {token === 'unknown' && <small>{t('Bei RSI prüfen')}</small>}</td>
          </tr>;
        })}</tbody>
      </table></div>
      <p className="buyback-note">{t('Ein Token gilt für einen Rückkauf mit Store Credits.')}</p>
    </>}
  </section>;
}
