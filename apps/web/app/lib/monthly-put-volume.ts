/**
 * Trailing put-volume leaderboard (pure aggregation — no I/O, no `server-only`,
 * safe to unit-test directly). One snapshot's `universe` rollup is a single
 * day's in-window put volume per name; this pools several days of it into an
 * average, which is what "top by put volume over the last month" actually
 * means — a single day (today's `TopPutVolume`) is a snapshot, this is a
 * trend.
 */
import type { UniverseRow } from '@pss/pipeline';

export interface DaySnapshot {
  day: string; // YYYY-MM-DD
  universe: UniverseRow[];
}

export interface MonthlyPutVolumeRow {
  symbol: string;
  sector: string | null;
  /** Most recent known spot price across the days used. */
  spot: number;
  avgPutVolume: number;
  totalPutVolume: number;
  /** How many distinct days within the window actually had this symbol priced. */
  daysUsed: number;
}

export interface MonthlyPutVolumeResult {
  rows: MonthlyPutVolumeRow[];
  windowDays: number;
  /** Distinct snapshot-days found within the window, across all names (not per-symbol). */
  daysAvailable: number;
  oldestDay: string | null;
  newestDay: string | null;
}

/**
 * `days` should already be de-duplicated to one entry per calendar day
 * (picking whichever run of that day to use is the caller's call — this
 * function just pools whatever it's handed).
 */
export function aggregateMonthlyPutVolume(
  days: DaySnapshot[],
  opts: { windowDays?: number; top?: number } = {},
): MonthlyPutVolumeResult {
  const windowDays = opts.windowDays ?? 30;
  const top = opts.top ?? 25;

  // ascending by day, so "the last write wins" for sector/spot naturally
  // lands on the most recent day a symbol was seen
  const sorted = [...days].sort((a, b) => a.day.localeCompare(b.day));
  const byOccurrence = new Map<
    string,
    { sector: string | null; spot: number; total: number; count: number }
  >();

  for (const { universe } of sorted) {
    for (const u of universe) {
      const entry = byOccurrence.get(u.symbol) ?? { sector: null, spot: 0, total: 0, count: 0 };
      entry.sector = u.sector;
      entry.spot = u.spot;
      entry.total += u.inWindowPutVolume;
      entry.count += 1;
      byOccurrence.set(u.symbol, entry);
    }
  }

  const rows: MonthlyPutVolumeRow[] = [...byOccurrence.entries()]
    .map(([symbol, e]) => ({
      symbol,
      sector: e.sector,
      spot: e.spot,
      totalPutVolume: e.total,
      avgPutVolume: e.total / e.count,
      daysUsed: e.count,
    }))
    .sort((a, b) => b.avgPutVolume - a.avgPutVolume)
    .slice(0, top);

  return {
    rows,
    windowDays,
    daysAvailable: sorted.length,
    oldestDay: sorted[0]?.day ?? null,
    newestDay: sorted[sorted.length - 1]?.day ?? null,
  };
}
