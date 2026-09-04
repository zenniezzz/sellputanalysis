import { beforeAll, describe, expect, it } from 'vitest';
import {
  MockMarketData,
  runSnapshot,
  StaticUniverseSource,
  type MockNameSpec,
  type ModelCaution,
  type Snapshot,
  type SnapshotRow,
} from '@pss/pipeline';
import { StaticRatesSource } from '@pss/market-data';
import { diffSnapshots } from './diff.js';

const NOW = new Date('2026-09-02T14:00:00Z');

function universeOf(symbols: string[]): StaticUniverseSource {
  return new StaticUniverseSource(
    symbols.map((symbol) => ({ symbol, sector: 'T', isLeveraged: false, isInverse: false, isAdr: false })),
  );
}

async function snap(names: MockNameSpec[], runType: 'scheduled' | 'ondemand'): Promise<Snapshot> {
  return runSnapshot({
    universe: universeOf(names.map((n) => n.symbol)),
    marketData: new MockMarketData(names, { now: NOW, dteOffsets: [18, 32, 46] }),
    rates: new StaticRatesSource(),
    now: NOW,
    runType,
    maxNames: 4,
    idFactory: () => 'fixed',
  });
}

const NAMES_A: MockNameSpec[] = [
  { symbol: 'AAA', spot: 100, iv: 0.3 },
  { symbol: 'BBB', spot: 250, iv: 0.5 },
  { symbol: 'CCC', spot: 40, iv: 0.7 },
];
// Same names, AAA's vol doubled → different strikes land in the delta band.
const NAMES_B: MockNameSpec[] = [
  { symbol: 'AAA', spot: 100, iv: 0.6 },
  { symbol: 'BBB', spot: 250, iv: 0.5 },
  { symbol: 'CCC', spot: 40, iv: 0.7 },
];

let prev: Snapshot;
let next: Snapshot;

beforeAll(async () => {
  prev = await snap(NAMES_A, 'scheduled');
  next = await snap(NAMES_B, 'ondemand');
});

const candSet = (s: Snapshot) => new Set(s.rows.filter((r) => r.isCandidate).map((r) => r.occSymbol));

describe('diffSnapshots (pipeline-built snapshots)', () => {
  it('carries the run ids and an unchanged metric schema', () => {
    const d = diffSnapshots(prev, next);
    expect(d.prevRunId).toBe('2026-09-02-1400-scheduled');
    expect(d.nextRunId).toBe('2026-09-02-1400-ondemand');
    expect(d.metricSchemaChanged).toBe(false);
  });

  it('added = candidate in next but not prev; dropped = the reverse', () => {
    const d = diffSnapshots(prev, next);
    const prevC = candSet(prev);
    const nextC = candSet(next);

    expect(d.added.length + d.dropped.length).toBeGreaterThan(0);
    for (const a of d.added) {
      expect(nextC.has(a.occSymbol)).toBe(true);
      expect(prevC.has(a.occSymbol)).toBe(false);
    }
    for (const drop of d.dropped) {
      expect(prevC.has(drop.occSymbol)).toBe(true);
      expect(nextC.has(drop.occSymbol)).toBe(false);
      expect(typeof drop.reason).toBe('string');
    }
  });

  it('moved = candidate in both with a changed score-rank, with deltas', () => {
    const d = diffSnapshots(prev, next);
    const prevC = candSet(prev);
    const nextC = candSet(next);
    for (const m of d.moved) {
      expect(prevC.has(m.occSymbol) && nextC.has(m.occSymbol)).toBe(true);
      expect(m.prevRank).not.toBe(m.nextRank);
    }
    // AAA's vol shift reshuffles the cross-sectional ranking somewhere.
    expect(d.moved.length).toBeGreaterThan(0);
  });

  it('a snapshot diffed against itself is empty', () => {
    const d = diffSnapshots(prev, prev);
    expect(d.added).toEqual([]);
    expect(d.dropped).toEqual([]);
    expect(d.moved).toEqual([]);
  });
});

// --- hand-built snapshots: exercise the drop reason + schema-change flag ---

const NO_CAUTION: ModelCaution = {
  borrow: false,
  dividend: false,
  ivRankProxy: false,
  belowParity: false,
  earningsBeforeExpiry: false,
  spotAsync: false,
};

