'use client';

import { useEffect, useState } from 'react';
import { int, num } from '../lib/format';
import type { MonthlyPutVolumeResult } from '../lib/monthly-put-volume';

/**
 * Top 25 by put volume averaged over the trailing 30 days — a trend
 * companion to <TopPutVolume>'s single-day snapshot. Sourced from
 * /api/universe/monthly, which pools one run per calendar day out of the
 * store. Always reflects whatever history has accrued so far; the "X of 30
 * days accrued" note is the same cold-start honesty pattern the app already
 * uses for IV rank.
 */
export function TopPutVolumeMonthly({ onPick }: { onPick: (symbol: string) => void }) {
  const [data, setData] = useState<MonthlyPutVolumeResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/universe/monthly')
      .then((r) => r.json())
      .then((j: MonthlyPutVolumeResult) => {
        if (!cancelled) setData(j);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (data == null || data.rows.length === 0) return null;

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
        Top 25 by put volume — trailing {data.windowDays}d average
      </div>
      {data.daysAvailable < data.windowDays && (
        <div className="sub" style={{ marginBottom: 8 }}>
          {data.daysAvailable} of {data.windowDays} days accrued so far ({data.oldestDay} → {data.newestDay}) —
          averages will firm up as more daily snapshots land.
        </div>
      )}
      <div className="tablewrap">
        <table className="grid">
          <thead>
            <tr>
              <th>#</th>
              <th className="sym">sym</th>
              <th>spot</th>
              <th>avg put vol/day</th>
              <th>total put vol</th>
              <th>days</th>
              <th className="sym">sector</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((u, i) => (
              <tr
                key={u.symbol}
                style={{ cursor: 'pointer' }}
                onClick={() => onPick(u.symbol)}
                title={`Show ${u.symbol} candidates`}
              >
                <td>{i + 1}</td>
                <td className="sym">{u.symbol}</td>
                <td>${num(u.spot, 2)}</td>
                <td>{int(u.avgPutVolume)}</td>
                <td>{int(u.totalPutVolume)}</td>
                <td>{u.daysUsed}</td>
                <td className="sym">{u.sector ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
