import { describe, expect, it } from 'vitest';
import { bsmPrice } from './bsm.js';
import { expectedValue, forecastVol } from './ev.js';
import { mcEvPerShare } from './mc.js';

describe('expectedValue — Monte-Carlo agreement (plan §5.9)', () => {
  const scenarios = [
    { sAdj: 100, k: 92, entryCredit: 1.9, mu: 0.03, sigmaF: 0.28, t: 35 / 365 },
    { sAdj: 250, k: 230, entryCredit: 4.2, mu: 0.045, sigmaF: 0.4, t: 45 / 365 },
    { sAdj: 40, k: 44, entryCredit: 2.6, mu: 0.02, sigmaF: 0.6, t: 20 / 365 }, // ITM
  ];

  it.each(scenarios)('closed form ≈ MC mean within 1% (%o)', (sc) => {
    const closed = expectedValue({ ...sc, multiplier: 100, assignmentFee: 0 }).evPerShare;
    const mc = mcEvPerShare({ ...sc, paths: 400_000, seed: 7 });
    expect(Math.abs(closed - mc.mean)).toBeLessThan(Math.max(0.01 * Math.abs(closed), 4 * mc.stderr));
  });
});

describe('expectedValue — risk-neutral sanity', () => {
  it('undiscounted EV = P·(1 − e^(rT)) when priced at fair value with no VRP haircut and no costs', () => {
    const s = 100;
    const k = 95;
    const r = 0.05;
    const sigma = 0.3;
    const t = 0.25;
    const fair = bsmPrice({ s, k, r, q: 0, sigma, t }, 'put');
    const ev = expectedValue({
      sAdj: s,
      k,
      entryCredit: fair,
      mu: r,
      sigmaF: sigma,
      t,
      multiplier: 100,
      assignmentFee: 0,
    });
    expect(ev.evPerShare).toBeCloseTo(fair * (1 - Math.exp(r * t)), 8);
    expect(ev.evPerShare).toBeLessThan(0); // undiscounted: you carry the premium
  });

  it('a VRP haircut makes EV positive', () => {
    const s = 100;
    const k = 92;
    const r = 0.04;
    const sigmaImplied = 0.35;
    const t = 40 / 365;
    const fair = bsmPrice({ s, k, r, q: 0, sigma: sigmaImplied, t }, 'put');
    const ev = expectedValue({
      sAdj: s,
      k,
      entryCredit: fair,
      mu: r,
      sigmaF: sigmaImplied * 0.9,
      t,
      multiplier: 100,
      assignmentFee: 0,
    });
    expect(ev.evPerShare).toBeGreaterThan(0);
  });
});

describe('expectedValue — companions', () => {
  it('computes breakeven, max loss and ratios', () => {
    const ev = expectedValue({
      sAdj: 100,
      k: 95,
      entryCredit: 2,
      mu: 0.04,
      sigmaF: 0.3,
      t: 0.1,
      multiplier: 100,
    });
    expect(ev.breakeven).toBe(93);
    expect(ev.maxLoss100).toBe(9300);
    expect(ev.creditToMaxLoss).toBeCloseTo(200 / 9300, 10);
    expect(ev.pop).toBeGreaterThan(0);
    expect(ev.pop).toBeLessThan(1);
    expect(ev.probAssigned).toBeGreaterThan(0);
  });
});

describe('forecastVol', () => {
  it('blends, shrinks and haircuts', () => {
    const v = forecastVol({ hv20: 0.3, hv252: 0.28, sigma30: 0.34, sigma30Median: 0.3, lambda: 0.35, vrpHaircut: 0.9 });
    // blend = .35*.3 + .25*.28 + .40*.34 = .311 ; shrink→ .65*.311 + .35*.3 = .30715 ; ×.9
    expect(v).toBeCloseTo(0.30715 * 0.9, 10);
  });

  it('renormalizes when HV inputs are missing', () => {
    const v = forecastVol({ hv20: null, hv252: null, sigma30: 0.4, vrpHaircut: 0.9 });
    expect(v).toBeCloseTo(0.4 * 0.9, 10);
  });

  it('clamps the blend to a sane band', () => {
    const v = forecastVol({ hv20: 10, hv252: 10, sigma30: 10, vrpHaircut: 1 });
    expect(v).toBe(3);
  });
});
