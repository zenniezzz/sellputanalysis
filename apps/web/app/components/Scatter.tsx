'use client';

import { useMemo, useState } from 'react';
import { scoreColorPosition } from '@pss/options';
import type { ScreenedRow } from '@pss/screen';
import { num, pct, score10 } from '../lib/format';

type AxisKey =
  | 'absDelta'
  | 'evToMaxloss'
  | 'decayYield'
  | 'ivRank'
  | 'thetaVega'
  | 'ivVsFitted'
  | 'dte'
  | 'annRoc'
  | 'spreadPct'
  | 'volumeLog';

interface AxisDef {
  label: string;
  get: (r: ScreenedRow) => number | null;
  fmt: (v: number) => string;
  log?: boolean;
}

const AXES: Record<AxisKey, AxisDef> = {
  absDelta: { label: '|delta|', get: (r) => (r.delta == null ? null : Math.abs(r.delta)), fmt: (v) => num(v, 2) },
  evToMaxloss: { label: 'EV / max-loss', get: (r) => r.evToMaxloss, fmt: (v) => num(v, 3) },
  decayYield: { label: 'decay yield', get: (r) => r.decayYield, fmt: (v) => pct(v, 2) },
  ivRank: { label: 'IV rank', get: (r) => r.ivRank, fmt: (v) => v.toFixed(0) },
  thetaVega: { label: 'theta / vega', get: (r) => r.thetaVega, fmt: (v) => num(v, 3) },
  ivVsFitted: { label: 'IV vs fitted', get: (r) => r.ivVsFitted, fmt: (v) => pct(v, 2) },
  dte: { label: 'DTE', get: (r) => r.dte, fmt: (v) => v.toFixed(0) },
  annRoc: { label: 'annualized ROC', get: (r) => r.displayAnnRoc, fmt: (v) => pct(v) },
  spreadPct: { label: 'spread %', get: (r) => r.spreadPct, fmt: (v) => pct(v) },
  volumeLog: { label: 'volume (log)', get: (r) => r.volume, fmt: (v) => v.toLocaleString('en-US'), log: true },
};

const PRESETS: { name: string; x: AxisKey; y: AxisKey; band?: boolean }[] = [
  { name: 'Value vs risk', x: 'absDelta', y: 'evToMaxloss', band: true },
  { name: 'Yield vs risk', x: 'absDelta', y: 'decayYield', band: true },
  { name: 'Vol compensation', x: 'ivRank', y: 'thetaVega' },
  { name: 'Surface edge', x: 'ivVsFitted', y: 'evToMaxloss' },
  { name: 'Term structure', x: 'dte', y: 'annRoc' },
  { name: 'Liquidity', x: 'spreadPct', y: 'volumeLog' },
];

const W = 660;
const H = 380;
const M = { top: 16, right: 16, bottom: 42, left: 56 };

