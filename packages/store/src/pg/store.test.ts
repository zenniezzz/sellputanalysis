import { describe, expect, it } from 'vitest';
import { MockMarketData, runSnapshot, StaticUniverseSource, type MockNameSpec } from '@pss/pipeline';
import { StaticRatesSource } from '@pss/market-data';
import { PgSnapshotStore } from './store.js';
import { toIsoDate } from './util.js';

const DB = process.env['DATABASE_URL'];
const NOW = new Date('2026-09-02T14:00:00Z');
const NAMES: MockNameSpec[] = [
  { symbol: 'AAA', spot: 100, iv: 0.3 },
  { symbol: 'BBB', spot: 250, iv: 0.45 },
];

// Integration test — runs only when a Postgres URL is provided (CI service / local).
describe.skipIf(!DB)('PgSnapshotStore (integration)', () => {
  it('migrates, saves and hydrates a snapshot identically', async () => {
    const { store, close } = await PgSnapshotStore.connect(DB!);
    try {
      await store.migrate();
      const snap = await runSnapshot({
        universe: new StaticUniverseSource(
          NAMES.map((n) => ({ symbol: n.symbol, sector: 'T', isLeveraged: false, isInverse: false, isAdr: false })),
        ),
        marketData: new MockMarketData(NAMES, { now: NOW }),
        rates: new StaticRatesSource(),
        now: NOW,
        maxNames: 2,
        idFactory: () => '11111111-1111-1111-1111-111111111111',
      });

      await store.saveSnapshot(snap);
      await store.saveSnapshot(snap); // idempotent on runId

      const back = await store.getByRunId(snap.meta.runId);
      expect(back?.meta.universeHash).toBe(snap.meta.universeHash);
      expect(back?.rows.length).toBe(snap.rows.length);
      expect(back?.run.candidatesFound).toBe(snap.run.candidatesFound);

      // `date` columns come back from `pg` as JS `Date`s, not strings — a
      // naive `String(v).slice(0, 10)` on the hydrated row silently produced
      // "Fri Oct 16" instead of an ISO date (M7 production-cutover drill).
      // Assert real values here, not just counts, so a regression fails loud.
      expect(back?.meta.snapshotDay).toBe(snap.meta.snapshotDay);
      expect(back?.meta.ratesAsOf).toBe(snap.meta.ratesAsOf);
      for (const row of back?.rows ?? []) {
        const original = snap.rows.find((r) => r.occSymbol === row.occSymbol);
        expect(row.expiration).toBe(original?.expiration);
        expect(row.expiration).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }

      const latest = await store.latest();
      expect(latest?.meta.runId).toBe(snap.meta.runId);
    } finally {
      await close();
    }
  });
});

describe('PgSnapshotStore (unit)', () => {
  it('is constructible with any PgQueryable', () => {
    const fake = { query: async () => ({ rows: [] }) };
    expect(new PgSnapshotStore(fake)).toBeInstanceOf(PgSnapshotStore);
  });
});

describe('toIsoDate', () => {
  it('formats a Date (what pg actually returns for a `date` column)', () => {
    expect(toIsoDate(new Date('2026-10-16T00:00:00.000Z'))).toBe('2026-10-16');
  });

  it('passes through an ISO date string unchanged', () => {
    expect(toIsoDate('2026-10-16')).toBe('2026-10-16');
  });
});
