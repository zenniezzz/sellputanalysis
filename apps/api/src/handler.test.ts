import { describe, expect, it } from 'vitest';
import { MockMarketData, runSnapshot, StaticUniverseSource, type MockNameSpec } from '@pss/pipeline';
import { StaticRatesSource } from '@pss/market-data';
import type { Snapshot } from '@pss/pipeline';
import type { SnapshotStore } from '@pss/store';
import { handle } from './handler.js';

const NAMES: MockNameSpec[] = [
  { symbol: 'AAA', spot: 100, iv: 0.3 },
  { symbol: 'BBB', spot: 250, iv: 0.45 },
];

async function snap(): Promise<Snapshot> {
  return runSnapshot({
    universe: new StaticUniverseSource(
      NAMES.map((n) => ({ symbol: n.symbol, sector: 'T', isLeveraged: false, isInverse: false, isAdr: false })),
    ),
    marketData: new MockMarketData(NAMES, { now: new Date('2026-09-02T14:00:00Z') }),
    rates: new StaticRatesSource(),
    now: new Date('2026-09-02T14:00:00Z'),
    maxNames: 2,
    idFactory: () => 'fixed',
  });
}

function storeWith(s: Snapshot | null): SnapshotStore {
  return {
    saveSnapshot: async () => {},
    latest: async () => s,
    getById: async (id) => (s && s.meta.id === id ? s : null),
    getByRunId: async (r) => (s && s.meta.runId === r ? s : null),
    list: async () => (s ? [s.meta] : []),
  };
}

describe('api handler', () => {
  it('serves the latest snapshot as JSON with only candidates', async () => {
    const s = await snap();
    const res = await handle('GET', '/api/snapshots/latest', storeWith(s));
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.counts.candidates).toBe(s.run.candidatesFound);
    expect(body.candidates.every((r: { isCandidate: boolean }) => r.isCandidate)).toBe(true);
  });

  it('renders an HTML dashboard at /', async () => {
    const res = await handle('GET', '/', storeWith(await snap()));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('Put-Sell Screener');
    expect(res.body).toContain('not investment advice');
  });

  it('404s an unknown snapshot and a missing latest', async () => {
    expect((await handle('GET', '/api/snapshots/nope', storeWith(await snap()))).status).toBe(404);
    expect((await handle('GET', '/api/snapshots/latest', storeWith(null))).status).toBe(404);
  });

  it('rejects non-GET', async () => {
    expect((await handle('POST', '/', storeWith(null))).status).toBe(405);
  });
});
