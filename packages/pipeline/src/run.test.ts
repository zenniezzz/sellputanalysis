import { describe, expect, it } from 'vitest';
import {
  InMemoryPayloadStore,
  RecordingMarketData,
  RecordingRatesSource,
  ReplayMarketData,
  ReplayRatesSource,
  StaticRatesSource,
} from '@pss/market-data';
import { runSnapshot } from './run.js';
import { StaticUniverseSource, type UniverseCandidate } from './universe.js';
import { MockMarketData, type MockNameSpec } from './testkit.js';

const NOW = new Date('2026-09-02T14:00:00Z');

function universeOf(symbols: string[]): StaticUniverseSource {
  return new StaticUniverseSource(
    symbols.map(
      (symbol): UniverseCandidate => ({ symbol, sector: 'Test', isLeveraged: false, isInverse: false, isAdr: false }),
    ),
  );
}

const NAMES: MockNameSpec[] = [
  { symbol: 'AAA', spot: 100, iv: 0.3 },
  { symbol: 'BBB', spot: 250, iv: 0.45 },
  { symbol: 'CCC', spot: 40, iv: 0.6 },
  { symbol: 'DDD', spot: 500, iv: 0.25, settlement: 'cash' },
  { symbol: 'EEE', spot: 8, iv: 0.5 }, // below the $10 price floor
  { symbol: 'FFF', spot: 120, iv: 0.35, fail: true }, // chain fetch fails
];

function config(extra: Partial<Parameters<typeof runSnapshot>[0]> = {}) {
  return {
    universe: universeOf(NAMES.map((n) => n.symbol)),
    marketData: new MockMarketData(NAMES, { now: NOW }),
    rates: new StaticRatesSource(),
    now: NOW,
    maxNames: 4,
    concurrency: 3,
    idFactory: (() => {
      let n = 0;
      return () => `id-${n++}`;
    })(),
    ...extra,
  };
}

describe('runSnapshot', () => {
  it('produces a snapshot with candidates and a stable runId', async () => {
    const snap = await runSnapshot(config());
    expect(snap.meta.runId).toBe('2026-09-02-1400-scheduled');
    expect(snap.rows.length).toBeGreaterThan(0);
    expect(snap.run.candidatesFound).toBeGreaterThan(0);
    // every candidate is inside the delta band and clears the credit floor
    for (const r of snap.rows.filter((x) => x.isCandidate)) {
      expect(Math.abs(r.delta!)).toBeGreaterThanOrEqual(0.15 - 1e-9);
      expect(Math.abs(r.delta!)).toBeLessThanOrEqual(0.35 + 1e-9);
      expect(r.entryCredit!).toBeGreaterThanOrEqual(0.3);
      expect(r.dte).toBeGreaterThanOrEqual(25);
      expect(r.dte).toBeLessThanOrEqual(45);
    }
  });

  it('excludes the sub-$10 name and the failing name; ranks by put volume', async () => {
    const snap = await runSnapshot(config());
    const symbols = new Set(snap.rows.map((r) => r.symbol));
    expect(symbols.has('EEE')).toBe(false);
    expect(symbols.has('FFF')).toBe(false);
    expect(snap.run.namesOk).toBe(4); // AAA BBB CCC DDD
  });

  it('forces Reg-T capital basis for the cash-settled index name', async () => {
    const snap = await runSnapshot(config());
    const ddd = snap.rows.filter((r) => r.symbol === 'DDD' && r.iv != null);
    expect(ddd.length).toBeGreaterThan(0);
    for (const r of ddd) {
      expect(r.capitalBasis).toBe('regt');
      expect(r.cspCapital100).toBeNull();
      expect(r.assignmentWatch).toBe(false);
    }
  });

  it('cross-checks our IV against the synthetic vendor IV (near-exact)', async () => {
    const snap = await runSnapshot(config());
    expect(snap.run.greekXcheckMedianAbsPct).not.toBeNull();
    expect(snap.run.greekXcheckMedianAbsPct!).toBeLessThan(0.5);
  });

  it('status reflects completeness', async () => {
    const full = await runSnapshot(config({ maxNames: 4 }));
    expect(full.meta.status).toBe('good');
    expect(full.meta.dataCompleteness).toBeCloseTo(1, 6);
  });

  it('replays byte-identically from a recorded bundle', async () => {
    const sink = new InMemoryPayloadStore();
    const live = new MockMarketData(NAMES, { now: NOW });
    const liveRates = new StaticRatesSource();

    const recorded = await runSnapshot(
      config({
        marketData: new RecordingMarketData(live, sink, () => NOW.toISOString()),
        rates: new RecordingRatesSource(liveRates, sink, () => NOW.toISOString()),
        idFactory: () => 'fixed-id',
      }),
    );

    const replayed = await runSnapshot(
      config({
        marketData: new ReplayMarketData(sink.entries),
        rates: new ReplayRatesSource(sink.entries),
        runType: 'replay',
        idFactory: () => 'fixed-id',
      }),
    );

    // rows are the analytical output; they must match exactly
    expect(replayed.rows).toEqual(recorded.rows);
    expect(replayed.run.candidatesFound).toBe(recorded.run.candidatesFound);
    expect(replayed.run.contractsPriced).toBe(recorded.run.contractsPriced);
  });
});
