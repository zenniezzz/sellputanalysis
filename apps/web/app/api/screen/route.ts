import { NextResponse } from 'next/server';
import { applyScreen, filtersFromQuery } from '@pss/screen';
import { getStore } from '@/app/lib/store';
import { screenContext } from '@/app/lib/session';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const store = await getStore();
  const snap = await store.latest();
  if (!snap) return NextResponse.json({ error: 'no snapshot' }, { status: 404 });

  const filters = filtersFromQuery(new URL(req.url).searchParams);
  const ctx = await screenContext();
  const result = applyScreen(snap.rows, filters, ctx);

  return NextResponse.json({
    meta: snap.meta,
    run: snap.run,
    filters,
    watchlist: ctx.watchlist ?? [],
    visible: result.visible,
    counts: result.counts,
    nearestMatches: result.nearestMatches,
    excludedBy: Object.fromEntries(result.excludedBy),
  });
}
