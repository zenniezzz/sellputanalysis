import { applyScreen, filtersFromQuery } from '@pss/screen';
import { CandidatesView } from './components/CandidatesView';
import { getStore } from './lib/store';
import { searchParamsToUrl } from './lib/format';
import { currentUser, screenContext } from './lib/session';

export const dynamic = 'force-dynamic';

export default async function Page({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const store = await getStore();
  const snap = await store.latest();

  if (!snap) {
    return (
      <div className="empty">
        <h1>Put-Sell Screener</h1>
        <p>
          No snapshot yet. Run <code>npm run cli:run-snapshot -- --limit 20</code> at the repo root,
          then reload.
        </p>
      </div>
    );
  }

  const filters = filtersFromQuery(searchParamsToUrl(searchParams));
  const ctx = await screenContext();
  const result = applyScreen(snap.rows, filters, ctx);
  const user = await currentUser();

  return (
    <CandidatesView
      user={user ? { email: user.email ?? null } : null}
      watchlist={ctx.watchlist ?? []}
      initial={{
        meta: snap.meta,
        run: snap.run,
        filters,
        watchlist: ctx.watchlist ?? [],
        visible: result.visible,
        counts: result.counts,
        nearestMatches: result.nearestMatches,
        excludedBy: Object.fromEntries(result.excludedBy),
      }}
    />
  );
}
