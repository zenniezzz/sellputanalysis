'use client';

import type { ReactNode } from 'react';
import { COLUMN_PRESETS, type ColumnPreset, type ScreenedRow, type SortDir, type SortKey } from '@pss/screen';
import { num, pct, usd, usd0, int } from '../lib/format';
import { RowDetail } from './RowDetail';

interface Col {
  key: SortKey;
  label: string;
  render: (r: ScreenedRow) => string;
  cls?: (r: ScreenedRow) => string;
}

const COLS: Record<SortKey, Col> = {
  score: { key: 'score', label: 'score', render: (r) => num(r.score, 2), cls: (r) => signCls(r.score) },
  symbol: { key: 'symbol', label: 'sym', render: (r) => r.symbol, cls: () => 'sym' },
  dte: { key: 'dte', label: 'dte', render: (r) => String(r.dte) },
  entryCredit: { key: 'entryCredit', label: 'credit', render: (r) => usd(r.entryCredit) },
  spreadPct: { key: 'spreadPct', label: 'spr%', render: (r) => pct(r.spreadPct) },
  iv: { key: 'iv', label: 'iv', render: (r) => pct(r.iv) },
  ivRank: { key: 'ivRank', label: 'ivr', render: (r) => (r.ivRank == null ? '—' : r.ivRank.toFixed(0)) },
  putSkew25d: { key: 'putSkew25d', label: 'skew', render: (r) => pct(r.putSkew25d, 1), cls: (r) => signCls(r.putSkew25d) },
  ivVsFitted: {
    key: 'ivVsFitted',
    label: 'resid',
    render: (r) => pct(r.ivVsFitted, 2),
    cls: (r) => signCls(r.ivVsFitted),
  },
  delta: { key: 'delta', label: 'Δ', render: (r) => num(r.delta, 3) },
  decayYield: { key: 'decayYield', label: 'θ%', render: (r) => pct(r.decayYield, 2) },
  probItm: { key: 'probItm', label: 'P(ITM)', render: (r) => pct(r.probItm) },
  pop: { key: 'pop', label: 'PoP', render: (r) => pct(r.pop) },
  evToMaxloss: {
    key: 'evToMaxloss',
    label: 'EV/mL',
    render: (r) => num(r.evToMaxloss, 3),
    cls: (r) => signCls(r.evToMaxloss),
  },
  annRoc: { key: 'annRoc', label: 'annROC', render: (r) => pct(r.displayAnnRoc) },
  displayCapital: { key: 'displayCapital', label: 'capital', render: (r) => usd0(r.displayCapital100) },
  openInterest: { key: 'openInterest', label: 'OI', render: (r) => int(r.openInterest) },
  volume: { key: 'volume', label: 'vol', render: (r) => int(r.volume) },
};

function signCls(x: number | null): string {
  if (x == null) return '';
  return x > 0 ? 'pos' : x < 0 ? 'neg' : '';
}

const FLAG_LABEL: Record<string, string> = {
  borrow: 'borrow',
  dividend: 'div',
  ivRankProxy: 'iv~',
  belowParity: 'parity',
  earningsBeforeExpiry: 'earn',
  spotAsync: 'spot~',
};

export function CandidatesTable({
  rows,
  preset,
  sort,
  sortDir,
  onSort,
  highlightedOcc,
  onHover,
  expandedOcc,
  onToggleExpand,
}: {
  rows: ScreenedRow[];
  preset: ColumnPreset;
  sort: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
  highlightedOcc: string | null;
  onHover: (occ: string | null) => void;
  expandedOcc: string | null;
  onToggleExpand: (occ: string) => void;
}) {
  const cols = COLUMN_PRESETS[preset].map((k) => COLS[k]);

  if (rows.length === 0) {
    return <div className="empty">No candidates match the current filters.</div>;
  }

  return (
    <div className="tablewrap">
      <table className="grid">
        <thead>
          <tr>
            {cols.map((c) => (
              <th
                key={c.key}
                className={`${c.key === 'symbol' ? 'sym ' : ''}${sort === c.key ? 'sorted' : ''}`}
                onClick={() => onSort(c.key)}
                title="click to sort"
              >
                {c.label}
                {sort === c.key ? (sortDir === 'desc' ? ' ▾' : ' ▴') : ''}
              </th>
            ))}
            <th>exp / K</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const flags = Object.entries(r.modelCaution)
              .filter(([, v]) => v)
              .map(([k]) => k);
            const expanded = r.occSymbol === expandedOcc;
            return (
              <FragmentRow key={r.occSymbol}>
                <tr
                  id={`row-${r.occSymbol.trim()}`}
                  onMouseEnter={() => onHover(r.occSymbol)}
                  onMouseLeave={() => onHover(null)}
                  onClick={() => onToggleExpand(r.occSymbol)}
                  style={{
                    cursor: 'pointer',
                    background: r.occSymbol === highlightedOcc ? 'var(--panel-2)' : undefined,
                  }}
                >
                  {cols.map((c) => (
                    <td key={c.key} className={`${c.key === 'symbol' ? 'sym' : ''} ${c.cls?.(r) ?? ''}`}>
                      {c.render(r)}
                    </td>
                  ))}
                  <td className="sym">
                    {expanded ? '▾ ' : '▸ '}
                    {r.expiration} {r.strike}P{' '}
                    {r.assignmentWatch && <span className="chip warn">assign</span>}
                    {flags.map((f) => (
                      <span key={f} className="chip">
                        {FLAG_LABEL[f] ?? f}
                      </span>
                    ))}
                  </td>
                </tr>
                {expanded && (
                  <tr>
                    <td colSpan={cols.length + 1} style={{ padding: 0, textAlign: 'left' }}>
                      <RowDetail row={r} />
                    </td>
                  </tr>
                )}
              </FragmentRow>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function FragmentRow({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
