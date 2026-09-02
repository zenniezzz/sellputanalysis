import { describe, expect, it } from 'vitest';
import {
  bootstrapZeroCurve,
  interpolateZeroRate,
  StaticRatesSource,
  TREASURY_PAR_SNAPSHOT_2026_08_29,
  type ParYieldPoint,
} from './rates.js';

describe('bootstrapZeroCurve', () => {
  it('turns a short-tenor par yield into a slightly higher continuous zero', () => {
    // simple 3-month yield 4.31% → DF = 1/(1+0.0431*0.25); zero = -ln(DF)/0.25
    const z = bootstrapZeroCurve([{ tenorYears: 0.25, parYield: 0.0431 }])[0]!;
    const df = 1 / (1 + 0.0431 * 0.25);
    expect(z.zeroRate).toBeCloseTo(-Math.log(df) / 0.25, 12);
    expect(z.zeroRate).toBeGreaterThan(0.0431 - 0.0005);
  });

  it('bootstraps a flat par curve to a ~flat zero curve', () => {
    const flat: ParYieldPoint[] = [
      { tenorYears: 0.5, parYield: 0.04 },
      { tenorYears: 1, parYield: 0.04 },
      { tenorYears: 2, parYield: 0.04 },
      { tenorYears: 3, parYield: 0.04 },
    ];
    const zeros = bootstrapZeroCurve(flat);
    const cont = 2 * Math.log(1 + 0.04 / 2); // 4% semi-annual → continuous
    for (const z of zeros) {
      if (z.tenorYears > 1) expect(z.zeroRate).toBeCloseTo(cont, 3);
    }
  });

  it('is monotone in tenor for the Treasury snapshot (inverted short end)', () => {
    const zeros = bootstrapZeroCurve(TREASURY_PAR_SNAPSHOT_2026_08_29);
    expect(zeros).toHaveLength(8);
    expect(zeros[0]!.zeroRate).toBeGreaterThan(zeros[7]!.zeroRate); // inverted
  });
});

describe('interpolateZeroRate', () => {
  const curve = bootstrapZeroCurve(TREASURY_PAR_SNAPSHOT_2026_08_29);

  it('flat-extrapolates past the ends', () => {
    expect(interpolateZeroRate(curve, 0)).toBe(curve[0]!.zeroRate);
    expect(interpolateZeroRate(curve, 30)).toBe(curve[curve.length - 1]!.zeroRate);
  });

  it('interpolates linearly between nodes', () => {
    const a = curve[2]!; // 3m
    const b = curve[3]!; // 4m
    const mid = (a.tenorYears + b.tenorYears) / 2;
    expect(interpolateZeroRate(curve, mid)).toBeCloseTo((a.zeroRate + b.zeroRate) / 2, 10);
  });
});

describe('StaticRatesSource', () => {
  it('returns a bootstrapped zero curve', async () => {
    const r = await new StaticRatesSource().getCurve('2026-09-02');
    expect(r.ok && r.value.length).toBe(8);
    if (r.ok) expect(r.value[0]!.zeroRate).toBeGreaterThan(0.04);
  });
});
