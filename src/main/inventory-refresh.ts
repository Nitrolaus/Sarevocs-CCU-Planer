import { DailyRefresh, type RefreshClock } from '../scheduling/daily-refresh';

/** Startup and one daily read of the selected profile. Never opens interactive authentication. */
export class InventoryRefresh {
  private readonly schedule: DailyRefresh;
  constructor(refresh: (accountId: string) => Promise<unknown>, selected: () => string | null,
    interactive: (accountId: string) => boolean, clock?: RefreshClock) {
    this.schedule = new DailyRefresh(async () => {
      const id = selected();
      if (id && !interactive(id)) await refresh(id);
    }, clock);
  }
  start() { this.schedule.start(); }
  close() { this.schedule.close(); }
}
