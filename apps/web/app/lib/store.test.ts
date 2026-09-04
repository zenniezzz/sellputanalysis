import { describe, expect, it } from 'vitest';
import type { Snapshot, SnapshotMeta } from '@pss/pipeline';
import type { SnapshotStore } from '@pss/store';
import { CachedSnapshotStore } from './store';

function makeSnapshot(runId: string): Snapshot {
  const meta = {
    id: `id-${runId}`,
    runId,
    createdAt: '2026-09-04T10:00:00Z',
    snapshotDay: '2026-09-04',
    runType: 'scheduled',
    status: 'good',
    dataCompleteness: 1,
    scoreBasis: 'cross_sectional',
    metricSchemaVersion: 1,
    ratesAsOf: '2026-09-04',
    universeHash: 'abc',
    provider: 'cboe-delayed',
    displayDelayed: true,
    filterDefaults: {} as SnapshotMeta['filterDefaults'],
  } satisfies SnapshotMeta;
  return { meta, rows: [], universe: [], run: {} as Snapshot['run'], logs: [] };
}

/** Counts calls so tests can assert the cache actually avoided hitting `inner`. */
class CountingStore implements SnapshotStore {
  calls = { saveSnapshot: 0, list: 0, latest: 0, getByRunId: 0, getById: 0 };
  private snapshots = new Map<string, Snapshot>();
  private latestRunId: string | null = null;

  seed(snap: Snapshot): void {
    this.snapshots.set(snap.meta.runId, snap);
    this.latestRunId = snap.meta.runId;
  }

  async saveSnapshot(s: Snapshot): Promise<void> {
    this.calls.saveSnapshot++;
    this.snapshots.set(s.meta.runId, s);
    this.latestRunId = s.meta.runId;
  }
  async list(limit: number): Promise<SnapshotMeta[]> {
    this.calls.list++;
    return [...this.snapshots.values()].map((s) => s.meta).slice(0, limit);
  }
  async latest(): Promise<Snapshot | null> {
    this.calls.latest++;
    return this.latestRunId ? (this.snapshots.get(this.latestRunId) ?? null) : null;
  }
  async getByRunId(runId: string): Promise<Snapshot | null> {
    this.calls.getByRunId++;
    return this.snapshots.get(runId) ?? null;
  }
  async getById(id: string): Promise<Snapshot | null> {
    this.calls.getById++;
    return [...this.snapshots.values()].find((s) => s.meta.id === id) ?? null;
  }
}

describe('CachedSnapshotStore', () => {
  it('memoizes latest() within the TTL, then refetches', async () => {
    const inner = new CountingStore();
    inner.seed(makeSnapshot('run-1'));
    let t = 0;
    const cache = new CachedSnapshotStore(inner, 10_000, 8, () => t);

    expect((await cache.latest())?.meta.runId).toBe('run-1');
    expect((await cache.latest())?.meta.runId).toBe('run-1');
    expect(inner.calls.latest).toBe(1); // second call served from cache

    t = 10_001;
    await cache.latest();
    expect(inner.calls.latest).toBe(2); // TTL elapsed
  });

  it('caches getByRunId() indefinitely (snapshots are immutable)', async () => {
    const inner = new CountingStore();
    inner.seed(makeSnapshot('run-1'));
    let t = 0;
    const cache = new CachedSnapshotStore(inner, 10_000, 8, () => t);

    await cache.getByRunId('run-1');
    t = 1_000_000; // far past any TTL
    await cache.getByRunId('run-1');
    expect(inner.calls.getByRunId).toBe(1);
  });

  it('evicts the oldest entry once maxSnapshots is exceeded', async () => {
    const inner = new CountingStore();
    for (let i = 1; i <= 3; i++) inner.seed(makeSnapshot(`run-${i}`));
    const cache = new CachedSnapshotStore(inner, 10_000, 2); // room for 2

    await cache.getByRunId('run-1');
    await cache.getByRunId('run-2');
    await cache.getByRunId('run-3'); // evicts run-1

    await cache.getByRunId('run-1');
    expect(inner.calls.getByRunId).toBe(4); // 3 initial + 1 re-fetch for the evicted run-1
  });

  it('getById() checks the in-memory cache before hitting the store', async () => {
    const inner = new CountingStore();
    inner.seed(makeSnapshot('run-1'));
    const cache = new CachedSnapshotStore(inner);

    await cache.getByRunId('run-1'); // warms the cache
    const byId = await cache.getById('id-run-1');
    expect(byId?.meta.runId).toBe('run-1');
    expect(inner.calls.getById).toBe(0);
  });

  it('flushes every cache on saveSnapshot', async () => {
    const inner = new CountingStore();
    inner.seed(makeSnapshot('run-1'));
    let t = 0;
    const cache = new CachedSnapshotStore(inner, 10_000, 8, () => t);

    await cache.latest();
    await cache.saveSnapshot(makeSnapshot('run-2'));
    await cache.latest(); // must not still return the stale run-1
    expect((await cache.latest())?.meta.runId).toBe('run-2');
    expect(inner.calls.latest).toBe(2); // 1 before save, 1 after (cache was flushed)
  });
});