function row(over: Partial<SnapshotRow>): SnapshotRow {
  return {
    occSymbol: 'X',
    symbol: 'X',
    expiration: '2026-10-16',
    strike: 100,
    multiplier: 100,
    dte: 35,
    spot: 100,
    spotAdj: 100,
    bid: 1,
    ask: 1.1,
    mid: 1.05,
    last: 1.05,
    volume: 500,
    openInterest: 4000,
    quoteAsOf: NOW.toISOString(),
    entryCredit: 1,
    entryCredit100: 100,
    midCredit: 1.05,
    slippageK: 0.05,
    iv: 0.3,
    ivVsFitted: 0,
    ivRank: 40,
    ivPctile: 40,
    putSkew25d: 0,
    delta: -0.25,
    gamma: 0.02,
    thetaDay: -0.03,
    dailyDecay: 0.03,
    vega: 0.1,
    moneynessPct: 0,
    spreadPct: 0.05,
    volOi: 0.1,
    decayYield: 0.02,
    thetaVega: 0.3,
    breakeven: 99,
    bePct: -1,
    probItm: 0.2,
    pop: 0.8,
    emDistance: 1,
    cspCapital100: 10000,
    regtCapital100: 2000,
    annRoc: 0.2,
    capitalBasis: 'csp',
    ev100: 20,
    maxLoss100: 9900,
    evToMaxloss: 0.002,
    creditToMaxloss: 0.01,
    sigmaF: 0.27,
    vrpHaircut: 0.9,
    mu: 0.04,
    score: 0,
    scoreComponents: null,
    modelCaution: { ...NO_CAUTION },
    assignmentWatch: false,
    isCandidate: true,
    excludedReason: null,
    ...over,
  };
}

function mkSnapshot(runId: string, rows: SnapshotRow[], metricSchemaVersion = 1): Snapshot {
  return {
    meta: {
      id: runId,
      runId,
      createdAt: NOW.toISOString(),
      snapshotDay: '2026-09-02',
      runType: 'scheduled',
      status: 'good',
      dataCompleteness: 1,
      scoreBasis: 'cross_sectional',
      metricSchemaVersion,
      ratesAsOf: '2026-08-29',
      universeHash: 'h',
      provider: 'mock',
      displayDelayed: false,
      filterDefaults: {
        dteMin: 25,
        dteMax: 45,
        deltaLo: 0.15,
        deltaHi: 0.35,
        maxSpreadPct: 0.08,
        minEntryCredit: 0.3,
        minAnnRoc: 0.12,
        maxProbItm: 0.35,
        minOpenInterest: 500,
        minVolume: 100,
        minUnderlyingPrice: 10,
      },
    },
    rows,
    universe: [],
    run: {
      runId,
      startedAt: NOW.toISOString(),
      finishedAt: NOW.toISOString(),
      namesOk: 1,
      namesFailed: 0,
      contractsPriced: rows.length,
      ivSolveFailures: 0,
      candidatesFound: rows.filter((r) => r.isCandidate).length,
      greekXcheckMedianAbsPct: null,
      status: 'good',
    },
    logs: [],
  };
}

describe('diffSnapshots (hand-built)', () => {
  const keep = row({ occSymbol: 'KEEP', symbol: 'KEEP', score: 0.9 });
  const gone = row({ occSymbol: 'GONE', symbol: 'GONE', score: 0.5 });
  const fresh = row({ occSymbol: 'FRESH', symbol: 'FRESH', score: 0.7 });

  it('uses the next-snapshot excludedReason when a dropped contract is still present', () => {
    const prevS = mkSnapshot('r1', [keep, gone]);
    const nextS = mkSnapshot('r2', [
      { ...keep, score: 0.3 }, // rank unchanged (still only 2 candidates → keep is #1)
      { ...gone, isCandidate: false, excludedReason: 'gate:delta_band' },
      fresh,
    ]);
    const d = diffSnapshots(prevS, nextS);
    expect(d.added.map((c) => c.occSymbol)).toEqual(['FRESH']);
    expect(d.dropped).toHaveLength(1);
    expect(d.dropped[0]!.occSymbol).toBe('GONE');
    expect(d.dropped[0]!.reason).toBe('gate:delta_band');
    // KEEP: rank 1 → rank 2 (FRESH scores higher), so it moved with a score delta.
    expect(d.moved.map((m) => m.occSymbol)).toEqual(['KEEP']);
    expect(d.moved[0]!.scoreDelta).toBeCloseTo(-0.6);
  });

  it("falls back to 'not in snapshot' when the contract is absent from next", () => {
    const d = diffSnapshots(mkSnapshot('r1', [keep, gone]), mkSnapshot('r2', [keep]));
    expect(d.dropped[0]!.reason).toBe('not in snapshot');
  });

  it('flags a metric-schema change', () => {
    const d = diffSnapshots(mkSnapshot('r1', [keep], 1), mkSnapshot('r2', [keep], 2));
    expect(d.metricSchemaChanged).toBe(true);
  });
});
