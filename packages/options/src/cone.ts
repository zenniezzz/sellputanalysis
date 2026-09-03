/**
 * P&L probability profile for a short put held to expiry (plan §8.4).
 *
 * Sweeps terminal underlying price `S_T` and returns, at each point, the
 * position P&L and the forecast-measure density / cdf of `S_T` — enough to draw
 * the payoff "hockey stick" under a probability cone with the loss region
 * (below breakeven) shaded. `expectedPnl100` integrates to `expectedValue`'s
 * `ev100` (before assignment costs); the test asserts this.
 */

import { normalCdf, normalInvCdf, normalPdf } from './normal.js';

export interface PnlProfileInputs {
  /** Dividend-adjusted spot. */
  sAdj: number;
  k: number;
  entryCredit: number;
  /** Forecast drift (= r − q), annualized. */
  mu: number;
  /** Forecast volatility (see forecastVol). */
  sigmaF: number;
  /** Years to expiry. */
  t: number;
  multiplier: number;
  /** Sample count across the swept range. */
  points?: number;
}

export interface PnlProfilePoint {
  sT: number;
  pnl100: number;
  /** Forecast pdf of S_T at sT. */
  pdf: number;
  /** P(S_T ≤ sT). */
  cdf: number;
}

export interface PnlProfile {
  points: PnlProfilePoint[];
  spot: number;
  strike: number;
  breakeven: number;
  maxProfit100: number;
  maxLoss100: number;
  expectedPnl100: number;
  probProfit: number;
  probMaxProfit: number;
  probAssigned: number;
  quantiles: { p05: number; p25: number; p50: number; p75: number; p95: number };
}

function shortPutPnl100(sT: number, breakeven: number, entryCredit: number, multiplier: number): number {
  return Math.min(entryCredit, sT - breakeven) * multiplier;
}

export function pnlProfile(inp: PnlProfileInputs): PnlProfile {
  const { sAdj, k, entryCredit, mu, sigmaF, t, multiplier } = inp;
  const n = inp.points ?? 160;

  const m = Math.log(sAdj) + (mu - 0.5 * sigmaF * sigmaF) * t;
  const s = sigmaF * Math.sqrt(t);
  const quantile = (p: number) => Math.exp(m + s * normalInvCdf(p));
  const pdfAt = (x: number) => (x <= 0 ? 0 : normalPdf((Math.log(x) - m) / s) / (x * s));
  const cdfAt = (x: number) => (x <= 0 ? 0 : normalCdf((Math.log(x) - m) / s));

  const breakeven = k - entryCredit;
  const lo = Math.max(quantile(0.002), 0.01);
  const hi = Math.max(quantile(0.998), k * 1.15);
  const step = (hi - lo) / (n - 1);

  const points: PnlProfilePoint[] = [];
  let expectedPnl = 0;
  for (let i = 0; i < n; i++) {
    const sT = lo + i * step;
    const pdf = pdfAt(sT);
    points.push({ sT, pnl100: shortPutPnl100(sT, breakeven, entryCredit, multiplier), pdf, cdf: cdfAt(sT) });
    if (i > 0) {
      // trapezoidal ∫ pnl·pdf dS over the swept range
      const prev = points[i - 1]!;
      expectedPnl += ((prev.pnl100 * prev.pdf + points[i]!.pnl100 * pdf) / 2) * step;
    }
  }
  // Exact tail contributions beyond [lo, hi].
  // Upper: S_T > hi ⇒ payoff capped at the credit.
  expectedPnl += entryCredit * multiplier * (1 - cdfAt(hi));
  // Lower: S_T < lo ⇒ payoff = (S_T − B). Use the lognormal partial expectation
  //   E[S_T · 1{S_T < x}] = E[S_T] · N((ln x − m − s²)/s).
  const eST = Math.exp(m + 0.5 * s * s);
  const partialExpBelow = (x: number) => eST * normalCdf((Math.log(x) - m - s * s) / s);
  expectedPnl += multiplier * (partialExpBelow(lo) - breakeven * cdfAt(lo));

  return {
    points,
    spot: inp.sAdj,
    strike: k,
    breakeven,
    maxProfit100: entryCredit * multiplier,
    maxLoss100: breakeven * multiplier,
    expectedPnl100: expectedPnl,
    probProfit: 1 - cdfAt(breakeven),
    probMaxProfit: 1 - cdfAt(k),
    probAssigned: cdfAt(k),
    quantiles: {
      p05: quantile(0.05),
      p25: quantile(0.25),
      p50: quantile(0.5),
      p75: quantile(0.75),
      p95: quantile(0.95),
    },
  };
}
