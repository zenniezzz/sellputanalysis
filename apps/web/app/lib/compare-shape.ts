/**
 * Pure shaping for the transposed Compare surface (plan §8.5): metric-rows ×
 * contract-columns, with a formatted + raw value per cell, a `higherBetter`
 * flag per metric, and a direction-aware best-in-row selector.
 *
 * No I/O, no `server-only` — safe to import from client components and tests.
 */

import type { ScreenedRow } from '@pss/screen';
import { int, num, pct, score10, usd } from './format';

const DELTA_TARGET = 0.25;

/** `true` = larger is better, `false` = smaller is better, `null` = not ranked. */
export type Direction = boolean | null;

export interface CompareMetricDef {
  key: string;
  /** Row label for the CSV export, where `raw()` (the full-precision value) is what's written. */
  label: string;
  /** On-screen row label, next to `format()`'s value — only set where it differs from `label` (currently just the composite score, shown as a 0–10 rating on screen but exported at full precision). */
  displayLabel?: string;
  group: string;
  higherBetter: Direction;
  /** Raw numeric value (already sign-normalised for ranking), or null. */
  raw: (r: ScreenedRow) => number | null;
  /** Display string. */
  format: (r: ScreenedRow) => string;
  /** Special best-in-row rule. `delta` = closest to |Δ| 0.25. */
  rule?: 'delta';
}

export interface CompareCell {
  occSymbol: string;
  symbol: string;
  raw: number | null;
  formatted: string;
  best: boolean;
}

export interface CompareRow {
  key: string;
  label: string;
  group: string;
  higherBetter: Direction;
  cells: CompareCell[];
}

export interface CompareContract {
  occSymbol: string;
  symbol: string;
  /** e.g. "AAPL 2026-10-17 P185". */
  label: string;
}

export interface CompareTable {
  contracts: CompareContract[];
  rows: CompareRow[];
}

const fin = (x: number | null | undefined): number | null =>
  x == null || !Number.isFinite(x) ? null : x;

export const COMPARE_METRICS: CompareMetricDef[] = [
  { key: 'score', label: 'Composite score', displayLabel: 'Composite score /10', group: 'Score', higherBetter: true, raw: (r) => fin(r.score), format: (r) => score10(r.score) },
  { key: 'evToMaxloss', label: 'EV / max-loss', group: 'Returns', higherBetter: true, raw: (r) => fin(r.evToMaxloss), format: (r) => num(r.evToMaxloss, 3) },
  { key: 'annRoc', label: 'Annualized ROC', group: 'Returns', higherBetter: true, raw: (r) => fin(r.displayAnnRoc), format: (r) => pct(r.displayAnnRoc) },
  { key: 'decayYield', label: 'Decay yield', group: 'Returns', higherBetter: true, raw: (r) => fin(r.decayYield), format: (r) => pct(r.decayYield, 2) },
  { key: 'entryCredit', label: 'Entry credit', group: 'Returns', higherBetter: true, raw: (r) => fin(r.entryCredit), format: (r) => usd(r.entryCredit) },
  { key: 'iv', label: 'Implied vol', group: 'Surface', higherBetter: true, raw: (r) => fin(r.iv), format: (r) => pct(r.iv) },
  { key: 'ivRank', label: 'IV rank', group: 'Surface', higherBetter: true, raw: (r) => fin(r.ivRank), format: (r) => (r.ivRank == null ? '—' : r.ivRank.toFixed(0)) },
  { key: 'putSkew25d', label: 'Put skew 25Δ', group: 'Surface', higherBetter: true, raw: (r) => fin(r.putSkew25d), format: (r) => pct(r.putSkew25d, 1) },
  { key: 'ivVsFitted', label: 'IV vs fitted', group: 'Surface', higherBetter: true, raw: (r) => fin(r.ivVsFitted), format: (r) => pct(r.ivVsFitted, 2) },
  { key: 'delta', label: 'Delta (|Δ|→0.25)', group: 'Greeks', higherBetter: null, rule: 'delta', raw: (r) => (r.delta == null ? null : fin(Math.abs(r.delta))), format: (r) => num(r.delta, 3) },
  { key: 'pop', label: 'Prob. of profit', group: 'Risk', higherBetter: true, raw: (r) => fin(r.pop), format: (r) => pct(r.pop) },
  { key: 'probItm', label: 'P(ITM)', group: 'Risk', higherBetter: false, raw: (r) => fin(r.probItm), format: (r) => pct(r.probItm) },
  { key: 'spreadPct', label: 'Spread %', group: 'Risk', higherBetter: false, raw: (r) => fin(r.spreadPct), format: (r) => pct(r.spreadPct) },
  { key: 'breakeven', label: 'Breakeven', group: 'Risk', higherBetter: false, raw: (r) => fin(r.breakeven), format: (r) => usd(r.breakeven) },
  { key: 'dte', label: 'DTE', group: 'Contract', higherBetter: null, raw: (r) => fin(r.dte), format: (r) => String(r.dte) },
  { key: 'openInterest', label: 'Open interest', group: 'Liquidity', higherBetter: true, raw: (r) => fin(r.openInterest), format: (r) => int(r.openInterest) },
];

