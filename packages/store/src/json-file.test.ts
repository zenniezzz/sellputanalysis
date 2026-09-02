import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MockMarketData, runSnapshot, StaticUniverseSource, type MockNameSpec } from '@pss/pipeline';
import { StaticRatesSource } from '@pss/market-data';
import { JsonFileStore } from './json-file.js';

const NOW = new Date('2026-09-02T14:00:00Z');
const NAMES: MockNameSpec[] = [
  { symbol: 'AAA', spot: 100, iv: 0.3 },
  { symbol: 'BBB', spot: 250, iv: 0.45 },
];

async function makeSnapshot(now = NOW) {
  return runSnapshot({
    universe: new StaticUniverseSource(
      NAMES.map((n) => ({ symbol: n.symbol, sector: 'T', isLeveraged: false, isInverse: false, isAdr: false })),
    ),
    marketData: new MockMarketData(NAMES, { now }),
    rates: new StaticRatesSource(),
    now,
    maxNames: 2,
    idFactory: () => `id-${now.toISOString()}`,
  });
}

describe('JsonFileStore', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pss-store-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('round-trips a snapshot', async () => {
    const store = new JsonFileStore(dir);
    const snap = await makeSnapshot();
    await store.saveSnapshot(snap);

    const back = await store.getByRunId(snap.meta.runId);
    expect(back).toEqual(snap);

    const byId = await store.getById(snap.meta.id);
    expect(byId?.meta.runId).toBe(snap.meta.runId);
  });

  it('latest() returns the newest non-failed snapshot', async () => {
    const store = new JsonFileStore(dir);
    const older = await makeSnapshot(new Date('2026-09-01T14:00:00Z'));
    const newer = await makeSnapshot(new Date('2026-09-02T14:00:00Z'));
    await store.saveSnapshot(older);
    await store.saveSnapshot(newer);

    const latest = await store.latest();
    expect(latest?.meta.runId).toBe(newer.meta.runId);
  });

  it('list() is newest-first and de-duplicates on runId', async () => {
    const store = new JsonFileStore(dir);
    const snap = await makeSnapshot();
    await store.saveSnapshot(snap);
    await store.saveSnapshot(snap); // re-save same runId
    const list = await store.list(10);
    expect(list).toHaveLength(1);
  });

  it('returns null for an unknown snapshot', async () => {
    const store = new JsonFileStore(dir);
    expect(await store.latest()).toBeNull();
    expect(await store.getByRunId('nope')).toBeNull();
  });
});
