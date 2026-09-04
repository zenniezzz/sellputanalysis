'use client';

import { useEffect, useMemo, useState } from 'react';
import type { UniverseRow } from '@pss/pipeline';
import { int, num, pct } from '../lib/format';

type SortKey = keyof Pick<
  UniverseRow,
  | 'symbol'
  | 'spot'
  | 'inWindowPutVolume'
  | 'putCallRatio'
  | 'sigma30'
  | 'ivRank'
  | 'ivPctile'
  | 'putSkew25d'
  | 'candidateCount'
>;

const COLS: { key: SortKey; label: string; render: (u: UniverseRow) => string; num?: boolean }[] = [
  { key: 'symbol', label: 'sym', render: (u) => u.symbol },
  { key: 'spot', label: 'spot', render: (u) => `$${num(u.spot, 2)}`, num: true },
  { key: 'inWindowPutVolume', label: 'put vol', render: (u) => int(u.inWindowPutVolume), num: true },
  { key: 'putCallRatio', label: 'p/c', render: (u) => num(u.putCallRatio, 2), num: true },
  { key: 'sigma30', label: 'σ30', render: (u) => pct(u.sigma30), num: true },
  { key: 'ivRank', label: 'IVR', render: (u) => (u.ivRank == null ? '—' : u.ivRank.toFixed(0)), num: true },
  { key: 'ivPctile', label: 'IVpct', render: (u) => (u.ivPctile == null ? '—' : u.ivPctile.toFixed(0)), num: true },
  { key: 'putSkew25d', label: 'skew', render: (u) => pct(u.putSkew25d, 1), num: true },
  { key: 'candidateCount', label: 'cands', render: (u) => String(u.candidateCount), num: true },
];

export function UniversePanel({ onPick }: { onPick: (symbol: string) => void }) {
  const [rows, setRows] = useState<UniverseRow[] | null>(null);
  const [sort, setSort] = useState<SortKey>('inWindowPutVolume');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');

  useEffect(() => {
    fetch('/api/universe')
      .then((r) => r.json())
      .then((j: { universe?: UniverseRow[] }) => setRows(j.universe ?? []))
      .catch(() => setRows([]));
  }, []);

  const sorted = useMemo(() => {
    if (!rows) return [];
    const s = [...rows].sort((a, b) => {
      const av = a[sort];
      const bv = b[sort];
      if (typeof av === 'string' || typeof bv === 'string') {
        return String(av).localeCompare(String(bv)) * (dir === 'asc' ? 1 : -1);
      }
      return ((av ?? -Infinity) - (bv ?? -Infinity)) * (dir === 'asc' ? 1 : -1);
    });
    return s;
  }, [rows, sort, dir]);

  if (!rows) return <div className="empty">Loading universe…</div>;
  if (rows.length === 0) return <div className="empty">No universe data in this snapshot.</div>;

  const setSortKey = (k: SortKey) => {
    if (k === sort) setDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    else {
      setSort(k);
      setDir(k === 'symbol' ? 'asc' : 'desc');
    }
  };

  return (
    <div className="tablewrap">
      <table className="grid">
        <thead>
          <tr>
            {COLS.map((c) => (
              <th
                key={c.key}
                className={`${c.key === 'symbol' ? 'sym ' : ''}${sort === c.key ? 'sorted' : ''}`}
                onClick={() => setSortKey(c.key)}
                tabIndex={0}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setSortKey(c.key)}
              >
                {c.label}
                {sort === c.key ? (dir === 'desc' ? ' ▾' : ' ▴') : ''}
              </th>
            ))}
            <th>sector</th>
            <th>earnings</th>
            <th>flags</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((u) => (
            <tr
              key={u.symbol}
              style={{ cursor: 'pointer' }}
              onClick={() => onPick(u.symbol)}
              title={`Show ${u.symbol} candidates`}
            >
              {COLS.map((c) => (
                <td key={c.key} className={c.key === 'symbol' ? 'sym' : ''}>
                  {c.render(u)}
                </td>
              ))}
              <td className="sym">{u.sector ?? '—'}</td>
              <td className="sym">
                {u.nextEarnings ?? '—'}
                {u.earningsBeforeNearestMonthly && <span className="chip warn">pre-monthly</span>}
              </td>
              <td className="sym">
                {u.settlement === 'cash' && <span className="chip">cash-settled</span>}
                {u.hardToBorrow && <span className="chip warn">HTB</span>}
                {u.ivRankProxy && <span className="chip">iv~</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
