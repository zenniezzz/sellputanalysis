/**
 * Pure helpers for the Compare tab (plan §8.5).
 *
 * `transposeContracts` turns a set of selected contracts into a list of metric
 * rows for the transposed comparison table; `bestInRow` picks the direction-aware
 * winner for one metric row (ties → no winner).
 */

import type { ScreenedRow } from '@pss/screen';
import { int, num, pct, score10, usd } from './format';

export interface CompareMetric {
  metric: string;
  label: string;
  /** Display string for a contract's value of this metric. */
  values: (r: ScreenedRow) => string;
  /** Raw numeric value (null when unavailable). */
  raw: (r: ScreenedRow) => number | null;
  /**
   * `true`  → higher is better,
   * `false` → lower is better,
   * `null`  → no meaningful direction (never highlighted). `delta` is special-cased
   *           in `bestInRow` (closest |Δ| to 0.25 wins).
   */
  higherBetter: boolean | null;
}

/** The delta target used for "best in row" on the delta metric. */
export const DELTA_TARGET = 0.25;

const ALL_METRICS: CompareMetric[] = [
  { metric: 'score', label: 'score /10', values: (r) => score10(r.score), raw: (r) => r.score, higherBetter: true },
  {
    metric: 'evToMaxloss',
    label: 'EV / max-loss',
    values: (r) => num(r.evToMaxloss, 3),
    raw: (r) => r.evToMaxloss,
    higherBetter: true,
  },
  {
    metric: 'annRoc',
    label: 'ann ROC',
    values: (r) => pct(r.displayAnnRoc),
    raw: (r) => r.displayAnnRoc,
    higherBetter: true,
  },
  {
    metric: 'decayYield',
    label: 'decay yield',
    values: (r) => pct(r.decayYield, 2),
    raw: (r) => r.decayYield,
    higherBetter: true,
  },
  { metric: 'iv', label: 'IV', values: (r) => pct(r.iv), raw: (r) => r.iv, higherBetter: null },
  {
    metric: 'ivRank',
    label: 'IV rank',
    values: (r) => (r.ivRank == null ? '—' : r.ivRank.toFixed(0)),
    raw: (r) => r.ivRank,
    higherBetter: true,
  },
  {
    metric: 'putSkew25d',
    label: 'put skew 25Δ',
    values: (r) => pct(r.putSkew25d, 2),
    raw: (r) => r.putSkew25d,
    higherBetter: null,
  },
  {
    metric: 'ivVsFitted',
    label: 'IV vs fitted',
    values: (r) => pct(r.ivVsFitted, 2),
    raw: (r) => r.ivVsFitted,
    higherBetter: true,
  },
  { metric: 'delta', label: 'Δ', values: (r) => num(r.delta, 3), raw: (r) => r.delta, higherBetter: null },
  { metric: 'pop', label: 'PoP', values: (r) => pct(r.pop), raw: (r) => r.pop, higherBetter: true },
  { metric: 'probItm', label: 'P(ITM)', values: (r) => pct(r.probItm), raw: (r) => r.probItm, higherBetter: false },
  {
    metric: 'spreadPct',
    label: 'spread %',
    values: (r) => pct(r.spreadPct),
    raw: (r) => r.spreadPct,
    higherBetter: false,
  },
  {
    metric: 'entryCredit',
    label: 'entry credit',
    values: (r) => usd(r.entryCredit),
    raw: (r) => r.entryCredit,
    higherBetter: true,
  },
  {
    metric: 'breakeven',
    label: 'breakeven',
    values: (r) => usd(r.breakeven),
    raw: (r) => r.breakeven,
    higherBetter: null,
  },
  { metric: 'dte', label: 'DTE', values: (r) => String(r.dte), raw: (r) => r.dte, higherBetter: null },
  { metric: 'openInterest', label: 'OI', values: (r) => int(r.openInterest), raw: (r) => r.openInterest, higherBetter: true },
];

/**
 * Metric rows for a transposed compare table. Metrics with no data across any of
 * the given contracts are dropped; with no contracts the full list is returned.
 */
export function transposeContracts(rows: ScreenedRow[]): CompareMetric[] {
  if (rows.length === 0) return ALL_METRICS;
  return ALL_METRICS.filter((m) => rows.some((r) => m.raw(r) != null));
}

/**
 * The occSymbols that hold the best value for one metric row. Direction-aware:
 * `delta` → closest |Δ| to 0.25; `higherBetter` true/false → max/min. A tie (two
 * contracts share the best value) or a metric with no direction returns an empty
 * set, as does a comparison of fewer than two priced values.
 */
export function bestInRow(rows: ScreenedRow[], metricDef: CompareMetric): Set<string> {
  const scored: { occ: string; v: number }[] = [];
  for (const r of rows) {
    let v: number | null;
    if (metricDef.metric === 'delta') {
      v = r.delta == null ? null : Math.abs(Math.abs(r.delta) - DELTA_TARGET);
    } else {
      if (metricDef.higherBetter == null) return new Set();
      v = metricDef.raw(r);
    }
    if (v != null && Number.isFinite(v)) scored.push({ occ: r.occSymbol, v });
  }
  if (scored.length < 2) return new Set();

  // delta and lower-is-better both minimise; higher-is-better maximises.
  const minimise = metricDef.metric === 'delta' || metricDef.higherBetter === false;
  const target = minimise
    ? Math.min(...scored.map((s) => s.v))
    : Math.max(...scored.map((s) => s.v));
  const winners = scored.filter((s) => s.v === target);
  return winners.length === 1 ? new Set([winners[0]!.occ]) : new Set();
}