export function contractLabel(r: ScreenedRow): string {
  return `${r.symbol} ${r.expiration} P${r.strike}`;
}

/**
 * occSymbols that win a given metric across `rows`. Direction-aware:
 *  - `rule: 'delta'` → closest to |Δ| 0.25
 *  - `higherBetter === true`  → max
 *  - `higherBetter === false` → min
 *  - `higherBetter === null`  → nothing highlighted
 * Ties all win. An all-null row highlights nothing.
 */
export function bestInRow(rows: ScreenedRow[], def: CompareMetricDef): Set<string> {
  const vals = rows
    .map((r) => ({ occSymbol: r.occSymbol, v: def.raw(r) }))
    .filter((x): x is { occSymbol: string; v: number } => x.v != null);
  if (vals.length === 0) return new Set();

  let score: (v: number) => number;
  if (def.rule === 'delta') score = (v) => -Math.abs(v - DELTA_TARGET);
  else if (def.higherBetter === true) score = (v) => v;
  else if (def.higherBetter === false) score = (v) => -v;
  else return new Set();

  const bestScore = Math.max(...vals.map((x) => score(x.v)));
  const out = new Set<string>();
  for (const x of vals) if (Math.abs(score(x.v) - bestScore) < 1e-9) out.add(x.occSymbol);
  return out;
}

export function compareTable(rows: ScreenedRow[]): CompareTable {
  const contracts: CompareContract[] = rows.map((r) => ({
    occSymbol: r.occSymbol,
    symbol: r.symbol,
    label: contractLabel(r),
  }));

  const tableRows: CompareRow[] = COMPARE_METRICS.map((def) => {
    const best = bestInRow(rows, def);
    return {
      key: def.key,
      label: def.displayLabel ?? def.label,
      group: def.group,
      higherBetter: def.higherBetter,
      cells: rows.map((r) => ({
        occSymbol: r.occSymbol,
        symbol: r.symbol,
        raw: def.raw(r),
        formatted: def.format(r),
        best: best.has(r.occSymbol),
      })),
    };
  });

  return { contracts, rows: tableRows };
}

function csvCell(v: string | number | null | undefined): string {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Transposed CSV: one row per metric, one column per contract. Raw values. */
export function compareToCsv(rows: ScreenedRow[]): string {
  const header = ['metric', ...rows.map((r) => r.occSymbol.trim())].join(',');
  const lines = [
    header,
    ['ticker', ...rows.map((r) => r.symbol)].map(csvCell).join(','),
    ['expiration', ...rows.map((r) => r.expiration)].map(csvCell).join(','),
    ['strike', ...rows.map((r) => r.strike)].map(csvCell).join(','),
  ];
  for (const def of COMPARE_METRICS) {
    lines.push([def.label, ...rows.map((r) => def.raw(r))].map(csvCell).join(','));
  }
  return `${lines.join('\n')}\n`;
}
