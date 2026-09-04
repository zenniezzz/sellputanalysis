import Link from 'next/link';

export const metadata = { title: 'API — Put-Sell Screener' };

const rows: [string, string][] = [
  ['GET /api/screen', 'Screened candidates for the latest snapshot. Accepts every filter param (see the URL of a filtered screen). Pagination: ?limit & ?cursor → { visible, nextCursor }. Also returns meta, run, counts, nearestMatches. Per-contract exclusion reasons are not included here — use /api/explain for one ticker.'],
  ['GET /api/universe', 'Per-underlying rollup for the latest snapshot.'],
  ['GET /api/explain?symbol=NVDA&<filters>', 'Per-contract pass/fail for one ticker: pipeline-stage exclusion vs which user filters it fails.'],
  ['GET /api/export?format=csv|json&<filters>', 'Download the current screen (40 columns).'],
  ['GET /api/snapshots', 'List recent snapshots (metadata).'],
  ['GET /api/snapshots/diff?a=<runId>&b=<runId>', 'Candidate-set diff: added / dropped (+reason) / rank moves with score, EV and IV-rank deltas.'],
  ['POST /api/comparisons  { occSymbols, snapshotRunId? }', 'Freeze a comparison → { id, url }. Anonymous allowed.'],
  ['GET /api/comparisons/<id>', 'A frozen comparison + its snapshot rows.'],
  ['GET /api/compare-export?ids=<id>&format=csv|html', 'CSV or print-to-PDF of a frozen comparison.'],
  ['GET/POST /api/bookmarks · DELETE /api/bookmarks/<id>', 'Snapshot bookmarks (sign-in required to write).'],
  ['GET/POST/PUT/DELETE /api/screens', 'Saved named screens (sign-in required to write).'],
  ['GET/PUT /api/watchlist', 'The signed-in user’s watchlist.'],
];

export default function DocsPage() {
  return (
    <article style={{ maxWidth: '80ch', margin: '0 auto', padding: '8px 0 60px', lineHeight: 1.6 }}>
      <p>
        <Link href="/">← Screener</Link> · <Link href="/glossary">Glossary</Link> ·{' '}
        <Link href="/method">Model &amp; method</Link>
      </p>
      <h1 style={{ fontSize: 20 }}>Read API</h1>
      <p>
        All routes are JSON, read against the latest snapshot unless a run id is given, and require no
        auth for reads. Filter params match the screener URL query string.
      </p>
      <div className="tablewrap" style={{ marginTop: 12 }}>
        <table className="grid">
          <thead>
            <tr>
              <th className="sym">Endpoint</th>
              <th className="sym">Returns</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([e, d]) => (
              <tr key={e}>
                <td className="sym" style={{ whiteSpace: 'normal', fontWeight: 600 }}>
                  {e}
                </td>
                <td className="sym" style={{ whiteSpace: 'normal', color: 'var(--ink-dim)' }}>
                  {d}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}
