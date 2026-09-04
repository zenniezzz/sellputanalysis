'use client';

import { useMemo, type ReactNode } from 'react';
import { pnlProfile } from '@pss/options';
import type { ScreenedRow } from '@pss/screen';
import { num, pct, usd, usd0 } from '../lib/format';
import { LogTradeButton } from './LogTradeButton';

const CW = 520;
const CH = 210;
const CM = { top: 12, right: 14, bottom: 26, left: 46 };

export function RowDetail({
  row,
  snapshotRunId,
  signedIn,
}: {
  row: ScreenedRow;
  snapshotRunId: string;
  signedIn: boolean;
}) {
  const profile = useMemo(() => {
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
  }, [row]);

  return (
    <div style={{ padding: '10px 14px', background: 'var(--panel-2)', borderTop: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', gap: 10, marginBottom: 8, alignItems: 'center' }}>
        <LogTradeButton row={row} snapshotRunId={snapshotRunId} signedIn={signedIn} />
        <span style={{ color: 'var(--ink-faint)', fontSize: 11 }}>
          freezes the modeled credit / PoP / EV for calibration
        </span>
      </div>
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {profile ? <Cone profile={profile} spot={row.spot} /> : <div style={{ color: 'var(--ink-faint)' }}>P&amp;L cone unavailable (older snapshot).</div>}

        <div style={{ font: '12px var(--mono)', minWidth: 220 }}>
          <Group title="Greeks">
            <KV k="delta" v={num(row.delta, 3)} />
            <KV k="gamma" v={num(row.gamma, 5)} />
            <KV k="theta/day" v={num(row.thetaDay, 4)} />
            <KV k="vega" v={num(row.vega, 4)} />
            <KV k="daily decay" v={num(row.dailyDecay, 4)} />
          </Group>
          <Group title="Vol">
            <KV k="IV" v={pct(row.iv)} />
            <KV k="σ forecast" v={pct(row.sigmaF)} />
            <KV k="VRP haircut" v={num(row.vrpHaircut, 2)} />
            <KV k="IV vs fitted" v={pct(row.ivVsFitted, 2)} />
            <KV k="put skew 25Δ" v={pct(row.putSkew25d, 2)} />
          </Group>
        </div>

        <div style={{ font: '12px var(--mono)', minWidth: 220 }}>
          <Group title="If assigned">
            <div style={{ color: 'var(--ink-dim)', lineHeight: 1.5 }}>
              Buy {row.multiplier} sh at {usd(row.strike)}; effective cost basis{' '}
              {usd(row.breakeven)} after the {usd(row.entryCredit)} credit ({pct(row.bePct)} below spot).
              P(assigned) {pct(row.probItm)}.
            </div>
          </Group>
          {row.scoreComponents && (
            <Group title={`Score ${num(row.score, 2)}`}>
              {Object.entries(row.scoreComponents).map(([k, v]) => (
                <KV key={k} k={k} v={num(v, 3)} accent={v > 0 ? 'pos' : v < 0 ? 'neg' : undefined} />
              ))}
            </Group>
          )}
        </div>
      </div>
    </div>
  );
}

function Cone({
  profile,
  spot,
}: {
  profile: NonNullable<ReturnType<typeof pnlProfile>>;
  spot: number;
}) {
  const xs = profile.points.map((p) => p.sT);
  const xmin = Math.min(...xs);
  const xmax = Math.max(...xs);
  const pnl = profile.points.map((p) => p.pnl100);
  const ymin = Math.min(...pnl, 0);
  const ymax = Math.max(...pnl, 0);
  const px = (v: number) => CM.left + ((v - xmin) / (xmax - xmin)) * (CW - CM.left - CM.right);
  const py = (v: number) => CH - CM.bottom - ((v - ymin) / (ymax - ymin)) * (CH - CM.top - CM.bottom);

  const line = profile.points.map((p) => `${px(p.sT)},${py(p.pnl100)}`).join(' ');
  const lossArea =
    `${px(xmin)},${py(0)} ` +
    profile.points
      .filter((p) => p.sT <= profile.breakeven)
      .map((p) => `${px(p.sT)},${py(p.pnl100)}`)
      .join(' ') +
    ` ${px(profile.breakeven)},${py(0)}`;

  const vline = (x: number, label: string, dash = false) => (
    <g key={label}>
      <line
        x1={px(x)}
        x2={px(x)}
        y1={CM.top}
        y2={CH - CM.bottom}
        stroke="var(--ink-faint)"
        strokeWidth={1}
        strokeDasharray={dash ? '3 3' : undefined}
      />
      <text x={px(x)} y={CM.top + 8} fontSize={9} fill="var(--ink-faint)" textAnchor="middle">
        {label}
      </text>
    </g>
  );

  return (
    <div>
      <svg viewBox={`0 0 ${CW} ${CH}`} width={CW} role="img" aria-label="P&L versus terminal price with forecast quantile cone">
        <polygon points={lossArea} fill="var(--bad)" opacity={0.14} />
        {[profile.quantiles.p05, profile.quantiles.p25, profile.quantiles.p50, profile.quantiles.p75, profile.quantiles.p95].map(
          (q, i) => vline(q, ['5', '25', '50', '75', '95'][i]!),
        )}
        {vline(profile.breakeven, 'BE', true)}
        {vline(profile.strike, 'K')}
        {vline(spot, 'now')}
        <line x1={CM.left} x2={CW - CM.right} y1={py(0)} y2={py(0)} stroke="var(--border)" strokeWidth={1} />
        <polyline points={line} fill="none" stroke="var(--accent)" strokeWidth={2} />
        <text x={CM.left - 4} y={py(profile.maxProfit100) + 3} fontSize={9} fill="var(--ink-faint)" textAnchor="end">
          {usd0(profile.maxProfit100)}
        </text>
        <text x={CM.left - 4} y={py(ymin) + 3} fontSize={9} fill="var(--ink-faint)" textAnchor="end">
          {usd0(ymin)}
        </text>
        <text x={CW / 2} y={CH - 6} fontSize={10} fill="var(--ink-dim)" textAnchor="middle">
          terminal price
        </text>
      </svg>
      <div style={{ font: '11px var(--mono)', color: 'var(--ink-dim)', marginTop: 2 }}>
        EV {usd0(profile.expectedPnl100)} · PoP {pct(profile.probProfit)} · max profit{' '}
        {usd0(profile.maxProfit100)} · max loss {usd0(-profile.maxLoss100)}
      </div>
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--ink-faint)', marginBottom: 3 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function KV({ k, v, accent }: { k: string; v: string; accent?: 'pos' | 'neg' }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
      <span style={{ color: 'var(--ink-faint)' }}>{k}</span>
      <span style={{ color: accent ? `var(--${accent === 'pos' ? 'accent' : 'bad'})` : 'var(--ink)' }}>{v}</span>
    </div>
  );
}
