import type { CatalogueShip, TargetOffer } from '../market/model';
import type { PricingSnapshot } from '../pricing/model';
import { selectedStartBase, withStartBase } from './bases';
import { buildChain, type ChainPlan, type ChainPool } from './chain';
import type { PlannerDraft } from './draft';
import { manualChain, type ManualPlan } from './manual';
import {
  analyseReservations, availableForTarget, blockedForTarget, blockingPlanResources, DEFAULT_PRIORITIES,
  type ReservationTarget,
} from './reservations';

export type FleetGoal = { slot: number; ship: CatalogueShip; draft?: PlannerDraft };
export type FleetRoute = ReservationTarget & { ship: CatalogueShip; plan: ChainPlan | ManualPlan | null };
type FleetInputs = { pool: ChainPool; ships: readonly CatalogueShip[]; offers: readonly TargetOffer[]; current: boolean; display?: PricingSnapshot };

/** The workbench and the fleet comparison share fixed slot priority and the same draft rules. */
export function planFleetRoutes(goals: readonly FleetGoal[], { pool, ships, offers, current, display }: FleetInputs): FleetRoute[] {
  const routes: FleetRoute[] = [];
  for (const slot of DEFAULT_PRIORITIES) {
    const goal = goals.find(item => item.slot === slot);
    if (!goal) continue;
    const { ship, draft } = goal;
    const base = draft && selectedStartBase(pool, draft);
    let plan: FleetRoute['plan'] = null;
    let noPricedRoute = false;
    if (draft && base) {
      const scoped = withStartBase(pool, base.key);
      const higher = analyseReservations(routes).resources;
      if (draft.mode === 'manual') {
        plan = manualChain(scoped, ship, ships, offers, current, draft, higher);
      } else {
        const available = availableForTarget(scoped, higher);
        plan = buildChain(available, ship, offers, current, base.key, display);
        noPricedRoute = !plan && !available.limited && available.bases.length > 0;
      }
    }
    routes.push({ slot, targetId: ship.id, name: ship.name, ship, plan, noPricedRoute });
  }
  return routes;
}

export function fleetScenarios(goals: readonly FleetGoal[], combined: readonly FleetRoute[], inputs: FleetInputs) {
  const singles = combined.map(route => ({
    key: String(route.slot),
    routes: [route === combined[0] ? route : planFleetRoutes(goals.filter(goal => goal.slot === route.slot), inputs)[0]!] as const,
  }));
  if (singles.length < 2) return { cases: singles, assignments: [] };

  const reservations = analyseReservations(combined);
  const assignments = singles.flatMap(({ routes: [solo] }, index) => {
    const route = combined[index]!;
    const shared = blockingPlanResources(solo.plan, blockedForTarget(reservations, solo.targetId)).filter(claim => {
      if (claim.kind === 'base') return true;
      const held = solo.plan?.steps.find(step => step.ccu?.key === claim.key);
      return !route.plan?.steps.some(step => step.kind === 'owned' && step.ccu && step.ccu.key !== claim.key
        && step.from.key === held?.from.key && step.to.key === held?.to.key);
    });
    return shared.length ? [{ target: solo, shared, route }] : [];
  });
  return { cases: [...singles, { key: 'combined', routes: combined }], assignments };
}
