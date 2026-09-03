/** Evaluate ScreenFilters against snapshot rows (plan §7, §8.4). */

import type { SnapshotRow } from '@pss/pipeline';
import { NUMERIC_FILTER_META, type ScreenFilters, type SortKey } from './filters.js';

export interface ScreenedRow extends SnapshotRow {
  displayCapital100: number | null;
  displayAnnRoc: number | null;
  positionBp: number | null;
  orderSizeVsOiPct: number | null;
}

export interface ScreenResult {
  visible: ScreenedRow[];
  /** occSymbol → human labels of the filters it failed. */
  excludedBy: Map<string, string[]>;
  counts: { priced: number; visible: number; excluded: number };
  /** Single-filter relaxations that would add the most rows, best first. */
  nearestMatches: NearestMatch[];
}

export interface NearestMatch {
  key: keyof ScreenFilters;
  label: string;
  from: number;
  to: number;
  adds: number;
}

/** 3rd Friday of the month = a standard monthly expiration. */
export function isMonthlyExpiration(dateStr: string): boolean {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return d.getUTCDay() === 5 && d.getUTCDate() >= 15 && d.getUTCDate() <= 21;
}

function displayFields(row: SnapshotRow, f: ScreenFilters): ScreenedRow {
  const cashSettled = row.cspCapital100 == null;
  const basis = cashSettled ? 'regt' : f.capitalBasis;
  const capital100 = basis === 'regt' ? row.regtCapital100 : row.cspCapital100;
  const credit100 = row.entryCredit100;
  const annRoc =
    capital100 != null && capital100 > 0 && credit100 != null && row.dte > 0
      ? (credit100 / capital100) * (365 / row.dte)
      : null;
  return {
    ...row,
    displayCapital100: capital100,
    displayAnnRoc: annRoc,
    positionBp: capital100 != null ? capital100 * f.intendedOrderSize : null,
    orderSizeVsOiPct: row.openInterest > 0 ? (f.intendedOrderSize / row.openInterest) * 100 : null,
  };
}

interface Predicate {
  key: keyof ScreenFilters;
  label: string;
  pass: (r: ScreenedRow) => boolean;
}

function predicates(f: ScreenFilters): Predicate[] {
  return [
    { key: 'minUnderlyingPrice', label: `underlying ≥ $${f.minUnderlyingPrice}`, pass: (r) => r.spot >= f.minUnderlyingPrice },
    { key: 'dteMin', label: `DTE ≥ ${f.dteMin}`, pass: (r) => r.dte >= f.dteMin },
    { key: 'dteMax', label: `DTE ≤ ${f.dteMax}`, pass: (r) => r.dte <= f.dteMax },
    { key: 'deltaLo', label: `|Δ| ≥ ${f.deltaLo}`, pass: (r) => r.delta != null && Math.abs(r.delta) >= f.deltaLo - 1e-9 },
    { key: 'deltaHi', label: `|Δ| ≤ ${f.deltaHi}`, pass: (r) => r.delta != null && Math.abs(r.delta) <= f.deltaHi + 1e-9 },
    { key: 'maxSpreadPct', label: `spread ≤ ${(f.maxSpreadPct * 100).toFixed(1)}%`, pass: (r) => r.spreadPct <= f.maxSpreadPct },
    { key: 'minEntryCredit', label: `credit ≥ $${f.minEntryCredit.toFixed(2)}`, pass: (r) => (r.entryCredit ?? 0) >= f.minEntryCredit },
    { key: 'minAnnRoc', label: `annROC ≥ ${(f.minAnnRoc * 100).toFixed(0)}%`, pass: (r) => (r.displayAnnRoc ?? -1) >= f.minAnnRoc },
    { key: 'maxProbItm', label: `P(ITM) ≤ ${(f.maxProbItm * 100).toFixed(0)}%`, pass: (r) => (r.probItm ?? 1) <= f.maxProbItm },
    { key: 'minOpenInterest', label: `OI ≥ ${f.minOpenInterest}`, pass: (r) => r.openInterest >= f.minOpenInterest },
    { key: 'minVolume', label: `volume ≥ ${f.minVolume}`, pass: (r) => r.volume >= f.minVolume },
    {
      key: 'maxOrderSizeVsOiPct',
      label: `order ≤ ${f.maxOrderSizeVsOiPct}% of OI`,
      pass: (r) => r.orderSizeVsOiPct == null || r.orderSizeVsOiPct <= f.maxOrderSizeVsOiPct,
    },
    {
      key: 'minIvRankOrPctile',
      label: `IV ${f.ivRankMode} ≥ ${f.minIvRankOrPctile}`,
      pass: (r) => {
        const v = f.ivRankMode === 'pctile' ? r.ivPctile : r.ivRank;
        // Unknown IV rank (history still accruing) passes unless the user
        // explicitly requires an own-history value.
        if (v == null) return !f.requireOwnIvRank;
        if (f.requireOwnIvRank && r.modelCaution.ivRankProxy) return false;
        return v >= f.minIvRankOrPctile;
      },
    },
    {
      key: 'maxBuyingPowerPerPosition',
      label: f.maxBuyingPowerPerPosition == null ? 'BP/position' : `BP/position ≤ $${f.maxBuyingPowerPerPosition}`,
      pass: (r) => f.maxBuyingPowerPerPosition == null || (r.positionBp ?? 0) <= f.maxBuyingPowerPerPosition,
    },
    {
      key: 'expirationType',
      label: `expiration: ${f.expirationType}`,
      pass: (r) =>
        f.expirationType === 'any' ||
        (f.expirationType === 'monthly' ? isMonthlyExpiration(r.expiration) : !isMonthlyExpiration(r.expiration)),
    },
    {
      key: 'earningsBeforeExpiry',
      label: 'earnings before expiry',
      pass: (r) => f.earningsBeforeExpiry !== 'exclude' || !r.modelCaution.earningsBeforeExpiry,
    },
    { key: 'sectors', label: `sector in {${f.sectors.join(', ')}}`, pass: () => true }, // sector not on the row yet (M3)
    {
      key: 'excludeSymbols',
      label: `not in exclude list`,
      pass: (r) => !f.excludeSymbols.includes(r.symbol.toUpperCase()),
    },
    { key: 'hideBorrow', label: 'hide borrow caution', pass: (r) => !f.hideBorrow || !r.modelCaution.borrow },
    { key: 'hideDividend', label: 'hide dividend caution', pass: (r) => !f.hideDividend || !r.modelCaution.dividend },
    { key: 'hideBelowParity', label: 'hide below-parity', pass: (r) => !f.hideBelowParity || !r.modelCaution.belowParity },
    { key: 'hideIvProxy', label: 'hide IV-rank proxy', pass: (r) => !f.hideIvProxy || !r.modelCaution.ivRankProxy },
  ];
}

