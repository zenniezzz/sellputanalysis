import { describe, expect, it } from 'vitest';
import { ivRankFromHistory, type IvHistoryPoint } from './iv-rank.js';

function series(vals: number[], hv?: number[]): IvHistoryPoint[] {
  return vals.map((v, i) => ({
    date: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
    atmIv30d: v,
    hv20: hv ? hv[i] ?? null : null,
  }));
}

describe('ivRankFromHistory', () => {
  it('uses real IV history once ≥ 60 days exist', () => {
    const hist = series(Array.from({ length: 120 }, (_, i) => 0.2 + (i / 119) * 0.2)); // 0.20 → 0.40
    const r = ivRankFromHistory({ atmIv30d: 0.3, hv20: null }, hist);
    expect(r.basis).toBe('own');
    expect(r.ivRank).toBeCloseTo(50, 0);
    expect(r.ivPctile).toBeGreaterThan(40);
    expect(r.ivPctile).toBeLessThan(60);
  });

  it('reports 100 at the top of the range and 0 at the bottom', () => {
    const hist = series(Array.from({ length: 80 }, (_, i) => 0.15 + i * 0.001));
    expect(ivRankFromHistory({ atmIv30d: 0.5, hv20: null }, hist).ivRank).toBe(100);
    expect(ivRankFromHistory({ atmIv30d: 0.05, hv20: null }, hist).ivRank).toBe(0);
  });

  it('falls back to the HV proxy when IV history is short', () => {
    const hv = Array.from({ length: 50 }, (_, i) => 0.18 + (i / 49) * 0.12);
    const hist = series(new Array(50).fill(0.3), hv);
    const r = ivRankFromHistory({ atmIv30d: 0.3, hv20: 0.24 }, hist);
    expect(r.basis).toBe('hv_proxy');
    expect(r.ivRank).toBeCloseTo(50, 0);
  });

  it('returns insufficient with no usable history', () => {
    const r = ivRankFromHistory({ atmIv30d: 0.3, hv20: null }, series([0.3, 0.31, 0.29]));
    expect(r).toMatchObject({ basis: 'insufficient', ivRank: null, ivPctile: null });
  });
});
