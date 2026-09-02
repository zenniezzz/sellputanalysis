import { describe, expect, it } from 'vitest';
import { interpolateZeroRate, StaticRatesSource, TREASURY_SNAPSHOT_2026_08_29 } from './rates.js';

describe('interpolateZeroRate', () => {
  const curve = TREASURY_SNAPSHOT_2026_08_29;

  it('returns endpoints for out-of-range tenors', () => {
    expect(interpolateZeroRate(curve, 0)).toBe(0.0438);
    expect(interpolateZeroRate(curve, 30)).toBe(0.0367);
  });

  it('interpolates linearly between nodes', () => {
    // halfway between 3/12 (0.0431) and 4/12 (0.0426)
    expect(interpolateZeroRate(curve, 3.5 / 12)).toBeCloseTo(0.04285, 6);
  });

  it('hits a node exactly', () => {
    expect(interpolateZeroRate(curve, 1)).toBe(0.0397);
  });
});

describe('StaticRatesSource', () => {
  it('returns the snapshot', async () => {
    const r = await new StaticRatesSource().getCurve('2026-09-02');
    expect(r.ok && r.value.length).toBe(8);
  });
});
