import { applyScreen, filtersFromQuery, screenedRowsToCsv } from '@pss/screen';
import { getStore } from '@/app/lib/store';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const store = await getStore();
  const snap = await store.latest();
  if (!snap) return new Response('no snapshot', { status: 404 });

  const format = url.searchParams.get('format') ?? 'csv';
  const filters = filtersFromQuery(url.searchParams);
  const result = applyScreen(snap.rows, filters);
  const stamp = snap.meta.runId;

  if (format === 'json') {
    return new Response(
      JSON.stringify({ meta: snap.meta, run: snap.run, filters, candidates: result.visible }, null, 2),
      { headers: { 'content-type': 'application/json', 'content-disposition': `attachment; filename="${stamp}.json"` } },
    );
  }
  return new Response(screenedRowsToCsv(result.visible), {
    headers: { 'content-type': 'text/csv', 'content-disposition': `attachment; filename="${stamp}.csv"` },
  });
}
