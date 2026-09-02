import bs from 'black-scholes';
import { describe, expect, it } from 'vitest';
import { bsmGreeks, bsmPrice, type BsmInputs } from './bsm.js';

describe('bsmPrice — golden values', () => {
  it('matches Hull 9e §15.9 (S=42, K=40, r=0.10, sigma=0.20, T=0.5, q=0)', () => {
    const inp: BsmInputs = { s: 42, k: 40, r: 0.1, q: 0, sigma: 0.2, t: 0.5 };
    expect(bsmPrice(inp, 'call')).toBeCloseTo(4.759422, 5);
    expect(bsmPrice(inp, 'put')).toBeCloseTo(0.808599, 5);
  });

  it('obeys put–call parity: C − P = S·e^(−qT) − K·e^(−rT)', () => {
    const grid: BsmInputs[] = [];
    for (const s of [80, 100, 130]) {
      for (const k of [90, 100, 110]) {
        for (const t of [0.05, 0.5, 2]) {
          for (const sigma of [0.15, 0.4, 0.9]) {
            for (const r of [0, 0.05]) {
              for (const q of [0, 0.03]) {
                grid.push({ s, k, r, q, sigma, t });
              }
            }
          }
        }
      }
    }
    for (const inp of grid) {
      const lhs = bsmPrice(inp, 'call') - bsmPrice(inp, 'put');
      const rhs = inp.s * Math.exp(-inp.q * inp.t) - inp.k * Math.exp(-inp.r * inp.t);
      expect(lhs).toBeCloseTo(rhs, 9);
    }
  });

  it('cross-checks the black-scholes npm package to 1e-6 (q = 0)', () => {
    for (const s of [90, 100, 115]) {
      for (const k of [95, 100, 108]) {
        for (const t of [0.08, 0.4, 1.5]) {
          for (const sigma of [0.2, 0.55]) {
            for (const r of [0.01, 0.045]) {
              const inp: BsmInputs = { s, k, r, q: 0, sigma, t };
              expect(bsmPrice(inp, 'put')).toBeCloseTo(bs.blackScholes(s, k, t, sigma, r, 'put'), 6);
              expect(bsmPrice(inp, 'call')).toBeCloseTo(bs.blackScholes(s, k, t, sigma, r, 'call'), 6);
            }
          }
        }
      }
    }
  });
});

describe('bsmGreeks — bounds & signs', () => {
  it('put delta ∈ (−1, 0), gamma ≥ 0, vega ≥ 0', () => {
    for (const s of [70, 100, 140]) {
      const g = bsmGreeks({ s, k: 100, r: 0.04, q: 0.01, sigma: 0.35, t: 0.3 }, 'put');
      expect(g.delta).toBeGreaterThan(-1);
      expect(g.delta).toBeLessThan(0);
      expect(g.gamma).toBeGreaterThanOrEqual(0);
      expect(g.vega).toBeGreaterThanOrEqual(0);
    }
  });

  it('REGRESSION (v3.0): a deep-ITM put with a high rate has POSITIVE theta', () => {
    // v2.0 sign-flipped the r/q terms; that bug makes this theta strongly negative.
    const g = bsmGreeks({ s: 50, k: 100, r: 0.1, q: 0, sigma: 0.2, t: 1 }, 'put');
    expect(g.thetaPerYear).toBeGreaterThan(0);
    expect(g.thetaPerYear).toBeCloseTo(9.006, 2);
    expect(g.dailyDecay).toBeLessThan(0); // decay is negative here — the put accretes
  });

  it('ATM 1y put theta matches the closed-form reference', () => {
    // S=K=100, r=5%, q=0, sigma=20%, T=1  →  Θ_put ≈ −1.6579 / yr
    const g = bsmGreeks({ s: 100, k: 100, r: 0.05, q: 0, sigma: 0.2, t: 1 }, 'put');
    expect(g.thetaPerYear).toBeCloseTo(-1.6579, 3);
    expect(g.thetaPerDay).toBeCloseTo(-1.6579 / 365, 6);
    expect(g.dailyDecay).toBeCloseTo(1.6579 / 365, 6);
  });
});

describe('bsmGreeks — finite-difference regression guard (plan §5.9 / §10.5)', () => {
  const base: BsmInputs = { s: 100, k: 95, r: 0.045, q: 0.015, sigma: 0.32, t: 0.35 };

  for (const right of ['put', 'call'] as const) {
    it(`${right}: analytic delta ≈ central difference`, () => {
      const h = 1e-4 * base.s;
      const num =
        (bsmPrice({ ...base, s: base.s + h }, right) - bsmPrice({ ...base, s: base.s - h }, right)) / (2 * h);
      expect(bsmGreeks(base, right).delta).toBeCloseTo(num, 6);
    });

    it(`${right}: analytic gamma ≈ central second difference`, () => {
      const h = 0.25;
      const num =
        (bsmPrice({ ...base, s: base.s + h }, right) -
          2 * bsmPrice(base, right) +
          bsmPrice({ ...base, s: base.s - h }, right)) /
        (h * h);
      const g = bsmGreeks(base, right).gamma;
      expect(Math.abs(num - g) / g).toBeLessThan(5e-3);
    });

    it(`${right}: analytic vega ≈ central difference (÷100)`, () => {
      const h = 1e-4;
      const num =
        (bsmPrice({ ...base, sigma: base.sigma + h }, right) -
          bsmPrice({ ...base, sigma: base.sigma - h }, right)) /
        (2 * h) /
        100;
      expect(bsmGreeks(base, right).vega).toBeCloseTo(num, 6);
    });

    it(`${right}: analytic theta/yr ≈ −dP/dT (central difference)`, () => {
      const h = 1e-4;
      const dPdT =
        (bsmPrice({ ...base, t: base.t + h }, right) - bsmPrice({ ...base, t: base.t - h }, right)) / (2 * h);
      const num = -dPdT;
      const th = bsmGreeks(base, right).thetaPerYear;
      expect(Math.abs(num - th) / Math.abs(th)).toBeLessThan(1e-3);
    });
  }
});
