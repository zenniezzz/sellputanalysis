import { describe, expect, it } from 'vitest';
import type { UniverseRow } from '@pss/pipeline';
import { aggregateMonthlyPutVolume, type DaySnapshot } from './monthly-put-volume';

function row(overrides: Partial<UniverseRow> & { symbol: string; inWindowPutVolume: number }): UniverseRow {
  return {
    sector: 'Test',
    spot: 100,
    settlement: 'physical',
    inWindowCallVolume: 0,
    putCallRatio: null,
    dailyChangePct: null,
    sigma30: null,
    ivRank: null,
    ivPctile: null,
    ivRankProxy: false,
    putSkew25d: null,
    hv20: null,
    borrowRate: null,
    hardToBorrow: false,
    nextEarnings: null,
    earningsConfirmed: false,
    earningsBeforeNearestMonthly: false,
    candidateCount: 0,
    pricedPutCount: 0,
    ...overrides,
  };
}

describe('aggregateMonthlyPutVolume', () => {
  it('computes avg/total/daysUsed correctly and sorts by average', () => {
    const days: DaySnapshot[] = [
      { day: '2026-09-01', universe: [row({ symbol: 'AAA', inWindowPutVolume: 100 })] },
      { day: '2026-09-02', universe: [row({ symbol: 'AAA', inWindowPutVolume: 300 }), row({ symbol: 'BBB', inWindowPutVolume: 1000 })] },
    ];
    const res = aggregateMonthlyPutVolume(days);
    const aaa = res.rows.find((r) => r.symbol === 'AAA')!;
    const bbb = res.rows.find((r) => r.symbol === 'BBB')!;
    expect(aaa.totalPutVolume).toBe(400);
    expect(aaa.avgPutVolume).toBe(200);
    expect(aaa.daysUsed).toBe(2);
    expect(bbb.totalPutVolume).toBe(1000);
    expect(bbb.avgPutVolume).toBe(1000);
    expect(bbb.daysUsed).toBe(1);
    // BBB's average (1000) beats AAA's (200) despite fewer days
    expect(res.rows[0]!.symbol).toBe('BBB');
  });

  it('uses the most recent day seen for spot/sector', () => {
    const days: DaySnapshot[] = [
      { day: '2026-09-01', universe: [row({ symbol: 'AAA', inWindowPutVolume: 10, spot: 90, sector: 'Old' })] },
      { day: '2026-09-02', universe: [row({ symbol: 'AAA', inWindowPutVolume: 10, spot: 110, sector: 'New' })] },
    ];
    const res = aggregateMonthlyPutVolume(days);
    expect(res.rows[0]!.spot).toBe(110);
    expect(res.rows[0]!.sector).toBe('New');
  });

  it('is insensitive to input day order (sorts internally)', () => {
    const days: DaySnapshot[] = [
      { day: '2026-09-02', universe: [row({ symbol: 'AAA', inWindowPutVolume: 10, spot: 110 })] },
      { day: '2026-09-01', universe: [row({ symbol: 'AAA', inWindowPutVolume: 10, spot: 90 })] },
    ];
    const res = aggregateMonthlyPutVolume(days);
    expect(res.rows[0]!.spot).toBe(110); // still picks 09-02, the later day
  });

  it('caps to `top` rows and reports window metadata', () => {
    const universe = Array.from({ length: 40 }, (_, i) => row({ symbol: `S${i}`, inWindowPutVolume: 40 - i }));
    const days: DaySnapshot[] = [{ day: '2026-09-01', universe }];
    const res = aggregateMonthlyPutVolume(days, { top: 25, windowDays: 30 });
    expect(res.rows).toHaveLength(25);
    expect(res.rows[0]!.symbol).toBe('S0'); // highest volume (40)
    expect(res.windowDays).toBe(30);
    expect(res.daysAvailable).toBe(1);
    expect(res.oldestDay).toBe('2026-09-01');
    expect(res.newestDay).toBe('2026-09-01');
  });

  it('returns an empty result for no days', () => {
    const res = aggregateMonthlyPutVolume([]);
    expect(res.rows).toEqual([]);
    expect(res.daysAvailable).toBe(0);
    expect(res.oldestDay).toBeNull();
    expect(res.newestDay).toBeNull();
  });
});
