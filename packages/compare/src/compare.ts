/**
 * Compare tab (plan §8.5) — a transposed side-by-side view of up to ~6
 * contracts: one row per metric, one column per contract. Pure logic, no I/O.
 */

import type { SnapshotRow } from '@pss/pipeline';

export type CompareMetric =
  | 'score'
  | 'evToMaxloss'
  | 'annRoc'
  | 'decayYield'
  | 'iv'
  | 'ivRank'
  | 'putSkew25d'
  | 'ivVsFitted'
  | 'delta'
  | 'pop'
  | 'probItm'
  | 'spreadPct'
  | 'entryCredit'
  | 'breakeven'
  | 'dte'
  | 'openInterest'
  | 'flags';

/** How "best-in-row" is decided for a metric. */
export type CompareDirection = 'higher' | 'lower' | 'none';

export interface CompareContract {
  occSymbol: string;
  symbol: string;
  /** Human label, e.g. "AAA 95P 2026-10-16". */
  label: string;
}

export interface CompareRow {
  key: CompareMetric;
  label: string;
  direction: CompareDirection;
  /** One entry per contract, column-aligned with `CompareTable.contracts`. */
  values: Array<number | string | null>;
}

export interface CompareTable {
  contracts: CompareContract[];
  rows: CompareRow[];
}

/** A row that may carry the screen-layer display overrides. */
type ComparableRow = SnapshotRow & { displayAnnRoc?: number | null };

function annRocOf(row: ComparableRow): number | null {
  return row.displayAnnRoc != null ? row.displayAnnRoc : row.annRoc;
}

function flagsOf(row: SnapshotRow): string {
  return Object.entries(row.modelCaution)
    .filter(([, v]) => v)
    .map(([k]) => k)
    .join('|');
}

interface MetricMeta {
  label: string;
  direction: CompareDirection;
  get: (row: ComparableRow) => number | string | null;
}

export const COMPARE_METRIC_META: Record<CompareMetric, MetricMeta> = {
  score: { label: 'Composite score', direction: 'higher', get: (r) => r.score },
  evToMaxloss: { label: 'EV / max-loss', direction: 'higher', get: (r) => r.evToMaxloss },
  annRoc: { label: 'Annualized ROC', direction: 'higher', get: (r) => annRocOf(r) },
  decayYield: { label: 'Decay yield', direction: 'higher', get: (r) => r.decayYield },
  iv: { label: 'Implied vol', direction: 'none', get: (r) => r.iv },
  ivRank: { label: 'IV rank', direction: 'higher', get: (r) => r.ivRank },
  putSkew25d: { label: '25Δ put skew', direction: 'none', get: (r) => r.putSkew25d },
  ivVsFitted: { label: 'IV vs fitted residual', direction: 'higher', get: (r) => r.ivVsFitted },
  // Ranked on distance of |delta| from the 0.25 sweet spot (lower = better).
  delta: { label: 'Delta', direction: 'lower', get: (r) => r.delta },
  pop: { label: 'PoP', direction: 'higher', get: (r) => r.pop },
  probItm: { label: 'P(ITM)', direction: 'lower', get: (r) => r.probItm },
  spreadPct: { label: 'Spread %', direction: 'lower', get: (r) => r.spreadPct },
  entryCredit: { label: 'Entry credit', direction: 'higher', get: (r) => r.entryCredit },
  breakeven: { label: 'Breakeven', direction: 'none', get: (r) => r.breakeven },
  dte: { label: 'DTE', direction: 'none', get: (r) => r.dte },
  openInterest: { label: 'Open interest', direction: 'higher', get: (r) => r.openInterest },
  flags: { label: 'Model caution', direction: 'none', get: (r) => flagsOf(r) },
};

export const DEFAULT_COMPARE_METRICS: CompareMetric[] = [
  'score',
  'evToMaxloss',
  'annRoc',
  'decayYield',
  'iv',
  'ivRank',
  'putSkew25d',
  'ivVsFitted',
  'delta',
  'pop',
  'probItm',
  'spreadPct',
  'entryCredit',
  'breakeven',
  'dte',
  'openInterest',
  'flags',
];

function contractLabel(row: SnapshotRow): string {
  return `${row.symbol} ${row.strike}P ${row.expiration}`;
}

/**
 * Transposed view: one row per metric, one column per contract. Feed it the
 * contracts a user parked in the compare tray (max ~6).
 */
export function transposeContracts(
  rows: SnapshotRow[],
  metricKeys: CompareMetric[] = DEFAULT_COMPARE_METRICS,
): CompareTable {
  const contracts: CompareContract[] = rows.map((r) => ({
    occSymbol: r.occSymbol,
    symbol: r.symbol,
    label: contractLabel(r),
  }));

  const tableRows: CompareRow[] = metricKeys.map((key) => {
    const meta = COMPARE_METRIC_META[key];
    return {
      key,
      label: meta.label,
      direction: meta.direction,
      values: (rows as ComparableRow[]).map((r) => meta.get(r)),
    };
  });

  return { contracts, rows: tableRows };
}

/** Map a stored cell value to the scalar used for ranking (direction-aware). */
function rankScalar(key: CompareMetric, value: number | string | null): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (key === 'delta') return Math.abs(Math.abs(value) - 0.25);
  return value;
}

/**
 * Which contract wins each metric row. Direction-aware; a tie (two contracts
 * share the best value) yields no winner for that row, as does a row where no
 * contract has a comparable value or the metric is not directional.
 */
export function bestInRow(table: CompareTable): Map<CompareMetric, string> {
  const winners = new Map<CompareMetric, string>();

  for (const row of table.rows) {
    if (row.direction === 'none') continue;

    const scored: Array<{ occSymbol: string; scalar: number }> = [];
    row.values.forEach((value, i) => {
      const scalar = rankScalar(row.key, value);
      const contract = table.contracts[i];
      if (scalar != null && contract) scored.push({ occSymbol: contract.occSymbol, scalar });
    });
    if (scored.length === 0) continue;

    const best =
      row.direction === 'higher'
        ? Math.max(...scored.map((s) => s.scalar))
        : Math.min(...scored.map((s) => s.scalar));
    const atBest = scored.filter((s) => Math.abs(s.scalar - best) <= 1e-12);
    if (atBest.length === 1 && atBest[0]) winners.set(row.key, atBest[0].occSymbol);
  }

  return winners;
}

function csvCell(value: number | string | null): string {
  if (value == null) return '';
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Transposed CSV: first column = metric, one further column per contract. */
export function compareToCsv(table: CompareTable): string {
  const header = ['metric', ...table.contracts.map((c) => csvCell(c.occSymbol.trim()))].join(',');
  const body = table.rows
    .map((row) => [csvCell(row.label), ...row.values.map(csvCell)].join(','))
    .join('\n');
  return `${header}\n${body}\n`;
}
