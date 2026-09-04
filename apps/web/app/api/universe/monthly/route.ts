import { NextResponse } from 'next/server';
import { getStore } from '@/app/lib/store';
import { aggregateMonthlyPutVolume, type DaySnapshot } from '@/app/lib/monthly-put-volume';

export const dynamic = 'force-dynamic';

const WINDOW_DAYS = 30;
// generous vs. plan §3.7's 3 scheduled runs/day + on-demand refreshes, so a
// 30-day window is comfortably covered even on a busy day
const META_LIMIT = 400;

/**
 * Top-25-by-put-volume, averaged over the trailing 30 days (vs. /api/universe,
 * which is a single day). One run per calendar day (the latest non-failed
 * one) to avoid double-counting a day with several scheduled/on-demand runs.
 * "Weekly" is inherent, not a separate mechanism: this always reflects
 * whatever's in the store right now, so it rolls forward continuously as new
 * daily snapshots land — at least as fresh as a weekly refresh, never staler.
 */
export async function GET() {
  const store = await getStore();
  const metas = await store.list(META_LIMIT);
  const cutoff = Date.now() - WINDOW_DAYS * 86_400_000;

  // metas are newest-first, so the first non-failed meta seen for a given
  // day is already that day's most recent run
  const byDay = new Map<string, string>(); // snapshotDay -> runId
  for (const m of metas) {
    if (m.status === 'failed') continue;
    if (Date.parse(m.createdAt) < cutoff) continue;
    if (!byDay.has(m.snapshotDay)) byDay.set(m.snapshotDay, m.runId);
  }

  const days: DaySnapshot[] = [];
  for (const [day, runId] of byDay) {
    const snap = await store.getByRunId(runId);
    // older snapshots (pre the universe rollup, plan §8.2/M6) don't have this
    // field on disk at all, not even as an empty array — skip rather than
    // let one legacy day 500 the whole trailing window. Skipping (not
    // defaulting to []) also keeps `daysAvailable` honest: it should count
    // days that actually contributed put-volume data, not just days that
    // happened to have *some* snapshot.
    if (snap?.universe && snap.universe.length > 0) days.push({ day, universe: snap.universe });
  }

  const result = aggregateMonthlyPutVolume(days, { windowDays: WINDOW_DAYS, top: 25 });
  return NextResponse.json(result, {
    headers: { 'cache-control': 'public, s-maxage=300, stale-while-revalidate=1800' },
  });
}
