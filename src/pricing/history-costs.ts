import type { Pledge, RsiPurchase } from '../domain/model';
import type { UpgradeHistoryStep } from '../domain/upgrade-history';
import type { MarketSnapshot } from '../market/model';
import { sameModelName } from '../market/ship-values';
import { convertPurchaseValue, currentShipValues, RSI_ORDER_PRICE, standaloneModel } from './inventory-values';
import type { PricingSnapshot } from './model';
import { estimatePlanningMinor, euroRateIsStale } from './money';

export function historyCosts(pledge: Pledge, steps: readonly { step: UpgradeHistoryStep; price?: RsiPurchase }[],
  partial: boolean, display: PricingSnapshot, market?: MarketSnapshot) {
  const settings = { ...display.settings, taxMode: 'gross' as const };
  const grossDisplay = { ...display, settings };
  const catalogue = market?.catalogue?.ships ?? [];
  const original = standaloneModel(pledge);
  const start = steps[0]?.step.from;
  const last = steps.at(-1)?.step.to;
  const ship = pledge.ships.length === 1 ? pledge.ships[0] : undefined;
  const target = ship && last && sameModelName(last, ship.modelName, catalogue) ? ship.modelName : undefined;
  const baseMatches = !!ship && !!start && !!original && sameModelName(original, start, catalogue);
  const continuous = !partial && !!target && steps.every(({ step }, index) =>
    step.appliedAt && (index === 0 || sameModelName(steps[index - 1]!.step.to, step.from, catalogue)));

  let knownMinor = 0;
  let approximate = false;
  function include(receipt?: RsiPurchase): boolean {
    if (receipt?.status !== 'documented' || receipt.source !== 'order') return false;
    const cost = convertPurchaseValue({ minor: receipt.minor, currency: receipt.currency,
      taxBasis: 'unknown', evidence: RSI_ORDER_PRICE, purchaseDate: receipt.purchaseDate, poundRate: receipt.poundRate }, grossDisplay);
    if (cost.minor === null) return false;
    knownMinor += cost.minor;
    approximate ||= cost.approximate;
    return true;
  }

  const basePaid = baseMatches && include(pledge.rsiPurchase);
  const counted = new Set<string>();
  let allCcusPaid = true;
  for (const { step, price } of steps) {
    const id = step.ccuPledgeId;
    if (!id || counted.has(id)) {
      allCcusPaid = false;
      continue;
    }
    counted.add(id);
    if (!include(price)) allCcusPaid = false;
  }

  const paid = continuous && basePaid && allCcusPaid ? knownMinor : null;
  const referenceUsd = target ? currentShipValues(pledge, market)[0]?.usdMinor : null;
  const rate = display.rate && !euroRateIsStale(display.rate) ? display.rate : null;
  const normal = estimatePlanningMinor(referenceUsd, settings, rate);
  const difference = normal !== null && paid !== null ? normal - paid : null;
  const percentage = difference !== null && normal !== null && normal > 0 ? Math.round(Math.abs(difference) * 100 / normal) : null;
  return { start, target, knownMinor, approximate, paid, normal, difference, percentage };
}
