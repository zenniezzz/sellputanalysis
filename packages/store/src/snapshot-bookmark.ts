/**
 * Snapshot bookmarks (plan §8.5, milestone M5). A named pointer to a frozen
 * snapshot + the filter state that produced the view.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';

export interface SnapshotBookmark {
  id: string;
  userId: string | null;
  name: string;
  snapshotRunId: string;
  filterQuery: string;
  createdAt: string;
}

export interface SnapshotBookmarkInput {
  userId?: string | null;
  name: string;
  snapshotRunId: string;
  filterQuery: string;
}

export interface SnapshotBookmarkStore {
  list(userId: string | null): Promise<SnapshotBookmark[]>;
  create(input: SnapshotBookmarkInput): Promise<SnapshotBookmark>;
  delete(userId: string | null, id: string): Promise<void>;
  get(id: string): Promise<SnapshotBookmark | null>;
}

export class JsonSnapshotBookmarkStore implements SnapshotBookmarkStore {
  constructor(private readonly file: string) {}

  private async read(): Promise<SnapshotBookmark[]> {
    try {
      return JSON.parse(await readFile(this.file, 'utf8')) as SnapshotBookmark[];
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw e;
    }
  }

  private async write(all: SnapshotBookmark[]): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(this.file, `${JSON.stringify(all, null, 2)}\n`);
  }

  async list(userId: string | null): Promise<SnapshotBookmark[]> {
    return (await this.read())
      .filter((b) => b.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async create(input: SnapshotBookmarkInput): Promise<SnapshotBookmark> {
    const all = await this.read();
    const created: SnapshotBookmark = {
      id: randomUUID(),
      userId: input.userId ?? null,
      name: input.name.trim(),
      snapshotRunId: input.snapshotRunId,
      filterQuery: input.filterQuery,
      createdAt: new Date().toISOString(),
    };
    all.push(created);
    await this.write(all);
    return created;
  }

  async delete(userId: string | null, id: string): Promise<void> {
    const all = await this.read();
    await this.write(all.filter((b) => !(b.id === id && b.userId === userId)));
  }

  async get(id: string): Promise<SnapshotBookmark | null> {
    return (await this.read()).find((b) => b.id === id) ?? null;
  }
}
