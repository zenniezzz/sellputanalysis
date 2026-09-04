import { NextResponse } from 'next/server';
import { applyScreen, filtersFromQuery, filtersToQuery, type ScreenResult } from '@pss/screen';
import { getStore } from '@/app/lib/store';
import { screenContext } from '@/app/lib/session';
import { TtlLru } from '@/app/lib/screen-cache';

export const dynamic = 'force-dynamic';

const MAX_LIMIT = 1000;

// applyScreen is a synchronous O(rows) scan (~20-30ms at full universe size) —
// memo it per (snapshot, filters, watchlist) so a burst of identical requests
// (the common case: most visitors share the default filters) costs one scan.
const resultCache = new TtlLru<ScreenResult>(10_000, 200);

export async function GET(req: Request) {
  const store = await getStore();
  const snap = await store.latest();
  if (!snap) return NextResponse.json({ error: 'no snapshot' }, { status: 404 });

  const url = new URL(req.url);
  const filters = filtersFromQuery(url.searchParams);
  const ctx = await screenContext();

  const cacheKey = `${snap.meta.runId}::${filtersToQuery(filters).toString()}::${(ctx.watchlist ?? []).join(',')}`;
  let result = resultCache.get(cacheKey);
  if (!result) {
    result = applyScreen(snap.rows, filters, ctx);
    resultCache.set(cacheKey, result);
  }

  // pagination (plan §10.4): ?limit & ?cursor (opaque offset). Default: everything.
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(url.searchParams.get('limit')) || result.visible.length || 1));
  const cursor = Math.max(0, Number(url.searchParams.get('cursor')) || 0);
  const page = result.visible.slice(cursor, cursor + limit);
  const nextCursor = cursor + limit < result.visible.length ? String(cursor + limit) : null;

  return NextResponse.json(
    {
      meta: snap.meta,
      run: snap.run,
      filters,
      watchlist: ctx.watchlist ?? [],
      visible: page,
      counts: result.counts,
      nextCursor,
      nearestMatches: result.nearestMatches,
      // NOTE: excludedBy (per-contract failed-filter reasons) is intentionally
      // not shipped here — nothing on the client reads it (the "why isn't X
      // here?" panel calls /api/explain for one symbol instead) and serializing
      // it for every priced-but-excluded contract dominated response size/CPU
      // under load (M6.8 k6 finding). Use @pss/screen's applyScreen() directly,
      // or GET /api/explain?symbol=..., if you need it.
    },
    {
      // snapshots change ~once a day; let a CDN absorb bursts (varies by the
      // signed-in user's watchlist, hence Vary: Cookie)
      headers: {
        'cache-control': 'public, s-maxage=15, stale-while-revalidate=60',
        vary: 'Cookie',
      },
    },
  );
}
