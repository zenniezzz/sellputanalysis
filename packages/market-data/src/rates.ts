/**
 * Risk-free curve (plan §3.5).
 *
 * M0: a static US Treasury par-yield snapshot, treated as zero rates for the
 * short tenors that matter to a 25–45 DTE screen (bills are already zeros).
 * M1 replaces this with a live Treasury feed + proper bootstrap.
 */

import { ok, type Iso8601, type RatesSource, type Result, type ZeroRatePoint } from './types.js';

export interface ParYieldPoint {
  tenorYears: number;
  /** Coupon-equivalent par yield, decimal (0.0431 = 4.31%). */
  parYield: number;
}

// home.treasury.gov Daily Treasury Par Yield Curve Rates, 2026-08-29.
// M1: static snapshot; a live Treasury feed replaces this (plan §3.5).
export const TREASURY_PAR_SNAPSHOT_2026_08_29: ParYieldPoint[] = [
  { tenorYears: 1 / 12, parYield: 0.0438 },
  { tenorYears: 2 / 12, parYield: 0.0435 },
  { tenorYears: 3 / 12, parYield: 0.0431 },
  { tenorYears: 4 / 12, parYield: 0.0426 },
  { tenorYears: 6 / 12, parYield: 0.0415 },
  { tenorYears: 1, parYield: 0.0397 },
  { tenorYears: 2, parYield: 0.0372 },
  { tenorYears: 3, parYield: 0.0367 },
];

/**
 * Par-yield curve → continuously-compounded zero curve (plan §3.5).
 *
 * - Tenors ≤ 1y: money-market instrument, simple interest → `DF = 1/(1 + y·t)`.
 * - Tenors > 1y: semi-annual-coupon par-bond bootstrap, using zero rates already
 *   solved for the shorter tenors (linear interpolation / flat extrapolation on
 *   the zero rate for intermediate coupon dates).
 */
export function bootstrapZeroCurve(par: ParYieldPoint[]): ZeroRatePoint[] {
  const pts = [...par].sort((a, b) => a.tenorYears - b.tenorYears);
  const zeros: ZeroRatePoint[] = [];

  const dfAt = (t: number): number => Math.exp(-interpolateZeroRate(zeros, t) * t);

  for (const p of pts) {
    let zeroRate: number;
    if (p.tenorYears <= 1 + 1e-9) {
      const df = 1 / (1 + p.parYield * p.tenorYears);
      zeroRate = -Math.log(df) / p.tenorYears;
    } else {
      const c = p.parYield / 2;
      const n = Math.round(p.tenorYears * 2);
      let couponPv = 0;
      for (let i = 1; i < n; i++) couponPv += c * dfAt(i / 2);
      const dfN = (1 - couponPv) / (1 + c);
      zeroRate = -Math.log(dfN) / p.tenorYears;
    }
    zeros.push({ tenorYears: p.tenorYears, zeroRate });
  }
  return zeros;
}

export class StaticRatesSource implements RatesSource {
  private readonly zeros: ZeroRatePoint[];

  constructor(par: ParYieldPoint[] = TREASURY_PAR_SNAPSHOT_2026_08_29) {
    this.zeros = bootstrapZeroCurve(par);
  }

  async getCurve(_asOf: Iso8601): Promise<Result<ZeroRatePoint[]>> {
    return ok(this.zeros.slice());
  }
}

/** Linear interpolation on zero rates, flat extrapolation past the ends. */
export function interpolateZeroRate(curve: ZeroRatePoint[], tYears: number): number {
  const pts = [...curve].sort((a, b) => a.tenorYears - b.tenorYears);
  if (pts.length === 0) return 0;
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  if (tYears <= first.tenorYears) return first.zeroRate;
  if (tYears >= last.tenorYears) return last.zeroRate;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    if (tYears <= b.tenorYears) {
      const w = (tYears - a.tenorYears) / (b.tenorYears - a.tenorYears);
      return a.zeroRate + w * (b.zeroRate - a.zeroRate);
    }
  }
  return last.zeroRate;
}
