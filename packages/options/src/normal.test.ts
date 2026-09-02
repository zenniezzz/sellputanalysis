import { describe, expect, it } from 'vitest';
import { normalCdf, normalInvCdf, normalPdf } from './normal.js';

describe('normalCdf', () => {
  // Reference values to 16 sig figs.
  const cases: [number, number][] = [
    [0, 0.5],
    [1, 0.8413447460685429],
    [-1, 0.15865525393145707],
    [2, 0.9772498680518208],
    [-2, 0.02275013194817921],
    [3, 0.9986501019683699],
    [-3, 0.0013498980316301035],
    [1.959963984540054, 0.975],
    [-1.959963984540054, 0.025],
    [6, 0.9999999990134124],
  ];

  it.each(cases)('N(%f) ≈ %f', (x, expected) => {
    expect(normalCdf(x)).toBeCloseTo(expected, 12);
  });

  it('is symmetric: N(x) + N(-x) = 1', () => {
    for (let x = -6; x <= 6; x += 0.37) {
      expect(normalCdf(x) + normalCdf(-x)).toBeCloseTo(1, 13);
    }
  });

  it('saturates in the far tails', () => {
    expect(normalCdf(40)).toBe(1);
    expect(normalCdf(-40)).toBe(0);
  });
});

describe('normalPdf', () => {
  it('matches known values', () => {
    expect(normalPdf(0)).toBeCloseTo(0.3989422804014327, 15);
    expect(normalPdf(1)).toBeCloseTo(0.24197072451914337, 15);
    expect(normalPdf(-1)).toBeCloseTo(0.24197072451914337, 15);
  });
});

describe('normalInvCdf', () => {
  it('matches known quantiles', () => {
    expect(normalInvCdf(0.5)).toBeCloseTo(0, 12);
    expect(normalInvCdf(0.975)).toBeCloseTo(1.959963984540054, 10);
    expect(normalInvCdf(0.025)).toBeCloseTo(-1.959963984540054, 10);
    expect(normalInvCdf(0.8413447460685429)).toBeCloseTo(1, 10);
  });

  it('round-trips with normalCdf', () => {
    for (let p = 0.001; p < 1; p += 0.017) {
      expect(normalCdf(normalInvCdf(p))).toBeCloseTo(p, 12);
    }
  });

  it('handles the boundaries', () => {
    expect(normalInvCdf(0)).toBe(-Infinity);
    expect(normalInvCdf(1)).toBe(Infinity);
    expect(Number.isNaN(normalInvCdf(-0.1))).toBe(true);
  });
});
