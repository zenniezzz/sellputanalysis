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
  { symbol: 'EEE', spot: 3, iv: 0.5 }, // below the $5 price floor
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

  it('excludes the sub-$5 name and the failing name; ranks by put volume', async () => {
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

  it('fits a smile: flat vendor IV ⇒ ~zero skew and ~zero residual', async () => {
    const snap = await runSnapshot(config());
    const resid = snap.rows
      .filter((r) => r.iv != null && r.ivVsFitted != null)
      .map((r) => Math.abs(r.ivVsFitted!))
      .sort((a, b) => a - b);
    expect(resid.length).toBeGreaterThan(0);
    // flat vendor IV + penny-rounded quotes: the bulk of residuals hug zero,
    // a real skew would push the whole distribution up by vol points.
    expect(resid[Math.floor(resid.length / 2)]!).toBeLessThan(2e-3);
    const skew = snap.rows.map((r) => r.putSkew25d).filter((s): s is number => s != null).sort((a, b) => a - b);
    expect(Math.abs(skew[Math.floor(skew.length / 2)]!)).toBeLessThan(2e-3);
  });

  it('uses real IV rank when history is supplied, else the proxy flag', async () => {
    const withHistory = await runSnapshot(
      config({
        ivHistory: async (symbol) =>
          Array.from({ length: 90 }, (_, i) => ({
            date: `2026-06-${String((i % 28) + 1).padStart(2, '0')}`,
            atmIv30d: symbol === 'AAA' ? 0.2 + (i / 89) * 0.4 : 0.4,
            hv20: 0.25,
          })),
      }),
    );
    const aaa = withHistory.rows.find((r) => r.symbol === 'AAA' && r.ivRank != null);
    expect(aaa).toBeDefined();
    expect(aaa!.modelCaution.ivRankProxy).toBe(false);
    expect(aaa!.ivRank!).toBeGreaterThan(0);
    expect(aaa!.ivRank!).toBeLessThanOrEqual(100);

    const noHistory = await runSnapshot(config());
    for (const r of noHistory.rows.filter((x) => x.isCandidate)) {
      expect(r.modelCaution.ivRankProxy).toBe(true);
    }
  });

  it('scores every priced row and orders candidates by score', async () => {
    const snap = await runSnapshot(config());
    expect(snap.meta.scoreBasis).toBe('cross_sectional'); // no reference supplied
    const candidates = snap.rows.filter((r) => r.isCandidate);
    for (const r of candidates) {
      expect(r.score).not.toBeNull();
      expect(r.scoreComponents).not.toBeNull();
      expect(r.scoreComponents).toHaveProperty('penalty');
    }
    // rows are sorted by score desc
    const scores = candidates.map((r) => r.score!);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    // unpriced (quote-gated / iv-failed) rows carry no score
    for (const r of snap.rows.filter((r) => r.iv == null)) expect(r.score).toBeNull();
  });

  it('scoreBasis follows the supplied reference depth', async () => {
    const full = Object.fromEntries(
      ['evToMaxloss', 'annRoc', 'ivVsFitted', 'ivRank', 'spreadPct', 'deltaFromCenter'].map((m) => [
        m,
        { mean: m === 'ivRank' ? 45 : 0.1, stddev: m === 'ivRank' ? 18 : 0.05, nDays: 400 },
      ]),
    );
    const snap = await runSnapshot(config({ metricReference: async () => full }));
    expect(snap.meta.scoreBasis).toBe('reference');
    expect(snap.rows.filter((r) => r.isCandidate).every((r) => r.score != null)).toBe(true);
  });

  it('builds a universe rollup: one row per priced name, ranked by put volume', async () => {
    const snap = await runSnapshot(config());
    expect(snap.universe.map((u) => u.symbol).sort()).toEqual(['AAA', 'BBB', 'CCC', 'DDD']);
    for (const u of snap.universe) {
      expect(u.spot).toBeGreaterThan(0);
      expect(u.pricedPutCount).toBeGreaterThan(0);
      expect(u.candidateCount).toBeLessThanOrEqual(u.pricedPutCount);
      expect(u.sigma30).toBeGreaterThan(0);
      expect(u.putCallRatio).toBeGreaterThan(0);
    }
    // sorted by in-window put volume desc
    const vols = snap.universe.map((u) => u.inWindowPutVolume);
    expect(vols).toEqual([...vols].sort((a, b) => b - a));
    // DDD is the cash-settled index name
    expect(snap.universe.find((u) => u.symbol === 'DDD')?.settlement).toBe('cash');
  });

  it('emits one σ30 history sample per priced name', async () => {
    const snap = await runSnapshot(config());
    const symbols = new Set(snap.ivSamples.map((s) => s.symbol));
    expect(symbols).toEqual(new Set(['AAA', 'BBB', 'CCC', 'DDD']));
    for (const s of snap.ivSamples) {
      expect(s.date).toBe('2026-09-02');
      expect(s.atmIv30d).toBeGreaterThan(0);
      expect(s.source).toBe('own');
    }
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

describe('includeLeveragedInverse (plan §4.3)', () => {
  const leveragedUniverse = new StaticUniverseSource([
    { symbol: 'AAA', sector: 'Test', isLeveraged: true, isInverse: false, isAdr: false },
    { symbol: 'BBB', sector: 'Test', isLeveraged: false, isInverse: false, isAdr: false },
  ]);

  it('excludes leveraged/inverse names by default', async () => {
    const snap = await runSnapshot(config({ universe: leveragedUniverse, maxNames: 2 }));
    expect(snap.rows.some((r) => r.symbol === 'AAA')).toBe(false);
    expect(snap.rows.some((r) => r.symbol === 'BBB')).toBe(true);
  });

  it('includes them when includeLeveragedInverse is set', async () => {
    const snap = await runSnapshot(config({ universe: leveragedUniverse, maxNames: 2, includeLeveragedInverse: true }));
    expect(snap.rows.some((r) => r.symbol === 'AAA')).toBe(true);
  });
});

describe('displayDelayed licensing gate (plan §3.9)', () => {
  it('defaults true for the shipped (delayed) provider, no config needed', async () => {
    const snap = await runSnapshot(config());
    expect(snap.meta.provider).toBe('cboe-delayed');
    expect(snap.meta.displayDelayed).toBe(true);
  });

  it('cannot be forced to false for an unlicensed provider — a config override is ignored', async () => {
    const snap = await runSnapshot(config({ displayDelayed: false }));
    expect(snap.meta.displayDelayed).toBe(true);
  });

  it('stays true even for an unrecognized/unconfirmed provider name', async () => {
    const snap = await runSnapshot(config({ provider: 'some-new-realtime-feed', displayDelayed: false }));
    expect(snap.meta.displayDelayed).toBe(true);
  });
});
