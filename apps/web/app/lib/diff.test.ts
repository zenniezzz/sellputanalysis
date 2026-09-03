import { describe, expect, it } from 'vitest';
import type { Snapshot, SnapshotRow } from '@pss/pipeline';
import { diffSnapshots } from './diff';

function row(p: Partial<SnapshotRow> & { occSymbol: string; symbol: string }): SnapshotRow {
  return {
    expiration: '2026-10-16',
    strike: 100,
    multiplier: 100,
    dte: 30,
    spot: 105,
    spotAdj: 105,
    bid: 1,
    ask: 1.1,
    mid: 1.05,
    last: 1.05,
    volume: 500,
    openInterest: 1000,
    quoteAsOf: '2026-09-02T14:00:00Z',
    entryCredit: 1,
    entryCredit100: 100,
    midCredit: 1.05,
    slippageK: 0,
    iv: 0.3,
    ivVsFitted: 0,
    ivRank: 0.5,
    ivPctile: 0.5,
    putSkew25d: 0,
    delta: -0.25,
    gamma: 0,
    thetaDay: 0,
    dailyDecay: 0,
    vega: 0,
    moneynessPct: 0,
    spreadPct: 0.05,
    volOi: 0.5,
    decayYield: 0,
    thetaVega: 0,
    breakeven: 99,
    bePct: 0,
    probItm: 0.2,
    pop: 0.8,
    emDistance: 1,
    cspCapital100: 10000,
    regtCapital100: 2000,
    annRoc: 0.2,
    capitalBasis: 'csp',
    ev100: 20,
    maxLoss100: 9900,
    evToMaxloss: 0,
    creditToMaxloss: 0,
    sigmaF: 0.3,
    vrpHaircut: 0,
    mu: 0,
    score: 1,
    scoreComponents: null,
    modelCaution: {
      borrow: false,
      dividend: false,
      ivRankProxy: false,
      belowParity: false,
      earningsBeforeExpiry: false,
      spotAsync: false,
    },
    assignmentWatch: false,
    isCandidate: true,
    excludedReason: null,
    ...p,
  } as SnapshotRow;
}

function snap(runId: string, rows: SnapshotRow[]): Snapshot {
  return {
    meta: { runId } as Snapshot['meta'],
    rows,
    run: {} as Snapshot['run'],
    logs: [],
  };
}

describe('diffSnapshots', () => {
  it('classifies added, dropped, and rank moves over candidates only', () => {
    const prev = snap('r1', [
      row({ occSymbol: 'A', symbol: 'AAA', score: 3, ev100: 30, ivRank: 0.6 }),
      row({ occSymbol: 'B', symbol: 'BBB', score: 2, ev100: 20, ivRank: 0.5 }),
      row({ occSymbol: 'C', symbol: 'CCC', score: 1, ev100: 10 }),
      row({ occSymbol: 'D', symbol: 'DDD', score: 5, isCandidate: false }),
    ]);
    const next = snap('r2', [
      row({ occSymbol: 'A', symbol: 'AAA', score: 1, ev100: 12, ivRank: 0.4 }),
      row({ occSymbol: 'B', symbol: 'BBB', score: 4, ev100: 25, ivRank: 0.55 }),
      row({ occSymbol: 'E', symbol: 'EEE', score: 2 }),
      row({ occSymbol: 'C', symbol: 'CCC', isCandidate: false, excludedReason: 'spread too wide' }),
    ]);

    const d = diffSnapshots(prev, next);
    expect(d.prevRunId).toBe('r1');
    expect(d.nextRunId).toBe('r2');
    expect(d.added.map((x) => x.occSymbol)).toEqual(['E']);
    expect(d.dropped).toEqual([
      { occSymbol: 'C', symbol: 'CCC', expiration: '2026-10-16', strike: 100, reason: 'spread too wide' },
    ]);

    const a = d.moved.find((m) => m.occSymbol === 'A')!;
    expect(a.prevRank).toBe(1);
    expect(a.nextRank).toBe(3);
    expect(a.scoreDelta).toBeCloseTo(-2);
    expect(a.evDelta).toBeCloseTo(-18);
    expect(a.ivRankDelta).toBeCloseTo(-0.2);

    const b = d.moved.find((m) => m.occSymbol === 'B')!;
    expect(b.prevRank).toBe(2);
    expect(b.nextRank).toBe(1);
  });

  it('uses "not in snapshot" when the dropped contract is absent from next', () => {
    const prev = snap('r1', [row({ occSymbol: 'A', symbol: 'AAA', score: 1 })]);
    const next = snap('r2', [row({ occSymbol: 'Z', symbol: 'ZZZ', score: 1 })]);
    const d = diffSnapshots(prev, next);
    expect(d.dropped[0].reason).toBe('not in snapshot');
  });
});
