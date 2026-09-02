/** Brent's method for root-finding on a bracketing interval [a, b]. */

export interface BrentOptions {
  /** Convergence tolerance on the interval width / |f|. */
  tol?: number;
  maxIter?: number;
}

export interface BrentResult {
  ok: boolean;
  root?: number;
  iterations: number;
  reason?: 'not_bracketed' | 'max_iterations';
}

export function brent(
  f: (x: number) => number,
  a: number,
  b: number,
  opts: BrentOptions = {},
): BrentResult {
  const tol = opts.tol ?? 1e-12;
  const maxIter = opts.maxIter ?? 200;

  let fa = f(a);
  let fb = f(b);
  if (fa === 0) return { ok: true, root: a, iterations: 0 };
  if (fb === 0) return { ok: true, root: b, iterations: 0 };
  if (fa * fb > 0) return { ok: false, iterations: 0, reason: 'not_bracketed' };

  if (Math.abs(fa) < Math.abs(fb)) {
    [a, b] = [b, a];
    [fa, fb] = [fb, fa];
  }

  let c = a;
  let fc = fa;
  let d = a;
  let usedBisection = true;

  for (let iter = 1; iter <= maxIter; iter++) {
    let s: number;
    if (fa !== fc && fb !== fc) {
      s =
        (a * fb * fc) / ((fa - fb) * (fa - fc)) +
        (b * fa * fc) / ((fb - fa) * (fb - fc)) +
        (c * fa * fb) / ((fc - fa) * (fc - fb));
    } else {
      s = b - (fb * (b - a)) / (fb - fa);
    }

    const bound1 = (3 * a + b) / 4;
    const outsideBounds = !(s > Math.min(bound1, b) && s < Math.max(bound1, b));
    const slowBisect = usedBisection && Math.abs(s - b) >= Math.abs(b - c) / 2;
    const slowSecant = !usedBisection && Math.abs(s - b) >= Math.abs(c - d) / 2;
    const tinyPrevBisect = usedBisection && Math.abs(b - c) < tol;
    const tinyPrevSecant = !usedBisection && Math.abs(c - d) < tol;

    if (outsideBounds || slowBisect || slowSecant || tinyPrevBisect || tinyPrevSecant) {
      s = (a + b) / 2;
      usedBisection = true;
    } else {
      usedBisection = false;
    }

    const fs = f(s);
    d = c;
    c = b;
    fc = fb;

    if (fa * fs < 0) {
      b = s;
      fb = fs;
    } else {
      a = s;
      fa = fs;
    }

    if (Math.abs(fa) < Math.abs(fb)) {
      [a, b] = [b, a];
      [fa, fb] = [fb, fa];
    }

    if (fs === 0 || Math.abs(b - a) < tol) {
      return { ok: true, root: b, iterations: iter };
    }
  }

  return { ok: false, root: b, iterations: maxIter, reason: 'max_iterations' };
}
