/**
 * Filesystem snapshot store — the M1 walking-skeleton persistence (plan §9, §H).
 * Layout:
 *   <root>/index.json                       — array of SnapshotMeta, newest first
 *   <root>/<snapshotDay>/<runId>.json        — the full Snapshot
 *   <root>/<snapshotDay>/<runId>.rows.json   — rows only (for cheap streaming later)
 */

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Snapshot, SnapshotMeta } from '@pss/pipeline';
import type { SnapshotStore } from './types.js';

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export class JsonFileStore implements SnapshotStore {
  constructor(private readonly root: string) {}

  private indexPath(): string {
    return join(this.root, 'index.json');
  }
  private snapshotPath(meta: Pick<SnapshotMeta, 'snapshotDay' | 'runId'>): string {
    return join(this.root, meta.snapshotDay, `${meta.runId}.json`);
  }

  async saveSnapshot(snapshot: Snapshot): Promise<void> {
    await writeJson(this.snapshotPath(snapshot.meta), snapshot);
    await writeJson(
      join(this.root, snapshot.meta.snapshotDay, `${snapshot.meta.runId}.rows.json`),
      snapshot.rows,
    );

    const index = (await readJson<SnapshotMeta[]>(this.indexPath())) ?? [];
    const next = [snapshot.meta, ...index.filter((m) => m.runId !== snapshot.meta.runId)];
    next.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    await writeJson(this.indexPath(), next);
  }

  async list(limit: number): Promise<SnapshotMeta[]> {
    const index = (await readJson<SnapshotMeta[]>(this.indexPath())) ?? [];
    return index.slice(0, limit);
  }

  async latest(): Promise<Snapshot | null> {
    const index = (await readJson<SnapshotMeta[]>(this.indexPath())) ?? [];
    const meta = index.find((m) => m.status !== 'failed') ?? index[0];
    return meta ? this.getByRunId(meta.runId) : null;
  }

  async getById(id: string): Promise<Snapshot | null> {
    const index = (await readJson<SnapshotMeta[]>(this.indexPath())) ?? [];
    const meta = index.find((m) => m.id === id);
    return meta ? this.getByRunId(meta.runId) : null;
  }

  async getByRunId(runId: string): Promise<Snapshot | null> {
    const index = (await readJson<SnapshotMeta[]>(this.indexPath())) ?? [];
    const meta = index.find((m) => m.runId === runId);
    if (meta) return readJson<Snapshot>(this.snapshotPath(meta));

    // fall back to a directory scan if the index is missing/stale
    let days: string[];
    try {
      days = await readdir(this.root);
    } catch {
      return null;
    }
    for (const day of days) {
      const snap = await readJson<Snapshot>(join(this.root, day, `${runId}.json`));
      if (snap) return snap;
    }
    return null;
  }
}
