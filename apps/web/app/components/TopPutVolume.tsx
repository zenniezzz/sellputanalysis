'use client';

import { useEffect, useState } from 'react';
import type { UniverseRow } from '@pss/pipeline';
import { int, num } from '../lib/format';

const N = 25;

/**
 * Today's top N underlyings by in-window put volume (plan §8.2's per-name
 * rollup, sliced to a leaderboard) — a quick-glance companion to the full
 * Universe tab, right on the Candidates page. Sourced from the same
 * `/api/universe` the Universe tab uses, so it reflects whichever snapshot
 * is latest: a new scheduled run naturally rotates this list, no separate
 * "daily" mechanism needed here.
 */
export function TopPutVolume({ onPick }: { onPick: (symbol: string) => void }) {
  const [rows, setRows] = useState<UniverseRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/universe')
      .then((r) => r.json())
      .then((j: { universe?: UniverseRow[] }) => {
        if (!cancelled) setRows(j.universe ?? []);
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (rows == null || rows.length === 0) return null;

  const top = [...rows].sort((a, b) => b.inWindowPutVolume - a.inWindowPutVolume).slice(0, N);

  return (
    <div className="panel" style={{ padding: 12, marginBottom: 14 }}>
      <div
        style={{
          fontSize: 10,
          textTransform: 'uppercase',
          letterSpacing: '.08em',
          color: 'var(--ink-faint)',
          marginBottom: 8,
        }}
      >
        Top {N} by put volume — today's snapshot
      </div>
      <div className="tablewrap">
        <table className="grid">
          <thead>
            <tr>
              <th>#</th>
              <th className="sym">sym</th>
              <th>spot</th>
              <th>put vol</th>
              <th>p/c</th>
              <th>cands</th>
              <th className="sym">sector</th>
            </tr>
          </thead>
          <tbody>
            {top.map((u, i) => (
              <tr
                key={u.symbol}
                style={{ cursor: 'pointer' }}
                onClick={() => onPick(u.symbol)}
                title={`Show ${u.symbol} candidates`}
              >
                <td>{i + 1}</td>
                <td className="sym">{u.symbol}</td>
                <td>${num(u.spot, 2)}</td>
                <td>{int(u.inWindowPutVolume)}</td>
                <td>{num(u.putCallRatio, 2)}</td>
                <td>{u.candidateCount}</td>
                <td className="sym">{u.sector ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
