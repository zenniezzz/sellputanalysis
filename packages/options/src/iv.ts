/**
 * Implied-volatility solver (plan §5.3).
 *
 * Brent on `BSM_put(σ) − target = 0` over [loVol, hiVol]. `BSM_put` is monotone
 * in σ with range [discounted intrinsic, K·e^(−rT)], so a sign change exists
 * unless the target price is below intrinsic (deep-ITM below parity / stale
 * quote) or above the upper bound (arbitrage).
 */

import { brent } from './brent.js';
import { bsmPrice, type BsmInputs, type OptionRight } from './bsm.js';

export type IvFailure = 'below_intrinsic' | 'above_max' | 'no_convergence' | 'roundtrip_failed';

export type IvResult =
  | { ok: true; iv: number; iterations: number }
  | { ok: false; failure: IvFailure };

export interface IvOptions {
  loVol?: number;
  hiVol?: number;
  /** Round-trip price tolerance (§5.3 uses 0.005). */
  priceTol?: number;
  brentTol?: number;
}

export function impliedVol(
  targetPrice: number,
  inp: Omit<BsmInputs, 'sigma'>,
  right: OptionRight = 'put',
  opts: IvOptions = {},
): IvResult {
  const loVol = opts.loVol ?? 0.005;
  const hiVol = opts.hiVol ?? 5;
  const priceTol = opts.priceTol ?? 0.005;
  const brentTol = opts.brentTol ?? 1e-10;

  const priceAt = (sigma: number) => bsmPrice({ ...inp, sigma }, right);

  if (targetPrice < priceAt(loVol) - priceTol) return { ok: false, failure: 'below_intrinsic' };
  if (targetPrice > priceAt(hiVol) + priceTol) return { ok: false, failure: 'above_max' };

  const res = brent((sigma) => priceAt(sigma) - targetPrice, loVol, hiVol, {
    tol: brentTol,
    maxIter: 100,
  });
  if (!res.ok || res.root === undefined) return { ok: false, failure: 'no_convergence' };

  if (Math.abs(priceAt(res.root) - targetPrice) > priceTol) {
    return { ok: false, failure: 'roundtrip_failed' };
  }
  return { ok: true, iv: res.root, iterations: res.iterations };
}
