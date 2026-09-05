'use client';

import { useEffect, useState } from 'react';
import type { UniverseRow } from '@pss/pipeline';
import { changePct, int, num } from '../lib/format';

const N = 25;

/**
 * Today's top N underlyings by in-window put volume (plan §8.2's per-name
 * rollup, sliced to a leaderboard) — a quick-glance companion to the full
 * Universe tab, right on the Candidates page. Sourced from the same
 * `/api/universe` the Universe tab uses, so it reflects whichever snapshot
 * is latest: a new scheduled run naturally rotates this list, no separate
 * "daily" mechanism needed here.
 *
 * `minSpot`/`maxSpot` scope the leaderboard to a spot-price band (independent
 * of whatever the sidebar's own price filter happens to be set to — this
 * ranks the *universe*, not the current screen) — used for a second,
 * $5–$200-restricted instance of this same table.
 */
export function TopPutVolume({
  onPick,
  minSpot,
  maxSpot,
  title,
}: {
  onPick: (symbol: string) => void;
  minSpot?: number;
  maxSpot?: number;
  title?: string;
}) {
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

  if (rows == null) return null;

  const inBand = rows.filter((u) => (minSpot == null || u.spot >= minSpot) && (maxSpot == null || u.spot <= maxSpot));
  if (inBand.length === 0) return null;

  const top = [...inBand].sort((a, b) => b.inWindowPutVolume - a.inWindowPutVolume).slice(0, N);
  const label = title ?? `Top ${N} by put volume — today's snapshot`;

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
        {label}
      </div>
      <div className="tablewrap">
        <table className="grid">
          <thead>
            <tr>
              <th>#</th>
              <th className="sym">sym</th>
              <th>spot</th>
              <th>put vol</th>
              <th>call vol</th>
              <th>day %</th>
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
                <td>{int(u.inWindowCallVolume)}</td>
                <td className={signCls(u.dailyChangePct)}>{changePct(u.dailyChangePct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function signCls(x: number | null): string {
  if (x == null) return '';
  return x > 0 ? 'pos' : x < 0 ? 'neg' : '';
}
