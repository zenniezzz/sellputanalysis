/**
 * Black–Scholes–Merton price and analytic greeks (per share).
 *
 * Per the plan §5: pass the dividend-adjusted spot with `q = 0` when a discrete
 * dividend schedule is used, or the raw spot with a continuous `q` as a fallback.
 *
 * Theta convention (§2.1): `thetaPerYear` is calendar-time theta (negative for
 * most long options). The screener ranks on `dailyDecay = -thetaPerDay`.
 *
 * v3.0: the put-theta `r` and `q` terms were sign-flipped in plan v2.0; the
 * corrected form is
 *   Θ_put = −S·e^(−qT)·n(d1)·σ/(2√T) + r·K·e^(−rT)·N(−d2) − q·S·e^(−qT)·N(−d1)
 * The finite-difference test in bsm.test.ts is the regression guard.
 */

import { normalCdf, normalPdf } from './normal.js';

export type OptionRight = 'put' | 'call';

export interface BsmInputs {
  /** Spot (dividend-adjusted, with q = 0) or raw spot (with a continuous q). */
  s: number;
  k: number;
  /** Continuously-compounded annualized risk-free rate. */
  r: number;
  /** Continuously-compounded annualized dividend yield (0 when s is PV-adjusted). */
  q: number;
  /** Implied volatility, decimal (0.30 = 30%). */
  sigma: number;
  /** Time to expiry in years. */
  t: number;
}

export interface Greeks {
  price: number;
  delta: number;
  gamma: number;
  /** Vega per 1 vol point (i.e. dP/dσ ÷ 100). */
  vega: number;
  /** Calendar-time theta per year. Negative for most long options. */
  thetaPerYear: number;
  /** thetaPerYear / 365. */
  thetaPerDay: number;
  /** −thetaPerDay: extrinsic value collected per calendar day (positive). */
  dailyDecay: number;
  d1: number;
  d2: number;
}

function d1d2(inp: BsmInputs): [number, number] {
  const vSqrtT = inp.sigma * Math.sqrt(inp.t);
  const d1 = (Math.log(inp.s / inp.k) + (inp.r - inp.q + 0.5 * inp.sigma * inp.sigma) * inp.t) / vSqrtT;
  return [d1, d1 - vSqrtT];
}

export function bsmPrice(inp: BsmInputs, right: OptionRight): number {
  const { s, k, r, q, sigma, t } = inp;
  if (t <= 0 || sigma <= 0) {
    return right === 'put' ? Math.max(k - s, 0) : Math.max(s - k, 0);
  }
  const [d1, d2] = d1d2(inp);
  const dfR = Math.exp(-r * t);
  const dfQ = Math.exp(-q * t);
  return right === 'call'
    ? s * dfQ * normalCdf(d1) - k * dfR * normalCdf(d2)
    : k * dfR * normalCdf(-d2) - s * dfQ * normalCdf(-d1);
}

export function bsmGreeks(inp: BsmInputs, right: OptionRight): Greeks {
  const { s, k, r, q, sigma, t } = inp;

  if (t <= 0 || sigma <= 0) {
    const price = right === 'put' ? Math.max(k - s, 0) : Math.max(s - k, 0);
    const itm = right === 'put' ? s < k : s > k;
    return {
      price,
      delta: itm ? (right === 'put' ? -1 : 1) : 0,
      gamma: 0,
      vega: 0,
      thetaPerYear: 0,
      thetaPerDay: 0,
      dailyDecay: 0,
      d1: NaN,
      d2: NaN,
    };
  }

  const [d1, d2] = d1d2(inp);
  const dfR = Math.exp(-r * t);
  const dfQ = Math.exp(-q * t);
  const pdfD1 = normalPdf(d1);
  const sqrtT = Math.sqrt(t);

  const price = bsmPrice(inp, right);
  const gamma = (dfQ * pdfD1) / (s * sigma * sqrtT);
  const vega = (s * dfQ * pdfD1 * sqrtT) / 100;
  const commonTheta = -(s * dfQ * pdfD1 * sigma) / (2 * sqrtT);

  let delta: number;
  let thetaPerYear: number;
  if (right === 'call') {
    delta = dfQ * normalCdf(d1);
    thetaPerYear = commonTheta - r * k * dfR * normalCdf(d2) + q * s * dfQ * normalCdf(d1);
  } else {
    delta = -dfQ * normalCdf(-d1);
    thetaPerYear = commonTheta + r * k * dfR * normalCdf(-d2) - q * s * dfQ * normalCdf(-d1);
  }

  const thetaPerDay = thetaPerYear / 365;
  return { price, delta, gamma, vega, thetaPerYear, thetaPerDay, dailyDecay: -thetaPerDay, d1, d2 };
}
