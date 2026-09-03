import { NextResponse } from 'next/server';
import { applyScreen, filtersFromQuery } from '@pss/screen';
import { getStore } from '@/app/lib/store';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const store = await getStore();
  const snap = await store.latest();
  if (!snap) return NextResponse.json({ error: 'no snapshot' }, { status: 404 });

  const filters = filtersFromQuery(new URL(req.url).searchParams);
  const result = applyScreen(snap.rows, filters);

  return NextResponse.json({
    meta: snap.meta,
    run: snap.run,
    filters,
    visible: result.visible,
    counts: result.counts,
    nearestMatches: result.nearestMatches,
    excludedBy: Object.fromEntries(result.excludedBy),
  });
}
