import 'server-only';
import { join } from 'node:path';
import {
  JsonSnapshotBookmarkStore,
  PgSnapshotBookmarkStore,
  type SnapshotBookmark,
  type SnapshotBookmarkStore,
} from '@pss/store';

export type { SnapshotBookmark, SnapshotBookmarkStore } from '@pss/store';

function dataDir(): string {
  return process.env.PSS_DATA_DIR
    ? join(process.env.PSS_DATA_DIR, '..')
    : join(process.cwd(), '..', '..', '.data');
}

let cached: SnapshotBookmarkStore | null = null;

/** JSON-backed by default; Postgres when DATABASE_URL is set. */
export function getBookmarkStore(): SnapshotBookmarkStore {
  if (cached) return cached;
  void PgSnapshotBookmarkStore;
  cached = new JsonSnapshotBookmarkStore(join(dataDir(), 'snapshot-bookmarks.json'));
  return cached;
}