export function Scatter({
  rows,
  highlightedOcc,
  onHover,
  onSelect,
}: {
  rows: ScreenedRow[];
  highlightedOcc: string | null;
  onHover: (occ: string | null) => void;
  onSelect: (occ: string) => void;
}) {
  const [presetIdx, setPresetIdx] = useState(0);
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const preset = PRESETS[presetIdx]!;
  const xAxis = AXES[preset.x];
  const yAxis = AXES[preset.y];

  const pts = useMemo(() => {
    const raw = rows
      .map((r) => ({ r, x: xAxis.get(r), y: yAxis.get(r) }))
      .filter((p): p is { r: ScreenedRow; x: number; y: number } => p.x != null && p.y != null);
    const tx = (v: number) => (xAxis.log ? Math.log(v + 1) : v);
    const ty = (v: number) => (yAxis.log ? Math.log(v + 1) : v);
    const xs = raw.map((p) => tx(p.x));
    const ys = raw.map((p) => ty(p.y));
    const ois = raw.map((p) => Math.log(p.r.openInterest + 1));
    const xmin = Math.min(...xs, 0);
    const xmax = Math.max(...xs, xmin + 1e-6);
    const ymin = Math.min(...ys);
    const ymax = Math.max(...ys, ymin + 1e-6);
    const oimin = Math.min(...ois, 0);
    const oimax = Math.max(...ois, oimin + 1e-6);
    const px = (v: number) => M.left + ((tx(v) - xmin) / (xmax - xmin)) * (W - M.left - M.right);
    const py = (v: number) => H - M.bottom - ((ty(v) - ymin) / (ymax - ymin)) * (H - M.top - M.bottom);
    const pr = (oi: number) => 3 + ((Math.log(oi + 1) - oimin) / (oimax - oimin)) * 8;
    return {
      data: raw.map((p) => ({ ...p, cx: px(p.x), cy: py(p.y), radius: pr(p.r.openInterest) })),
      px,
      py,
      xmin,
      xmax,
      ymin,
      ymax,
      xTicks: ticks(xmin, xmax, 5, xAxis.log),
      yTicks: ticks(ymin, ymax, 5, yAxis.log),
    };
  }, [rows, xAxis, yAxis]);

  const [hover, setHover] = useState<(typeof pts.data)[number] | null>(null);

  const controls = (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
      <select
        value={presetIdx}
        onChange={(e) => setPresetIdx(Number(e.target.value))}
        style={{
          background: 'var(--panel-2)',
          border: '1px solid var(--border)',
          color: 'var(--ink)',
          borderRadius: 4,
          padding: '3px 6px',
          fontSize: 12,
        }}
      >
        {PRESETS.map((p, i) => (
          <option key={p.name} value={i}>
            {p.name}: {AXES[p.x].label} × {AXES[p.y].label}
          </option>
        ))}
      </select>
      <span style={{ flex: 1 }} />
      <span style={{ fontSize: 11, color: 'var(--ink-faint)' }}>
        size = OI · shade = score (0–10) · {pts.data.length} pts
      </span>
      <button className="btn" onClick={() => setView(view === 'chart' ? 'table' : 'chart')}>
        {view === 'chart' ? 'table' : 'chart'}
      </button>
    </div>
  );

  if (view === 'table') {
    return (
      <div className="panel" style={{ padding: 10, marginBottom: 12 }}>
        {controls}
        <div className="tablewrap" style={{ maxHeight: 300 }}>
          <table className="grid">
            <thead>
              <tr>
                <th className="sym">sym</th>
                <th>exp / K</th>
                <th>{xAxis.label}</th>
                <th>{yAxis.label}</th>
                <th>score /10</th>
                <th>OI</th>
              </tr>
            </thead>
            <tbody>
              {[...pts.data]
                .sort((a, b) => (b.r.score ?? -Infinity) - (a.r.score ?? -Infinity))
                .map((p) => (
                  <tr
                    key={p.r.occSymbol}
                    onMouseEnter={() => onHover(p.r.occSymbol)}
                    onMouseLeave={() => onHover(null)}
                    style={p.r.occSymbol === highlightedOcc ? { background: 'var(--panel-2)' } : undefined}
                  >
                    <td className="sym">{p.r.symbol}</td>
                    <td className="sym">
                      {p.r.expiration} {p.r.strike}P
                    </td>
                    <td>{xAxis.fmt(p.x)}</td>
                    <td>{yAxis.fmt(p.y)}</td>
                    <td>{score10(p.r.score)}</td>
                    <td>{p.r.openInterest.toLocaleString('en-US')}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  const bandFill =
    preset.band && pts.data.length
      ? { x1: pts.px(0.15), x2: pts.px(0.35) }
      : null;

  return (
    <div className="panel" style={{ padding: 10, marginBottom: 12, position: 'relative' }}>
      {controls}
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`${xAxis.label} versus ${yAxis.label} scatter of ${pts.data.length} candidates`}>
        {bandFill && (
          <rect
            x={Math.min(bandFill.x1, bandFill.x2)}
            width={Math.abs(bandFill.x2 - bandFill.x1)}
            y={M.top}
            height={H - M.top - M.bottom}
            fill="var(--accent)"
            opacity={0.08}
          />
        )}
        {pts.yTicks.map((t) => (
          <g key={`y${t}`}>
            <line x1={M.left} x2={W - M.right} y1={pts.py(t)} y2={pts.py(t)} stroke="var(--border)" strokeWidth={1} />
            <text x={M.left - 6} y={pts.py(t) + 3} textAnchor="end" fontSize={10} fill="var(--ink-faint)">
              {yAxis.fmt(t)}
            </text>
          </g>
        ))}
        {pts.xTicks.map((t) => (
          <g key={`x${t}`}>
            <line x1={pts.px(t)} x2={pts.px(t)} y1={M.top} y2={H - M.bottom} stroke="var(--border)" strokeWidth={1} opacity={0.5} />
            <text x={pts.px(t)} y={H - M.bottom + 14} textAnchor="middle" fontSize={10} fill="var(--ink-faint)">
              {xAxis.fmt(t)}
            </text>
          </g>
        ))}
        <text x={(W) / 2} y={H - 6} textAnchor="middle" fontSize={11} fill="var(--ink-dim)">
          {xAxis.label}
        </text>
        <text x={12} y={H / 2} textAnchor="middle" fontSize={11} fill="var(--ink-dim)" transform={`rotate(-90 12 ${H / 2})`}>
          {yAxis.label}
        </text>

        {pts.data.map((p) => {
          const active = p.r.occSymbol === highlightedOcc || p.r.occSymbol === hover?.r.occSymbol;
          const cp = scoreColorPosition(p.r.score);
          return (
            <circle
              key={p.r.occSymbol}
              cx={p.cx}
              cy={p.cy}
              r={active ? p.radius + 2 : p.radius}
              fill="var(--accent)"
              fillOpacity={0.35 + 0.6 * (cp ?? 0.4)}
              stroke={active ? 'var(--ink)' : 'var(--panel)'}
              strokeWidth={active ? 1.5 : 1}
              style={{ cursor: 'pointer' }}
              onMouseEnter={() => {
                setHover(p);
                onHover(p.r.occSymbol);
              }}
              onMouseLeave={() => {
                setHover(null);
                onHover(null);
              }}
              onClick={() => onSelect(p.r.occSymbol)}
            />
          );
        })}
      </svg>

      {hover && (
        <div
          style={{
            position: 'absolute',
            left: `min(${(hover.cx / W) * 100}%, calc(100% - 190px))`,
            top: hover.cy + 44,
            background: 'var(--panel-2)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: '6px 8px',
            font: '11px var(--mono)',
            pointerEvents: 'none',
            width: 180,
          }}
        >
          <div style={{ color: 'var(--ink)' }}>
            {hover.r.symbol} {hover.r.expiration} {hover.r.strike}P
          </div>
          <div>
            {xAxis.label}: {xAxis.fmt(hover.x)}
          </div>
          <div>
            {yAxis.label}: {yAxis.fmt(hover.y)}
          </div>
          <div>score {score10(hover.r.score)}/10 · OI {hover.r.openInterest.toLocaleString('en-US')}</div>
        </div>
      )}
    </div>
  );
}

function ticks(min: number, max: number, count: number, log?: boolean): number[] {
  const out: number[] = [];
  for (let i = 0; i <= count; i++) {
    const t = min + ((max - min) * i) / count;
    out.push(log ? Math.exp(t) - 1 : t);
  }
  return out;
}
