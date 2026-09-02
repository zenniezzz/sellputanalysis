import { describe, expect, it } from 'vitest';
import { annualizedVol, parseStooqCsv } from './history.js';

describe('annualizedVol', () => {
  it('returns null when there is not enough data', () => {
    expect(annualizedVol([1, 2, 3], 20)).toBeNull();
  });

  it('is zero for a flat series', () => {
    expect(annualizedVol(new Array(30).fill(100), 20)).toBeCloseTo(0, 12);
  });

  it('recovers a known daily vol', () => {
    // alternating ±1% moves → daily stdev ≈ 0.01 → annualized ≈ 0.01*sqrt(252)
    const closes = [100];
    for (let i = 1; i <= 260; i++) closes.push(closes[i - 1]! * (i % 2 ? 1.01 : 1 / 1.01));
    const hv = annualizedVol(closes, 252)!;
    expect(hv).toBeGreaterThan(0.1);
    expect(hv).toBeLessThan(0.2);
  });
});

describe('parseStooqCsv', () => {
  it('extracts closes and the last date', () => {
    const csv = 'Date,Open,High,Low,Close,Volume\n2026-08-31,10,11,9,10.5,1000\n2026-09-01,10.5,12,10,11.2,2000\n';
    const { closes, asOf } = parseStooqCsv(csv);
    expect(closes).toEqual([10.5, 11.2]);
    expect(asOf).toBe('2026-09-01');
  });

  it('throws on a non-Stooq body', () => {
    expect(() => parseStooqCsv('<html>nope</html>')).toThrow();
  });
});
