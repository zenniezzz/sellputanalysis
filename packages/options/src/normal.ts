/**
 * Standard-normal pdf, cdf and inverse cdf.
 *
 * cdf: Hart (1968) algorithm as reproduced in Graeme West,
 *      "Better Approximations to Cumulative Normal Functions" (2009).
 *      Absolute error ~1e-15 — well inside the plan's 1e-9 requirement (§10.3).
 * inv: Acklam's rational approximation + one Halley refinement → full double precision.
 */

const SQRT_2PI = Math.sqrt(2 * Math.PI);

export function normalPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / SQRT_2PI;
}

export function normalCdf(x: number): number {
  const z = Math.abs(x);
  if (z > 37) return x > 0 ? 1 : 0;

  const e = Math.exp(-0.5 * z * z);
  let c: number;

  if (z < 7.07106781186547) {
    let n = 3.52624965998911e-2 * z + 0.700383064443688;
    n = n * z + 6.37396220353165;
    n = n * z + 33.912866078383;
    n = n * z + 112.079291497871;
    n = n * z + 221.213596169931;
    n = n * z + 220.206867912376;
    let d = 8.83883476483184e-2 * z + 1.75566716318264;
    d = d * z + 16.064177579207;
    d = d * z + 86.7807322029461;
    d = d * z + 296.564248779674;
    d = d * z + 637.333633378831;
    d = d * z + 793.826512519948;
    d = d * z + 440.413735824752;
    c = (e * n) / d;
  } else {
    let f = z + 0.65;
    f = z + 4.0 / f;
    f = z + 3.0 / f;
    f = z + 2.0 / f;
    f = z + 1.0 / f;
    c = e / f / 2.506628274631;
  }

  return x > 0 ? 1 - c : c;
}

const ACKLAM_A = [
  -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
  1.38357751867269e2, -3.066479806614716e1, 2.506628277459239,
] as const;
const ACKLAM_B = [
  -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
  6.680131188771972e1, -1.328068155288572e1,
] as const;
const ACKLAM_C = [
  -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
  -2.549732539343734, 4.374664141464968, 2.938163982698783,
] as const;
const ACKLAM_D = [
  7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
  3.754408661907416,
] as const;

export function normalInvCdf(p: number): number {
  if (Number.isNaN(p)) return NaN;
  if (p <= 0) return p === 0 ? -Infinity : NaN;
  if (p >= 1) return p === 1 ? Infinity : NaN;

  const pLow = 0.02425;
  const pHigh = 1 - pLow;
  let x: number;

  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    x =
      (((((ACKLAM_C[0] * q + ACKLAM_C[1]) * q + ACKLAM_C[2]) * q + ACKLAM_C[3]) * q + ACKLAM_C[4]) * q + ACKLAM_C[5]) /
      ((((ACKLAM_D[0] * q + ACKLAM_D[1]) * q + ACKLAM_D[2]) * q + ACKLAM_D[3]) * q + 1);
  } else if (p <= pHigh) {
    const q = p - 0.5;
    const r = q * q;
    x =
      ((((((ACKLAM_A[0] * r + ACKLAM_A[1]) * r + ACKLAM_A[2]) * r + ACKLAM_A[3]) * r + ACKLAM_A[4]) * r + ACKLAM_A[5]) * q) /
      (((((ACKLAM_B[0] * r + ACKLAM_B[1]) * r + ACKLAM_B[2]) * r + ACKLAM_B[3]) * r + ACKLAM_B[4]) * r + 1);
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    x =
      -(((((ACKLAM_C[0] * q + ACKLAM_C[1]) * q + ACKLAM_C[2]) * q + ACKLAM_C[3]) * q + ACKLAM_C[4]) * q + ACKLAM_C[5]) /
      ((((ACKLAM_D[0] * q + ACKLAM_D[1]) * q + ACKLAM_D[2]) * q + ACKLAM_D[3]) * q + 1);
  }

  // one Halley step against the high-accuracy cdf
  const err = normalCdf(x) - p;
  const u = err * SQRT_2PI * Math.exp(0.5 * x * x);
  return x - u / (1 + 0.5 * x * u);
}
