'use client';

import { useMemo } from 'react';
import { pnlProfile, type PnlProfile } from '@pss/options';
import type { ScreenedRow } from '@pss/screen';
import { pct, usd, usd0 } from '../lib/format';
import { bestInRow, transposeContracts } from '../lib/compare';

/** Line styles cycled across the overlaid payoff lines. */
const LINE_STYLES: { dash?: string; opacity: number }[] = [
  { opacity: 0.95 },
  { dash: '6 3', opacity: 0.85 },
  { dash: '2 3', opacity: 0.8 },
  { dash: '9 3 2 3', opacity: 0.75 },
  { dash: '12 4', opacity: 0.7 },
  { dash: '1 4', opacity: 0.65 },
];

export function CompareView({ rows, selected }: { rows: ScreenedRow[]; selected: string[] }) {
  const cols = useMemo(() => {
    const byOcc = new Map(rows.map((r) => [r.occSymbol, r]));
    return selected.map((occ) => byOcc.get(occ)).filter((r): r is ScreenedRow => !!r);
  }, [rows, selected]);

  const metrics = useMemo(() => transposeContracts(cols), [cols]);

  if (cols.length === 0) {
    return (
      <div className="empty">
        Nothing to compare yet. Tick the checkbox on rows in the Candidates tab (up to 6) to line
        them up here.
      </div>
    );
  }

  return (
    <div className="compare-view">
      <div className="tablewrap">
        <table className="grid compare-grid">
          <thead>
            <tr>
              <th className="sym">metric</th>
              {cols.map((r) => (
                <th key={r.occSymbol} className="sym">
                  {r.symbol} {r.expiration} {r.strike}P
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {metrics.map((m) => {
              const best = bestInRow(cols, m);
              return (
                <tr key={m.metric}>
                  <td className="sym">{m.label}</td>
                  {cols.map((r) => {
                    const win = best.has(r.occSymbol);
                    return (
                      <td
                        key={r.occSymbol}
                        style={win ? { color: 'var(--accent)', fontWeight: 600 } : undefined}
                      >
                        {m.values(r)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <OverlaidCone rows={cols} />
    </div>
  );
}

const CW = 620;
const CH = 260;
const CM = { top: 14, right: 16, bottom: 30, left: 52 };

function OverlaidCone({ rows }: { rows: ScreenedRow[] }) {
  const profiles = useMemo(() => {
    const out: { row: ScreenedRow; profile: PnlProfile }[] = [];
    for (const r of rows) {
      if (
        r.spotAdj == null ||
        r.entryCredit == null ||
        r.sigmaF == null ||
        r.mu == null ||
        r.dte <= 0
      )
        continue;
      out.push({
        row: r,
        profile: pnlProfile({
          sAdj: r.spotAdj,
          k: r.strike,
          entryCredit: r.entryCredit,
          mu: r.mu,
          sigmaF: r.sigmaF,
          t: r.dte / 365,
          multiplier: r.multiplier,
          points: 160,
        }),
      });
    }
    return out;
  }, [rows]);

  if (profiles.length === 0) {
    return (
      <div style={{ color: 'var(--ink-faint)', font: '12px var(--mono)', marginTop: 12 }}>
        Overlaid P&amp;L cone unavailable — the selected contracts are missing forecast inputs
        (older snapshot).
      </div>
    );
  }

  const allX = profiles.flatMap((p) => p.profile.points.map((pt) => pt.sT));
  const allY = profiles.flatMap((p) => p.profile.points.map((pt) => pt.pnl100));
  const xmin = Math.min(...allX);
  const xmax = Math.max(...allX);
  const ymin = Math.min(...allY, 0);
  const ymax = Math.max(...allY, 0);
  const px = (v: number) => CM.left + ((v - xmin) / (xmax - xmin || 1)) * (CW - CM.left - CM.right);
  const py = (v: number) => CH - CM.bottom - ((v - ymin) / (ymax - ymin || 1)) * (CH - CM.top - CM.bottom);

  return (
    <div style={{ marginTop: 14 }}>
      <div
        style={{
          fontSize: 10,
          textTransform: 'uppercase',
          letterSpacing: '.08em',
          color: 'var(--ink-faint)',
          marginBottom: 4,
        }}
      >
        Overlaid P&amp;L at expiry
      </div>
      <svg
        viewBox={`0 0 ${CW} ${CH}`}
        width="100%"
        role="img"
        aria-label={`Overlaid short-put P&L versus terminal price for ${profiles.length} contracts`}
      >
        {/* zero line */}
        <line
          x1={CM.left}
          x2={CW - CM.right}
          y1={py(0)}
          y2={py(0)}
          stroke="var(--border)"
          strokeWidth={1}
        />
        <text x={CM.left - 4} y={py(ymax) + 3} fontSize={9} fill="var(--ink-faint)" textAnchor="end">
          {usd0(ymax)}
        </text>
        <text x={CM.left - 4} y={py(ymin) + 3} fontSize={9} fill="var(--ink-faint)" textAnchor="end">
          {usd0(ymin)}
        </text>

        {profiles.map((p, i) => {
          const style = LINE_STYLES[i % LINE_STYLES.length]!;
          const line = p.profile.points.map((pt) => `${px(pt.sT)},${py(pt.pnl100)}`).join(' ');
          return (
            <g key={p.row.occSymbol}>
              <polyline
                points={line}
                fill="none"
                stroke="var(--accent)"
                strokeWidth={2}
                strokeDasharray={style.dash}
                opacity={style.opacity}
              />
              {/* breakeven marker */}
              <line
                x1={px(p.profile.breakeven)}
                x2={px(p.profile.breakeven)}
                y1={CM.top}
                y2={CH - CM.bottom}
                stroke="var(--ink-faint)"
                strokeWidth={1}
                strokeDasharray="2 3"
                opacity={style.opacity}
              />
              <text
                x={px(p.profile.breakeven)}
                y={CM.top + 8 + (i % 3) * 9}
                fontSize={8}
                fill="var(--ink-faint)"
                textAnchor="middle"
              >
                BE {usd(p.profile.breakeven)}
              </text>
            </g>
          );
        })}

        <text x={CW / 2} y={CH - 6} fontSize={10} fill="var(--ink-dim)" textAnchor="middle">
          terminal price
        </text>
      </svg>

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 12,
          font: '11px var(--mono)',
          color: 'var(--ink-dim)',
          marginTop: 4,
        }}
      >
        {profiles.map((p, i) => {
          const style = LINE_STYLES[i % LINE_STYLES.length]!;
          return (
            <span key={p.row.occSymbol} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <svg width={22} height={8} aria-hidden="true">
                <line
                  x1={0}
                  x2={22}
                  y1={4}
                  y2={4}
                  stroke="var(--accent)"
                  strokeWidth={2}
                  strokeDasharray={style.dash}
                  opacity={style.opacity}
                />
              </svg>
              {p.row.symbol} {p.row.expiration} {p.row.strike}P · EV {usd0(p.profile.expectedPnl100)} · PoP{' '}
              {pct(p.profile.probProfit)}
            </span>
          );
        })}
      </div>
    </div>
  );
}
