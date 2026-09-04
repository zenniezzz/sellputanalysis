import { NextResponse } from 'next/server';
import { applyScreen, filtersFromQuery } from '@pss/screen';
import { getStore } from '@/app/lib/store';
import { screenContext } from '@/app/lib/session';

export const dynamic = 'force-dynamic';

const MAX_LIMIT = 1000;

export async function GET(req: Request) {
  const store = await getStore();
  const snap = await store.latest();
  if (!snap) return NextResponse.json({ error: 'no snapshot' }, { status: 404 });

  const url = new URL(req.url);
  const filters = filtersFromQuery(url.searchParams);
  const ctx = await screenContext();
  const result = applyScreen(snap.rows, filters, ctx);

  // pagination (plan §10.4): ?limit & ?cursor (opaque offset). Default: everything.
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(url.searchParams.get('limit')) || result.visible.length || 1));
  const cursor = Math.max(0, Number(url.searchParams.get('cursor')) || 0);
  const page = result.visible.slice(cursor, cursor + limit);
  const nextCursor = cursor + limit < result.visible.length ? String(cursor + limit) : null;

  return NextResponse.json({
    meta: snap.meta,
    run: snap.run,
    filters,
    watchlist: ctx.watchlist ?? [],
    visible: page,
    counts: result.counts,
    nextCursor,
    nearestMatches: result.nearestMatches,
    excludedBy: Object.fromEntries(result.excludedBy),
  });
}
