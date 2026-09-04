import Link from 'next/link';
import { notFound } from 'next/navigation';
import { pnlProfile, type PnlProfile } from '@pss/options';
import type { ScreenedRow } from '@pss/screen';
import { resolveComparison } from '@/app/lib/compare-rows';
import { compareTable } from '@/app/lib/compare-shape';
import { pct, usd0 } from '@/app/lib/format';

export const dynamic = 'force-dynamic';

const SERIES_COLORS = ['var(--accent)', 'var(--warn)', 'var(--bad)', '#7aa5e0', '#c58ae0', '#e0c07a'];

export default async function ComparePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const resolved = await resolveComparison(id);
  if (!resolved) notFound();

  const { frozen, meta, rows, missing } = resolved;
  const table = compareTable(rows);
  const created = new Date(frozen.createdAt).toISOString().slice(0, 16).replace('T', ' ');
  const exportBase = `/api/compare-export?ids=${encodeURIComponent(frozen.id)}`;

  const series = rows
    .map((r, i) => ({ label: `${r.symbol} P${r.strike}`, color: SERIES_COLORS[i % SERIES_COLORS.length]!, profile: profileFor(r) }))
    .filter((s): s is { label: string; color: string; profile: PnlProfile } => s.profile != null);

  // Flatten metric rows into a render list, inserting a header when the group changes.
  const seenGroups = new Set<string>();
  const renderList: (
    | { kind: 'group'; group: string }
    | { kind: 'metric'; row: (typeof table.rows)[number] }
  )[] = [];
  for (const row of table.rows) {
    if (!seenGroups.has(row.group)) {
      seenGroups.add(row.group);
      renderList.push({ kind: 'group', group: row.group });
    }
    renderList.push({ kind: 'metric', row });
  }

  return (
    <>
      <div className="toolbar">
        <h1>Frozen comparison</h1>
        <span className="meta">
          snapshot <code>{meta.runId}</code> · frozen {created} UTC · {rows.length} contract
          {rows.length === 1 ? '' : 's'}
        </span>
        <span className={`badge ${meta.status}`}>{meta.status}</span>
        <span style={{ flex: 1 }} />
        <Link className="btn" href="/">
          ← Screener
        </Link>
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <a className="btn" href={`${exportBase}&format=csv`}>
          Download CSV
        </a>
        <a className="btn" href={`${exportBase}&format=html`} target="_blank" rel="noopener noreferrer">
          Print / PDF
        </a>
      </div>

      {missing.length > 0 && (
        <p style={{ color: 'var(--bad)', fontSize: 12 }}>
          Not present in this snapshot: {missing.join(', ')}
        </p>
      )}

      {rows.length === 0 ? (
        <p className="empty">None of the frozen contracts resolved against this snapshot.</p>
      ) : (
        <>
          <div className="tablewrap">
            <table className="grid">
              <thead>
                <tr>
                  <th className="sym">metric</th>
                  {table.contracts.map((c) => (
                    <th key={c.occSymbol}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {renderList.map((item) =>
                  item.kind === 'group' ? (
                    <tr key={`g-${item.group}`}>
                      <td
                        className="sym"
                        colSpan={table.contracts.length + 1}
                        style={{
                          textTransform: 'uppercase',
                          letterSpacing: '.06em',
                          fontSize: 10,
                          color: 'var(--ink-faint)',
                          paddingTop: 10,
                        }}
                      >
                        {item.group}
                      </td>
                    </tr>
                  ) : (
                    <tr key={item.row.key}>
                      <td className="sym">
                        {item.row.label}
                        {item.row.higherBetter != null && (
                          <span style={{ color: 'var(--ink-faint)', marginLeft: 4 }}>
                            {item.row.higherBetter ? '▲' : '▼'}
                          </span>
                        )}
                      </td>
                      {item.row.cells.map((c) => (
                        <td
                          key={c.occSymbol}
                          style={
                            c.best
                              ? { background: 'var(--accent-dim)', color: 'var(--ink)', fontWeight: 700 }
                              : undefined
                          }
                        >
                          {c.formatted}
                        </td>
                      ))}
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>

          {series.length > 0 && (
            <div className="panel" style={{ padding: 14, marginTop: 16 }}>
              <div
                style={{
                  fontSize: 10,
                  textTransform: 'uppercase',
                  letterSpacing: '.08em',
                  color: 'var(--ink-faint)',
                  marginBottom: 6,
                }}
              >
                P&amp;L to expiry — overlaid
              </div>
              <CompareCone series={series} />
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 6, font: '11px var(--mono)' }}>
                {series.map((s) => (
                  <span key={s.label} style={{ color: 'var(--ink-dim)' }}>
                    <span style={{ color: s.color }}>■</span> {s.label} · EV{' '}
                    {usd0(s.profile.expectedPnl100)} · PoP {pct(s.profile.probProfit)}
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <p className="disclaimer">
        Screening tool, not investment advice. Selling puts — cash-secured or on margin — carries
        substantial loss potential if the underlying falls sharply. This is a frozen snapshot; data
        may be delayed or stale.
      </p>
    </>
  );
}

function profileFor(row: ScreenedRow): PnlProfile | null {
  if (
    row.spotAdj == null ||
    row.entryCredit == null ||
    row.sigmaF == null ||
    row.mu == null ||
    row.dte <= 0
  )
    return null;
  return pnlProfile({
    sAdj: row.spotAdj,
    k: row.strike,
    entryCredit: row.entryCredit,
    mu: row.mu,
    sigmaF: row.sigmaF,
    t: row.dte / 365,
    multiplier: row.multiplier,
    points: 160,
  });
}

const CW = 720;
const CH = 260;
const CM = { top: 14, right: 16, bottom: 28, left: 54 };

function CompareCone({
  series,
}: {
  series: { label: string; color: string; profile: PnlProfile }[];
}) {
  const allX = series.flatMap((s) => s.profile.points.map((p) => p.sT));
  const allY = series.flatMap((s) => s.profile.points.map((p) => p.pnl100));
  const xmin = Math.min(...allX);
  const xmax = Math.max(...allX);
  const ymin = Math.min(...allY, 0);
  const ymax = Math.max(...allY, 0);
  const px = (v: number) => CM.left + ((v - xmin) / (xmax - xmin)) * (CW - CM.left - CM.right);
  const py = (v: number) => CH - CM.bottom - ((v - ymin) / (ymax - ymin)) * (CH - CM.top - CM.bottom);

  return (
    <svg
      viewBox={`0 0 ${CW} ${CH}`}
      width="100%"
      role="img"
      aria-label="Overlaid P&L versus terminal price for the frozen contracts"
    >
      <line x1={CM.left} x2={CW - CM.right} y1={py(0)} y2={py(0)} stroke="var(--border)" strokeWidth={1} />
      <text x={CM.left - 6} y={py(ymax) + 3} fontSize={9} fill="var(--ink-faint)" textAnchor="end">
        {usd0(ymax)}
      </text>
      <text x={CM.left - 6} y={py(ymin) + 3} fontSize={9} fill="var(--ink-faint)" textAnchor="end">
        {usd0(ymin)}
      </text>
      {series.map((s) => {
        const line = s.profile.points.map((p) => `${px(p.sT)},${py(p.pnl100)}`).join(' ');
        return (
          <g key={s.label}>
            <polyline points={line} fill="none" stroke={s.color} strokeWidth={1.75} opacity={0.9} />
            <line
              x1={px(s.profile.breakeven)}
              x2={px(s.profile.breakeven)}
              y1={CM.top}
              y2={CH - CM.bottom}
              stroke={s.color}
              strokeWidth={1}
              strokeDasharray="3 3"
              opacity={0.5}
            />
          </g>
        );
      })}
      <text x={CW / 2} y={CH - 8} fontSize={10} fill="var(--ink-dim)" textAnchor="middle">
        terminal underlying price
      </text>
    </svg>
  );
}
