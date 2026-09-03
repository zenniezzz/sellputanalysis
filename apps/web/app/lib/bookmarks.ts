import 'server-only';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * Frozen snapshot bookmarks (plan §8.6, milestone M5). A bookmark pins a
 * snapshot run id + the filter query in effect at freeze time so a screen can
 * be revisited exactly. JSON-backed, keyed by the Auth.js user id (null =
 * anonymous / shared).
 */

export interface SnapshotBookmark {
  id: string;
  userId: string | null;
  name: string;
  snapshotRunId: string;
  filterQuery: string;
  createdAt: string;
}

export interface SnapshotBookmarkStore {
  list(userId: string | null): Promise<SnapshotBookmark[]>;
  create(
    userId: string | null,
    name: string,
    snapshotRunId: string,
    filterQuery: string,
  ): Promise<SnapshotBookmark>;
  delete(userId: string | null, id: string): Promise<void>;
  get(id: string): Promise<SnapshotBookmark | null>;
}

const DATA_DIR = process.env.PSS_DATA_DIR
  ? join(process.env.PSS_DATA_DIR, '..')
  : join(process.cwd(), '..', '..', '.data');

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

export class JsonSnapshotBookmarkStore implements SnapshotBookmarkStore {
  constructor(private readonly file: string = join(DATA_DIR, 'bookmarks.json')) {}

  private async readAll(): Promise<SnapshotBookmark[]> {
    return (await readJson<SnapshotBookmark[]>(this.file)) ?? [];
  }

  async list(userId: string | null): Promise<SnapshotBookmark[]> {
    const all = await this.readAll();
    return all
      .filter((b) => b.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async create(
    userId: string | null,
    name: string,
    snapshotRunId: string,
    filterQuery: string,
  ): Promise<SnapshotBookmark> {
    const all = await this.readAll();
    const bookmark: SnapshotBookmark = {
      id: randomUUID(),
      userId,
      name: name.trim(),
      snapshotRunId,
      filterQuery,
      createdAt: new Date().toISOString(),
    };
    all.push(bookmark);
    await writeJson(this.file, all);
    return bookmark;
  }

  async delete(userId: string | null, id: string): Promise<void> {
    const all = await this.readAll();
    const next = all.filter((b) => !(b.id === id && b.userId === userId));
    if (next.length !== all.length) await writeJson(this.file, next);
  }

  async get(id: string): Promise<SnapshotBookmark | null> {
    return (await this.readAll()).find((b) => b.id === id) ?? null;
  }
}

let cached: SnapshotBookmarkStore | null = null;

export function getBookmarkStore(): SnapshotBookmarkStore {
  cached ??= new JsonSnapshotBookmarkStore();
  return cached;
}
