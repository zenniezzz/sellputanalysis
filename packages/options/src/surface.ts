/**
 * Per-expiration volatility smile (plan §5.6).
 *
 * v1: a quadratic in log-moneyness `x = ln(K / S)`, fit by iteratively
 * reweighted least squares with a Huber loss so a few wild quotes don't drag the
 * curve. Leave-one-out residuals (`iv − fit_excluding_that_point`) are the
 * surface-relative richness signal that feeds the M2.5 composite score. SVI is a
 * v1.1 upgrade.
 *
 * `σ30` (30-day constant-maturity ATM vol) is obtained by interpolating **total
 * variance** (`σ² · T`) linearly between the two bracketing expirations.
 */

import { normalInvCdf } from './normal.js';

export interface SmilePoint {
  /** ln(strike / spot). */
  x: number;
  iv: number;
}

export interface QuadFit {
  a: number;
  b: number;
  c: number;
  /** RMS of the final weighted residuals. */
  rms: number;
  n: number;
}

export function smileIvAt(fit: Pick<QuadFit, 'a' | 'b' | 'c'>, x: number): number {
  return fit.a + fit.b * x + fit.c * x * x;
}

function solve3x3(A: number[][], y: number[]): [number, number, number] | null {
  // Gaussian elimination with partial pivoting.
  const m = A.map((row, i) => [...row, y[i]!]);
  for (let col = 0; col < 3; col++) {
    let piv = col;
    for (let r = col + 1; r < 3; r++) if (Math.abs(m[r]![col]!) > Math.abs(m[piv]![col]!)) piv = r;
    if (Math.abs(m[piv]![col]!) < 1e-12) return null;
    [m[col], m[piv]] = [m[piv]!, m[col]!];
    for (let r = 0; r < 3; r++) {
      if (r === col) continue;
      const f = m[r]![col]! / m[col]![col]!;
      for (let k = col; k < 4; k++) m[r]![k]! -= f * m[col]![k]!;
    }
  }
  return [m[0]![3]! / m[0]![0]!, m[1]![3]! / m[1]![1]!, m[2]![3]! / m[2]![2]!];
}

function weightedQuad(points: SmilePoint[], weights: number[]): QuadFit | null {
  let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0;
  let t0 = 0, t1 = 0, t2 = 0;
  for (let i = 0; i < points.length; i++) {
    const { x, iv } = points[i]!;
    const w = weights[i]!;
    const x2 = x * x;
    s0 += w; s1 += w * x; s2 += w * x2; s3 += w * x2 * x; s4 += w * x2 * x2;
    t0 += w * iv; t1 += w * iv * x; t2 += w * iv * x2;
  }
  const coef = solve3x3(
    [
      [s0, s1, s2],
      [s1, s2, s3],
      [s2, s3, s4],
    ],
    [t0, t1, t2],
  );
  if (!coef) return null;
  const [a, b, c] = coef;
  let sse = 0;
  let wsum = 0;
  for (let i = 0; i < points.length; i++) {
    const r = points[i]!.iv - (a + b * points[i]!.x + c * points[i]!.x ** 2);
    sse += weights[i]! * r * r;
    wsum += weights[i]!;
  }
  return { a, b, c, rms: Math.sqrt(sse / Math.max(wsum, 1e-9)), n: points.length };
}

/** Huber IRLS quadratic fit. Returns null if fewer than 4 usable points. */
export function fitSmile(points: SmilePoint[], iterations = 6): QuadFit | null {
  const usable = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.iv) && p.iv > 0);
  if (usable.length < 4) return null;

  let weights = new Array(usable.length).fill(1);
  let fit = weightedQuad(usable, weights);
  if (!fit) return null;

  for (let it = 0; it < iterations; it++) {
    const scale = Math.max(fit.rms, 1e-4);
    const k = 1.345 * scale;
    weights = usable.map((p) => {
      const r = Math.abs(p.iv - smileIvAt(fit!, p.x));
      return r <= k ? 1 : k / r;
    });
    const next = weightedQuad(usable, weights);
    if (!next) break;
    fit = next;
  }
  return fit;
}

/** `iv − (fit computed without this point)` for each input point; null if it can't be fit. */
export function leaveOneOutResiduals(points: SmilePoint[]): (number | null)[] {
  return points.map((p, i) => {
    const rest = points.filter((_, j) => j !== i);
    const fit = fitSmile(rest);
    return fit ? p.iv - smileIvAt(fit, p.x) : null;
  });
}

export interface ExpirationAtmVar {
  t: number; // years to expiry
  atmIv: number;
}

/** 30-day constant-maturity ATM vol via linear interpolation of total variance. */
export function constantMaturityIv(points: ExpirationAtmVar[], targetDays = 30): number | null {
  const pts = points
    .filter((p) => p.t > 0 && p.atmIv > 0)
    .map((p) => ({ t: p.t, w: p.atmIv * p.atmIv * p.t }))
    .sort((a, b) => a.t - b.t);
  if (pts.length === 0) return null;
  const target = targetDays / 365;
  if (pts.length === 1) return Math.sqrt(pts[0]!.w / pts[0]!.t);

  if (target <= pts[0]!.t) return Math.sqrt(pts[0]!.w / pts[0]!.t);
  const last = pts.at(-1)!;
  if (target >= last.t) return Math.sqrt(last.w / last.t);

  for (let i = 1; i < pts.length; i++) {
    const lo = pts[i - 1]!;
    const hi = pts[i]!;
    if (target <= hi.t) {
      const frac = (target - lo.t) / (hi.t - lo.t);
      const w = lo.w + frac * (hi.w - lo.w);
      return Math.sqrt(w / target);
    }
  }
  return Math.sqrt(last.w / last.t);
}

/**
 * Put skew = IV(25Δ put) − σ30, read off the fitted smile.
 * The 25Δ-put log-moneyness is derived from `d1 = z(0.75)` using the ATM vol.
 */
export function putSkew25Delta(
  fit: Pick<QuadFit, 'a' | 'b' | 'c'>,
  atmIv: number,
  sigma30: number,
  rate: number,
  q: number,
  t: number,
): number {
  const z = -normalInvCdf(0.25); // ≈ 0.6745; delta_put = −N(−d1) = −0.25 ⇒ d1 = z
  const sqrtT = Math.sqrt(t);
  // x = ln(K/S) such that d1 = [−x + (r−q+σ²/2)t] / (σ√t) = z
  const x25 = (rate - q + 0.5 * atmIv * atmIv) * t - z * atmIv * sqrtT;
  return smileIvAt(fit, x25) - sigma30;
}
