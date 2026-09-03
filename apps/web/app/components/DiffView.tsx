'use client';

import type { SnapshotDiff } from '../lib/diff';
import { num } from '../lib/format';

function delta(x: number, dp = 3): string {
  if (!Number.isFinite(x) || x === 0) return '0';
  return `${x > 0 ? '+' : ''}${x.toFixed(dp)}`;
}

export function DiffView({ diff }: { diff: SnapshotDiff }) {
  return (
    <div className="diffview">
      <p className="sub" style={{ color: 'var(--ink-dim)', fontSize: 12 }}>
        <code>{diff.prevRunId}</code> → <code>{diff.nextRunId}</code> · {diff.added.length} added ·{' '}
        {diff.dropped.length} dropped · {diff.moved.length} rank moves
      </p>

      <h3 style={{ color: 'var(--accent)' }}>Added ({diff.added.length})</h3>
      {diff.added.length === 0 ? (
        <p className="sub">None.</p>
      ) : (
        <div className="tablewrap">
          <table className="grid">
            <thead>
              <tr>
                <th className="sym">Contract</th>
                <th>Strike</th>
                <th>Expiration</th>
              </tr>
            </thead>
            <tbody>
              {diff.added.map((r) => (
                <tr key={r.occSymbol}>
                  <td className="sym pos">{r.symbol}</td>
                  <td>{num(r.strike, 2)}</td>
                  <td>{r.expiration}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 style={{ color: 'var(--bad)' }}>Dropped ({diff.dropped.length})</h3>
      {diff.dropped.length === 0 ? (
        <p className="sub">None.</p>
      ) : (
        <div className="tablewrap">
          <table className="grid">
            <thead>
              <tr>
                <th className="sym">Contract</th>
                <th>Strike</th>
                <th>Expiration</th>
                <th className="sym">Reason</th>
              </tr>
            </thead>
            <tbody>
              {diff.dropped.map((r) => (
                <tr key={r.occSymbol}>
                  <td className="sym neg">{r.symbol}</td>
                  <td>{num(r.strike, 2)}</td>
                  <td>{r.expiration}</td>
                  <td className="sym">{r.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3>Rank moves ({diff.moved.length})</h3>
      {diff.moved.length === 0 ? (
        <p className="sub">None.</p>
      ) : (
        <div className="tablewrap">
          <table className="grid">
            <thead>
              <tr>
                <th className="sym">Contract</th>
                <th>Rank</th>
                <th>Δ score</th>
                <th>Δ EV</th>
                <th>Δ IV rank</th>
              </tr>
            </thead>
            <tbody>
              {diff.moved.map((r) => {
                const up = r.nextRank < r.prevRank;
                return (
                  <tr key={r.occSymbol}>
                    <td className="sym">{r.symbol}</td>
                    <td className={up ? 'pos' : 'neg'}>
                      {r.prevRank} {up ? '↑' : '↓'} {r.nextRank}
                    </td>
                    <td className={r.scoreDelta >= 0 ? 'pos' : 'neg'}>{delta(r.scoreDelta)}</td>
                    <td className={r.evDelta >= 0 ? 'pos' : 'neg'}>{delta(r.evDelta, 2)}</td>
                    <td className={r.ivRankDelta >= 0 ? 'pos' : 'neg'}>{delta(r.ivRankDelta, 2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
