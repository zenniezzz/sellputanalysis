import 'server-only';
import { join } from 'node:path';
import type { Snapshot, SnapshotMeta } from '@pss/pipeline';
import { JsonFileStore, PgSnapshotStore, type SnapshotStore } from '@pss/store';

let cached: SnapshotStore | null = null;

/** JsonFileStore (reads `.data/snapshots` at the repo root) unless DATABASE_URL is set. */
export async function getStore(): Promise<SnapshotStore> {
  if (cached) return cached;
  const url = process.env.DATABASE_URL;
  if (url) {
    const { store } = await PgSnapshotStore.connect(url);
    cached = new CachedSnapshotStore(store);
  } else {
    const root =
      process.env.PSS_DATA_DIR ?? join(process.cwd(), '..', '..', '.data', 'snapshots');
    cached = new CachedSnapshotStore(new JsonFileStore(root));
  }
  return cached;
}

/**
 * Read-through cache in front of a SnapshotStore (plan §10.8 — the read API must
 * survive a burst without re-parsing a multi-MB snapshot per request).
 *
 * - `latest()` / `list()` memoised for `ttlMs` (a new snapshot lands ~once a day;
 *   a few seconds of staleness on the "latest" pointer is fine and the UI shows a
 *   freshness banner anyway).
 * - `getByRunId()` / `getById()` — snapshots are immutable once written, so these
 *   are cached indefinitely, bounded to `maxSnapshots` entries (LRU by insertion).
 * - writes flush everything.
 */
export class CachedSnapshotStore implements SnapshotStore {
  private latestAt = 0;
  private latestVal: Snapshot | null = null;
  private listAt = 0;
  private listVal: SnapshotMeta[] = [];
  private readonly byRunId = new Map<string, Snapshot | null>();

  constructor(
    private readonly inner: SnapshotStore,
    private readonly ttlMs = 10_000,
    private readonly maxSnapshots = 8,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async saveSnapshot(snapshot: Snapshot): Promise<void> {
    await this.inner.saveSnapshot(snapshot);
    this.latestAt = 0;
    this.listAt = 0;
    this.byRunId.clear();
  }

  async list(limit: number): Promise<SnapshotMeta[]> {
    const t = this.now();
    if (t - this.listAt > this.ttlMs) {
      this.listVal = await this.inner.list(Math.max(limit, 50));
      this.listAt = t;
    }
    return this.listVal.slice(0, limit);
  }

  async latest(): Promise<Snapshot | null> {
    const t = this.now();
    if (t - this.latestAt > this.ttlMs) {
      this.latestVal = await this.inner.latest();
      this.latestAt = t;
      if (this.latestVal) this.remember(this.latestVal.meta.runId, this.latestVal);
    }
    return this.latestVal;
  }

  async getByRunId(runId: string): Promise<Snapshot | null> {
    if (this.byRunId.has(runId)) return this.byRunId.get(runId) ?? null;
    const snap = await this.inner.getByRunId(runId);
    this.remember(runId, snap);
    return snap;
  }

  async getById(id: string): Promise<Snapshot | null> {
    for (const snap of this.byRunId.values()) if (snap && snap.meta.id === id) return snap;
    const snap = await this.inner.getById(id);
    if (snap) this.remember(snap.meta.runId, snap);
    return snap;
  }

  private remember(runId: string, snap: Snapshot | null): void {
    this.byRunId.delete(runId);
    this.byRunId.set(runId, snap);
    while (this.byRunId.size > this.maxSnapshots) {
      const oldest = this.byRunId.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.byRunId.delete(oldest);
    }
  }
}
