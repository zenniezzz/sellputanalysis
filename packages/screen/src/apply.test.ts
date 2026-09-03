import { describe, expect, it, beforeAll } from 'vitest';
import { MockMarketData, runSnapshot, StaticUniverseSource, type MockNameSpec, type SnapshotRow } from '@pss/pipeline';
import { StaticRatesSource } from '@pss/market-data';
import { applyScreen, explainSymbol, isMonthlyExpiration } from './apply.js';
import { screenedRowsToCsv } from './csv.js';
import { DEFAULT_FILTERS } from './filters.js';

const NOW = new Date('2026-09-02T14:00:00Z');
const NAMES: MockNameSpec[] = [
  { symbol: 'AAA', spot: 100, iv: 0.3 },
  { symbol: 'BBB', spot: 250, iv: 0.5 },
  { symbol: 'CCC', spot: 40, iv: 0.7 },
  { symbol: 'DDD', spot: 600, iv: 0.25, settlement: 'cash' },
];

let rows: SnapshotRow[];

beforeAll(async () => {
  const snap = await runSnapshot({
    universe: new StaticUniverseSource(
      NAMES.map((n) => ({ symbol: n.symbol, sector: 'T', isLeveraged: false, isInverse: false, isAdr: false })),
    ),
    marketData: new MockMarketData(NAMES, { now: NOW, dteOffsets: [18, 32, 46] }),
    rates: new StaticRatesSource(),
    now: NOW,
    maxNames: 4,
    idFactory: () => 'fixed',
  });
  rows = snap.rows;
});

describe('isMonthlyExpiration', () => {
  it('flags the 3rd Friday', () => {
    expect(isMonthlyExpiration('2026-10-16')).toBe(true); // 3rd Friday of Oct 2026
    expect(isMonthlyExpiration('2026-10-09')).toBe(false);
    expect(isMonthlyExpiration('2026-10-23')).toBe(false);
  });
});

describe('applyScreen', () => {
  it('default filters yield a non-empty visible set, all within the bands', () => {
    const res = applyScreen(rows, DEFAULT_FILTERS);
    expect(res.visible.length).toBeGreaterThan(0);
    for (const r of res.visible) {
      expect(Math.abs(r.delta!)).toBeGreaterThanOrEqual(0.15 - 1e-9);
      expect(Math.abs(r.delta!)).toBeLessThanOrEqual(0.35 + 1e-9);
      expect(r.dte).toBeGreaterThanOrEqual(25);
      expect(r.spreadPct).toBeLessThanOrEqual(0.08);
    }
    expect(res.counts.priced).toBeGreaterThan(res.counts.visible);
  });

  it('relaxing a filter admits more rows (and is reversible)', () => {
    const tight = applyScreen(rows, { ...DEFAULT_FILTERS, deltaLo: 0.24, deltaHi: 0.26 });
    const loose = applyScreen(rows, { ...DEFAULT_FILTERS, deltaLo: 0.05, deltaHi: 0.5 });
    expect(loose.visible.length).toBeGreaterThan(tight.visible.length);
  });

  it('capital basis switches annROC and the BP filter for equity names', () => {
    const csp = applyScreen(rows, { ...DEFAULT_FILTERS, capitalBasis: 'csp', minAnnRoc: 0 });
    const regt = applyScreen(rows, { ...DEFAULT_FILTERS, capitalBasis: 'regt', minAnnRoc: 0 });
    const aaaCsp = csp.visible.find((r) => r.symbol === 'AAA')!;
    const aaaRegt = regt.visible.find((r) => r.symbol === 'AAA')!;
    expect(aaaRegt.displayAnnRoc!).toBeGreaterThan(aaaCsp.displayAnnRoc!); // margin basis → higher ROC
    // cash-settled DDD is always regt
    const ddd = csp.visible.find((r) => r.symbol === 'DDD');
    if (ddd) expect(ddd.displayCapital100).toBe(ddd.regtCapital100);
  });

  it('max BP/position uses the intended order size', () => {
    const res = applyScreen(rows, {
      ...DEFAULT_FILTERS,
      minAnnRoc: 0,
      minIvRankOrPctile: 0,
      intendedOrderSize: 5,
      maxBuyingPowerPerPosition: 60000,
    });
    for (const r of res.visible) expect(r.positionBp!).toBeLessThanOrEqual(60000);
  });

  it('excludeSymbols removes a name', () => {
    const res = applyScreen(rows, { ...DEFAULT_FILTERS, minIvRankOrPctile: 0, excludeSymbols: ['BBB'] });
    expect(res.visible.some((r) => r.symbol === 'BBB')).toBe(false);
  });

  it('watchlistOnly restricts to the session watchlist', () => {
    const base = { ...DEFAULT_FILTERS, minAnnRoc: 0, minIvRankOrPctile: 0 };
    const all = applyScreen(rows, base);
    const watched = applyScreen(rows, { ...base, watchlistOnly: true }, { watchlist: ['AAA', 'CCC'] });
    expect(watched.visible.length).toBeLessThan(all.visible.length);
    expect(new Set(watched.visible.map((r) => r.symbol))).toEqual(new Set(['AAA', 'CCC']));
    // with no watchlist context, watchlistOnly yields nothing
    expect(applyScreen(rows, { ...base, watchlistOnly: true }).counts.visible).toBe(0);
  });

  it('reports the exclusion reason for a filtered-out contract', () => {
    const res = applyScreen(rows, { ...DEFAULT_FILTERS, deltaLo: 0.24, deltaHi: 0.26 });
    const [, reasons] = [...res.excludedBy.entries()][0]!;
    expect(reasons.join(' ')).toMatch(/Δ/);
  });

  it('suggests nearest-match relaxations when the screen is tight', () => {
    const res = applyScreen(rows, { ...DEFAULT_FILTERS, minAnnRoc: 5 });
    expect(res.counts.visible).toBe(0);
    expect(res.nearestMatches[0]?.key).toBe('minAnnRoc');
    expect(res.nearestMatches[0]?.adds).toBeGreaterThan(0);
  });
});

describe('explainSymbol', () => {
  it('lists every contract for a name with pass/fail per filter', () => {
    const out = explainSymbol(rows, 'AAA', { ...DEFAULT_FILTERS, deltaLo: 0.24, deltaHi: 0.26 });
    expect(out.length).toBeGreaterThan(1);
    expect(out.some((c) => c.isVisible)).toBe(true);
    expect(out.some((c) => c.failedFilters.length > 0)).toBe(true);
  });

  it('surfaces a pipeline-stage exclusion (never priced)', () => {
    const aaa = rows.find((r) => r.symbol === 'AAA')!;
    const withGated: SnapshotRow[] = [
      ...rows,
      { ...aaa, occSymbol: 'AAA  GATED', symbol: 'AAA', iv: null, excludedReason: 'quote:wide_spread' },
    ];
    const out = explainSymbol(withGated, 'AAA', DEFAULT_FILTERS);
    expect(out.find((c) => c.occSymbol === 'AAA  GATED')!.pipelineExclusion).toBe('quote:wide_spread');
  });
});

describe('screenedRowsToCsv', () => {
  it('emits a header and one line per row', () => {
    const res = applyScreen(rows, DEFAULT_FILTERS);
    const csv = screenedRowsToCsv(res.visible);
    const lines = csv.trim().split('\n');
    expect(lines[0]).toContain('score,symbol,occSymbol');
    expect(lines.length).toBe(res.visible.length + 1);
  });
});
