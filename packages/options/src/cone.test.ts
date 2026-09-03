import { describe, expect, it } from 'vitest';
import { expectedValue } from './ev.js';
import { pnlProfile } from './cone.js';
import { mcEvPerShare } from './mc.js';

const BASE = {
  sAdj: 100,
  k: 92,
  entryCredit: 1.9,
  mu: 0.04,
  sigmaF: 0.3,
  t: 35 / 365,
  multiplier: 100,
};

describe('pnlProfile', () => {
  it('the payoff caps at the credit above the strike and is linear below breakeven', () => {
    const p = pnlProfile(BASE);
    const above = p.points.filter((pt) => pt.sT > BASE.k + 5);
    for (const pt of above) expect(pt.pnl100).toBeCloseTo(BASE.entryCredit * 100, 6);
    const bottom = p.points[0]!;
    expect(bottom.pnl100).toBeCloseTo((bottom.sT - p.breakeven) * 100, 6);
    expect(p.maxProfit100).toBe(190);
    expect(p.maxLoss100).toBeCloseTo(9010, 6);
  });

  it('expected P&L integrates to expectedValue.ev100 (no assignment cost)', () => {
    const p = pnlProfile({ ...BASE, points: 400 });
    const ev = expectedValue({ ...BASE, assignmentFee: 0 });
    expect(p.expectedPnl100).toBeCloseTo(ev.ev100, 0); // within ~$1 on a ~$190 credit
  });

  it('expected P&L matches a Monte-Carlo of the same forecast lognormal', () => {
    const p = pnlProfile({ ...BASE, points: 400 });
    const mc = mcEvPerShare({ ...BASE, paths: 400_000, seed: 11 });
    expect(Math.abs(p.expectedPnl100 / 100 - mc.mean)).toBeLessThan(Math.max(0.01 * Math.abs(mc.mean), 4 * mc.stderr));
  });

  it('probabilities are consistent and ordered', () => {
    const p = pnlProfile(BASE);
    expect(p.probAssigned + p.probMaxProfit).toBeCloseTo(1, 6);
    expect(p.probProfit).toBeGreaterThan(p.probMaxProfit);
    expect(p.quantiles.p05).toBeLessThan(p.quantiles.p50);
    expect(p.quantiles.p50).toBeLessThan(p.quantiles.p95);
    // median of a low-drift lognormal sits a touch below spot
    expect(p.quantiles.p50).toBeGreaterThan(90);
    expect(p.quantiles.p50).toBeLessThan(101);
  });

  it('a deep-OTM put is almost surely max profit', () => {
    const p = pnlProfile({ ...BASE, k: 70 });
    expect(p.probMaxProfit).toBeGreaterThan(0.95);
    expect(p.probProfit).toBeGreaterThan(0.96);
  });
});
