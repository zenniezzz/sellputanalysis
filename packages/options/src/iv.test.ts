import { describe, expect, it } from 'vitest';
import { bsmGreeks, bsmPrice } from './bsm.js';
import { impliedVol } from './iv.js';

describe('impliedVol', () => {
  it('round-trips across a wide grid to 1e-6 (for meaningfully-priced options)', () => {
    for (const s of [80, 100, 125]) {
      for (const k of [85, 100, 115]) {
        for (const t of [0.03, 0.25, 1.2]) {
          for (const r of [0.01, 0.05]) {
            for (const trueSigma of [0.08, 0.2, 0.55, 1.3]) {
              const price = bsmPrice({ s, k, r, q: 0, sigma: trueSigma, t }, 'put');
              // IV is only identifiable where vega is non-negligible — i.e. not
              // deep ITM/OTM. The screener only solves IV for near/OTM candidates
              // that clear the min-credit filter, so restrict the grid the same way.
              const vega = bsmGreeks({ s, k, r, q: 0, sigma: trueSigma, t }, 'put').vega;
              if (price < 0.1 || vega < 0.02) continue;
              const res = impliedVol(price, { s, k, r, q: 0, t }, 'put');
              expect(res.ok).toBe(true);
              if (res.ok) expect(res.iv).toBeCloseTo(trueSigma, 6);
            }
          }
        }
      }
    }
  });

  it('recovers 20% vol from the Hull put price', () => {
    const price = bsmPrice({ s: 42, k: 40, r: 0.1, q: 0, sigma: 0.2, t: 0.5 }, 'put');
    const res = impliedVol(price, { s: 42, k: 40, r: 0.1, q: 0, t: 0.5 }, 'put');
    expect(res.ok && res.iv).toBeCloseTo(0.2, 8);
  });

  it('rejects a price below intrinsic', () => {
    const intrinsic = 40 * Math.exp(-0.05 * 0.5) - 42; // negative → clamp at 0-ish; use ITM
    void intrinsic;
    const res = impliedVol(0.1, { s: 30, k: 45, r: 0.05, q: 0, t: 0.5 }, 'put');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.failure).toBe('below_intrinsic');
  });

  it('rejects a price above the K·e^(−rT) ceiling', () => {
    const res = impliedVol(999, { s: 100, k: 100, r: 0.05, q: 0, t: 0.5 }, 'put');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.failure).toBe('above_max');
  });

  it('converges in a small number of iterations', () => {
    const price = bsmPrice({ s: 100, k: 95, r: 0.04, q: 0, sigma: 0.42, t: 0.3 }, 'put');
    const res = impliedVol(price, { s: 100, k: 95, r: 0.04, q: 0, t: 0.3 }, 'put');
    expect(res.ok && res.iterations).toBeLessThan(60);
  });
});
