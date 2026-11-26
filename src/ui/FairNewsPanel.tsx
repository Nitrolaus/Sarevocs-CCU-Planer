import React, { useMemo, useState } from 'react';
import type { FairNews } from '../market/fair-news';
import type { TargetOffer } from '../market/model';
import type { ShipValues } from '../market/ship-values';
import { purchaseCandidates, type PurchaseRow } from '../planner/advisor';
import type { PricingSnapshot } from '../pricing/model';
import { estimatePlanningMinor, euroRateIsStale, formatMinor } from '../pricing/money';
import { useText } from './i18n';
import type { AdvisorContext } from './PlanningAdvisors';
import { useFairPurchaseAdvice } from './useFairPurchaseAdvice';
import { vatLabel } from './vat-label';

export type FairOfferRequest = { offerKey: string };

export function FairNewsPanel({ news, display, offers, values, advisors, pending, stale, onCheck, onSeen, outgoing }: {
  news?: FairNews; display: PricingSnapshot; pending: boolean; stale: boolean;
  offers: readonly TargetOffer[]; values?: ShipValues | null;
  advisors: Pick<AdvisorContext, 'signature' | 'input' | 'ready'>;
  onCheck: (key: string) => void; onSeen: (id: string) => Promise<void>;
  outgoing?: React.ReactNode;
}) {
  const t = useText();
  const [marking, setMarking] = useState<string | null>(null);
  const [seen, setSeen] = useState<string[]>([]);
  const [error, setError] = useState(false);
  const { settings, rate } = display;
  const notifications = useMemo(() => news?.unread.filter(notice => !seen.includes(notice.id)) ?? [], [news, seen]);
  const live = useMemo(() => {
    const result = new Map<string, { offer: TargetOffer & { warbondMinor: number }; candidates: ReturnType<typeof purchaseCandidates> }>();
    if (stale || !notifications.length) return result;
    const currentOffers = new Map(offers.filter(offer => offer.change !== 'missing').map(offer => [offer.key, offer]));
    for (const notice of notifications) {
      const offer = currentOffers.get(notice.offerKey);
      if (!offer || !offer.warbond || offer.warbondMinor === null || offer.warbondMinor <= 0
        || offer.warbondMinor >= offer.regularMinor || offer.warbondMinor !== notice.currentUsdMinor) continue;
      const active = { ...offer, warbondMinor: offer.warbondMinor };
      result.set(offer.key, { offer: active, candidates: purchaseCandidates({ current: true, pool: { values } }, active) });
    }
    return result;
  }, [notifications, offers, stale, values]);
  const advice = useFairPurchaseAdvice(advisors.ready ? advisors.input : null, advisors.signature,
    [...live.values()].filter(item => item.candidates.rows.length).map(item => item.offer));
  const localDate = new Intl.DateTimeFormat(settings.language === 'de' ? 'de-DE' : 'en-GB', {
    dateStyle: 'medium', timeZone: 'Europe/Berlin',
  });
  const sourceTime = new Intl.DateTimeFormat(settings.language === 'de' ? 'de-DE' : 'en-GB', {
    dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Berlin',
  });
  const freshRate = rate && !euroRateIsStale(rate) ? rate : null;
  const currency = settings.currency === 'EUR' && freshRate ? 'EUR' : 'USD';
  const usd = (minor: number) => formatMinor(minor, 'USD', settings.language);
  const money = (minor: number) => {
    const amount = estimatePlanningMinor(minor, { ...settings, currency }, freshRate)!;
    return (currency === 'EUR' ? '≈ ' : '') + formatMinor(amount, currency, settings.language);
  };
  const tax = settings.taxMode === 'gross' ? vatLabel(settings.vatBasisPoints, settings.language) : t('vor Steuer');
  function suggestion(row: PurchaseRow | undefined, offerKey: string) {
    const best = row?.best;
    if (best && best.benefitUsd !== null && best.benefitUsd > 0 && best.plan) {
      const steps = best.plan.steps;
      const index = steps.findIndex(step => step.purchaseQuote?.key === offerKey + ':' + row.candidate.ship.id);
      const step = steps[index];
      if (step) {
        const after = steps.slice(index + 1);
        const route = [step.from.name, step.to.name, ...(after.length > 2 ? [after[0]!.to.name, '…', best.target.name] : after.map(gap => gap.to.name))];
        return <><strong className="fair-fit">{best.target.name} · {money(best.benefitUsd)} {t('weniger Zukauf')}</strong><small>{route.join(' → ')}</small></>;
      }
    }
    switch (row?.status) {
      case 'equal': return t('Gleich teuer wie der bekannte Weg');
      case 'covered': return t('Bereits mit Bestand abgedeckt');
      case 'unhelpful': return t('Kein günstigerer Weg für deine Ziele');
      default: return t('Kettenvorteil noch ungeprüft');
    }
  }
  async function markSeen(id: string) {
    if (marking !== null) return;
    setMarking(id);
    setError(false);
    try {
      await onSeen(id);
      setSeen(previous => [...previous, id]);
    } catch { setError(true); }
    finally { setMarking(null); }
  }

  return <section className="fair-news panel" aria-labelledby="fair-news-title">
    <header className="fair-news-head">
      <div><h2 id="fair-news-title">{t('Messe-Info · Neue Warbond-CCUs')}</h2>
        {news?.exhibition && <small>{news.exhibition} · {notifications.length} {t('ungesehen')}</small>}
      </div>
      {news?.sourceAt && <small>{t('Datenstand')}: {sourceTime.format(new Date(news.sourceAt))}</small>}
    </header>
    {outgoing}
    <details className="fair-global-notices" open={outgoing ? undefined : true}><summary>{t('Weitere Messe-Meldungen')} ({notifications.length})</summary>
    {notifications.map((notice, index) => {
      const previous = notifications[index - 1];
      const showDay = !previous || previous.day !== notice.day;
      const entry = live.get(notice.offerKey);
      const seenButton = <button disabled={marking !== null} aria-label={t('Als gesehen markieren') + ': ' + notice.targetName}
        onClick={() => void markSeen(notice.id)}>{t('Gesehen')}</button>;
      const result = advice.get(notice.offerKey);
      const analyzed = result && result !== 'error' ? new Map(result.rows.map(row => [row.candidate.ship.id, row])) : null;
      const waiting = !advisors.input?.targets.length ? t('Wähle mindestens ein Zielschiff mit geladenem Bestand.')
        : !advisors.ready ? t('Wähle zuerst eine LTI-Startbasis für deine Ziele.')
        : result === 'error' ? t('Kettenprüfung fehlgeschlagen.') : t('Ketten werden geprüft …');
      return <React.Fragment key={notice.id}>
        {showDay && <h3 className="fair-news-day">{localDate.format(new Date(notice.day + 'T12:00:00Z'))}</h3>}
        {entry ? <article className="fair-offer fair-news-row" aria-label={notice.targetName}>
          <div className="fair-offer-head">
            <div><h4>{t('Upgrade auf')} {notice.targetName}</h4>
              <strong className="fair-saving">{money(entry.offer.regularMinor - entry.offer.warbondMinor)} {t('günstiger')}</strong>
              <small>{t('Regulärer Zielwert')} {money(entry.offer.regularMinor)} → <b>Warbond {money(entry.offer.warbondMinor)}</b></small>
              {currency === 'EUR' && <small>{usd(entry.offer.regularMinor)} → {usd(entry.offer.warbondMinor)} · {t('vor Steuer')}</small>}
            </div>
            {seenButton}
          </div>
          {entry.candidates.rows.length ? <table className="fair-candidates" aria-label={t('Ausgangsschiffe für') + ' ' + notice.targetName}>
            <thead><tr><th scope="col">{t('Ausgangsschiff bei RSI')}</th><th scope="col">Warbond-CCU</th><th scope="col">{t('Vorschlag für deine Ketten')}</th></tr></thead>
            <tbody>{entry.candidates.rows.map((candidate, i) => <tr key={candidate.ship.id}>
              <td><strong>{candidate.ship.name}</strong><small>{t('Schiffswert')} {money(entry.candidates.tier!)}</small></td>
              <td><strong className="fair-ccu-price">{money(candidate.usdMinor)}</strong>
                {currency === 'EUR' && <small>{usd(candidate.usdMinor)} · {t('vor Steuer')}</small>}</td>
              {analyzed ? <td>{suggestion(analyzed.get(candidate.ship.id), entry.offer.key)}</td>
                : i === 0 && <td rowSpan={entry.candidates.rows.length} className="fair-fit-status"><span role="status">{waiting}</span></td>}
            </tr>)}</tbody>
          </table> : <p className="fair-candidates-missing" role="status">{t(entry.candidates.reason === 'stale' ? 'RSI-Ausgangsschiffe fehlen oder sind veraltet.'
            : entry.candidates.reason === 'identity' ? 'Angebot und RSI-Schiffswerte nicht eindeutig zugeordnet.' : 'Kein Ausgangsschiff unter dem Warbond-Wert belegt.')}</p>}
          <div className="fair-offer-foot"><small>{entry.candidates.rows.length > 0 && <>{t('Nächstniedrigere Preisstufe')} · </>}{t('Richtwerte')} · {tax}</small>
            <button onClick={() => onCheck(notice.offerKey)}>{t('Für meine Kette prüfen')}</button></div>
        </article> : <div className="fair-expired fair-news-row">
          <div><strong>{notice.targetName}</strong><small>{t(stale || notice.currentUsdMinor !== null ? 'Aktueller Shopstand ungeprüft' : 'Nicht mehr verfügbar')}</small></div>
          <small>{t('Zuletzt beobachteter Warbond-Zielwert')} · {money(notice.usdMinor)} · {tax}</small>
          {seenButton}
        </div>}
      </React.Fragment>;
    })}
    {error && <p role="alert">{t('Meldung konnte nicht als gesehen gespeichert werden.')}</p>}
    {(pending || news?.status !== 'fresh' || notifications.length === 0) && <p role="status" className="fair-news-status">
      {pending ? t('Angebote werden abgefragt …')
        : news?.status === 'fresh' ? t('Heute keine ungesehenen neuen Warbonds.')
        : news?.status === 'inactive' ? t('Derzeit keine laufende Messe im Kalender.')
        : news?.status === 'waiting' ? t('Der Vergleich für die heutige Tagesrunde steht noch aus.')
        : t('Messe-Info wartet auf Kalender und einen vergleichbaren Angebotsstand.')}
    </p>}
    </details>
  </section>;
}