function sortValue(r: ScreenedRow, key: SortKey): number | string {
  switch (key) {
    case 'symbol':
      return r.symbol;
    case 'displayCapital':
      return r.displayCapital100 ?? Number.POSITIVE_INFINITY;
    case 'annRoc':
      return r.displayAnnRoc ?? Number.NEGATIVE_INFINITY;
    case 'delta':
      return r.delta == null ? Number.NEGATIVE_INFINITY : Math.abs(r.delta);
    default: {
      const v = (r as unknown as Record<string, unknown>)[key];
      return typeof v === 'number' ? v : Number.NEGATIVE_INFINITY;
    }
  }
}

export function applyScreen(rows: SnapshotRow[], f: ScreenFilters): ScreenResult {
  const priced = rows.filter((r) => r.iv != null).map((r) => displayFields(r, f));
  const preds = predicates(f);
  const excludedBy = new Map<string, string[]>();
  const visible: ScreenedRow[] = [];

  for (const r of priced) {
    const failed = preds.filter((p) => !p.pass(r)).map((p) => p.label);
    if (failed.length === 0) visible.push(r);
    else excludedBy.set(r.occSymbol, failed);
  }

  const dir = f.sortDir === 'asc' ? 1 : -1;
  visible.sort((a, b) => {
    const av = sortValue(a, f.sort);
    const bv = sortValue(b, f.sort);
    if (typeof av === 'string' || typeof bv === 'string') return String(av).localeCompare(String(bv)) * dir;
    return (av - bv) * dir;
  });

  return {
    visible,
    excludedBy,
    counts: { priced: priced.length, visible: visible.length, excluded: excludedBy.size },
    nearestMatches: computeNearestMatches(priced, f),
  };
}

function computeNearestMatches(priced: ScreenedRow[], f: ScreenFilters): NearestMatch[] {
  const baseline = applyCount(priced, f);
  const out: NearestMatch[] = [];

  for (const meta of NUMERIC_FILTER_META) {
    if (meta.key === 'intendedOrderSize') continue;
    const current = f[meta.key] as number;
    // relax "min…" filters toward meta.min, "max…" toward meta.max
    const relaxed = meta.key.startsWith('max') || meta.key === 'deltaHi' ? meta.max : meta.min;
    if (relaxed === current) continue;
    const trial = { ...f, [meta.key]: relaxed } as ScreenFilters;
    const adds = applyCount(priced, trial) - baseline;
    if (adds > 0) out.push({ key: meta.key, label: meta.label, from: current, to: relaxed, adds });
  }
  return out.sort((a, b) => b.adds - a.adds).slice(0, 3);
}

function applyCount(priced: ScreenedRow[], f: ScreenFilters): number {
  const preds = predicates(f);
  const withFields = priced.map((r) => displayFields(r, f));
  return withFields.filter((r) => preds.every((p) => p.pass(r))).length;
}

export interface ContractExplanation {
  occSymbol: string;
  strike: number;
  expiration: string;
  dte: number;
  isVisible: boolean;
  failedFilters: string[];
  pipelineExclusion: string | null;
}

export function explainSymbol(rows: SnapshotRow[], symbol: string, f: ScreenFilters): ContractExplanation[] {
  const sym = symbol.trim().toUpperCase();
  const preds = predicates(f);
  return rows
    .filter((r) => r.symbol.toUpperCase() === sym)
    .map((r) => {
      const priced = r.iv != null;
      const withFields = priced ? displayFields(r, f) : null;
      const failedFilters = withFields ? preds.filter((p) => !p.pass(withFields)).map((p) => p.label) : [];
      return {
        occSymbol: r.occSymbol,
        strike: r.strike,
        expiration: r.expiration,
        dte: r.dte,
        isVisible: priced && failedFilters.length === 0,
        failedFilters,
        pipelineExclusion: priced ? null : (r.excludedReason ?? 'not priced'),
      };
    })
    .sort((a, b) => a.expiration.localeCompare(b.expiration) || a.strike - b.strike);
}
