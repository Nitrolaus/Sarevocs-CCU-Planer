import type { Pledge } from './model';

/** The imported pledge title must explicitly mark the ship as a giveaway. */
export function giveawayShip(pledge: Pick<Pledge, 'name' | 'ships'>) {
  if (/\bgiveaway\b/i.test(pledge.name)) return pledge.ships.find(ship => ship.role !== 'loaner');
  return undefined;
}
