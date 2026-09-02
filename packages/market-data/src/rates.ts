/**
 * Risk-free curve (plan §3.5).
 *
 * M0: a static US Treasury par-yield snapshot, treated as zero rates for the
 * short tenors that matter to a 25–45 DTE screen (bills are already zeros).
 * M1 replaces this with a live Treasury feed + proper bootstrap.
 */

import { ok, type Iso8601, type RatesSource, type Result, type ZeroRatePoint } from './types.js';

// home.treasury.gov Daily Treasury Par Yield Curve Rates, 2026-08-29.
export const TREASURY_SNAPSHOT_2026_08_29: ZeroRatePoint[] = [
  { tenorYears: 1 / 12, zeroRate: 0.0438 },
  { tenorYears: 2 / 12, zeroRate: 0.0435 },
  { tenorYears: 3 / 12, zeroRate: 0.0431 },
  { tenorYears: 4 / 12, zeroRate: 0.0426 },
  { tenorYears: 6 / 12, zeroRate: 0.0415 },
  { tenorYears: 1, zeroRate: 0.0397 },
  { tenorYears: 2, zeroRate: 0.0372 },
  { tenorYears: 3, zeroRate: 0.0367 },
];

export class StaticRatesSource implements RatesSource {
  constructor(private readonly curve: ZeroRatePoint[] = TREASURY_SNAPSHOT_2026_08_29) {}

  async getCurve(_asOf: Iso8601): Promise<Result<ZeroRatePoint[]>> {
    return ok(this.curve.slice());
  }
}

/** Linear interpolation on zero rates, flat extrapolation past the ends. */
export function interpolateZeroRate(curve: ZeroRatePoint[], tYears: number): number {
  const pts = [...curve].sort((a, b) => a.tenorYears - b.tenorYears);
  if (pts.length === 0) throw new Error('empty rate curve');
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
