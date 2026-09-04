'use client';

import { useCallback, useEffect, useState } from 'react';
import type { CalibrationReport } from '@pss/tracker';
import type { PaperTrade } from '../lib/trades';
import { num, pct, usd, usd0 } from '../lib/format';

export function TradesPanel({ signedIn }: { signedIn: boolean }) {
  const [trades, setTrades] = useState<PaperTrade[]>([]);
  const [report, setReport] = useState<CalibrationReport | null>(null);

  const refresh = useCallback(() => {
    fetch('/api/trades')
      .then((r) => r.json())
      .then((j: { trades?: PaperTrade[] }) => setTrades(j.trades ?? []));
    fetch('/api/trades/calibration')
      .then((r) => r.json())
      .then((j: { report: CalibrationReport }) => setReport(j.report));
  }, []);

  useEffect(refresh, [refresh]);

  if (!signedIn) {
    return <div className="empty">Sign in to log paper trades and see your calibration report.</div>;
  }

  const open = trades.filter((t) => t.outcome == null);
  const closed = trades.filter((t) => t.outcome != null);

  async function close(id: string) {
    const outcome = window.prompt('Outcome: expired_otm / assigned / closed_early / rolled', 'expired_otm');
    if (!outcome) return;
    const body: Record<string, unknown> = { outcome };
    if (outcome === 'assigned') {
      const s = window.prompt('Terminal underlying price:');
      if (s) body.terminalSpot = Number(s);
    }
    if (outcome === 'closed_early' || outcome === 'rolled') {
      const s = window.prompt('Price paid to buy the put back (per share):');
      if (s) body.exitCredit = Number(s);
    }
    await fetch(`/api/trades/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    refresh();
  }

  return (
    <div>
      <h3 style={hStyle}>Calibration ({report?.n ?? 0} closed)</h3>
      {report && report.n > 0 ? (
        <div className="statusbar info" style={{ font: '12px var(--mono)' }}>
          {report.pop && (
            <div>
              PoP: modeled {pct(report.pop.meanModeledPop)} vs realized {pct(report.pop.realizedWinRate)} ·{' '}
              <span className={report.pop.withinTarget ? 'ok' : 'fail'}>
                Δ {report.pop.deltaPp >= 0 ? '+' : ''}
                {report.pop.deltaPp.toFixed(1)}pp (±{report.pop.ciPp.toFixed(1)})
              </span>
              {report.pop.buckets.map((b) => (
                <span key={b.lo} style={{ marginLeft: 10, color: 'var(--ink-faint)' }}>
                  [{b.lo.toFixed(1)}–{b.hi.toFixed(1)}) n={b.n} {b.realizedWinRate >= 0 ? '' : ''}
                  {(b.realizedWinRate * 100).toFixed(0)}%
                </span>
              ))}
            </div>
          )}
          {report.credit && (
            <div>
              Credit fill bias: median {report.credit.medianBiasPct >= 0 ? '+' : ''}
              {report.credit.medianBiasPct.toFixed(1)}% ({report.credit.n} with recorded fills)
            </div>
          )}
          {report.ev && (
            <div>
              EV: mean modeled {usd0(report.ev.meanModeled100)}/contract vs realized {usd0(report.ev.meanRealized100)}
              {report.ev.ratio != null && ` (${report.ev.ratio.toFixed(2)}×)`}
            </div>
          )}
        </div>
      ) : (
        <p className="sub">
          No closed trades yet. Log trades from the row expander in Candidates, then close them here as they
          resolve — the report needs ~500 to be meaningful (plan §1.2).
        </p>
      )}

      <h3 style={hStyle}>Open ({open.length})</h3>
      {open.length === 0 ? (
        <p className="sub">None.</p>
      ) : (
        <TradeTable trades={open} onClose={close} />
      )}

      <h3 style={hStyle}>Closed ({closed.length})</h3>
      {closed.length === 0 ? <p className="sub">None.</p> : <TradeTable trades={closed} />}
    </div>
  );
}

const hStyle = { fontSize: 11, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--ink-faint)', marginTop: 20 } as const;

function TradeTable({ trades, onClose }: { trades: PaperTrade[]; onClose?: (id: string) => void }) {
  return (
    <div className="tablewrap">
      <table className="grid">
        <thead>
          <tr>
            <th className="sym">contract</th>
            <th>credit</th>
            <th>PoP</th>
            <th>EV$</th>
            <th>DTE@entry</th>
            <th>outcome</th>
            <th>realized</th>
            {onClose && <th />}
          </tr>
        </thead>
        <tbody>
          {trades.map((t) => (
            <tr key={t.id}>
              <td className="sym">
                {t.symbol} {t.expiration} {t.strike}P
              </td>
              <td>{usd(t.actualFillCredit ?? t.entryCredit)}</td>
              <td>{pct(t.modeledPop)}</td>
              <td>{num(t.modeledEv100, 0)}</td>
              <td>{t.dteAtEntry}</td>
              <td className="sym">{t.outcome ?? '—'}</td>
              <td className={(t.realizedPnl100 ?? 0) >= 0 ? 'pos' : 'neg'}>
                {t.realizedPnl100 == null ? '—' : usd0(t.realizedPnl100 * t.contracts)}
              </td>
              {onClose && (
                <td>
                  <button className="btn" onClick={() => onClose(t.id)}>
                    close
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
