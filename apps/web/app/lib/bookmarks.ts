import 'server-only';
import { join } from 'node:path';
import {
  JsonSnapshotBookmarkStore,
  PgSnapshotBookmarkStore,
  type SnapshotBookmark,
  type SnapshotBookmarkStore,
} from '@pss/store';
import { getPgPool } from './pg-pool';

export type { SnapshotBookmark, SnapshotBookmarkStore } from '@pss/store';

function dataDir(): string {
  return process.env.PSS_DATA_DIR
    ? join(process.env.PSS_DATA_DIR, '..')
    : join(process.cwd(), '..', '..', '.data');
}

let cached: Promise<SnapshotBookmarkStore> | null = null;

/** JSON-backed by default; Postgres (via the shared pool) when DATABASE_URL is set. */
export async function getBookmarkStore(): Promise<SnapshotBookmarkStore> {
  cached ??= (async () => {
    const pool = await getPgPool();
    if (pool) {
      const store = new PgSnapshotBookmarkStore(pool);
      await store.migrate();
      return store;
    }
    return new JsonSnapshotBookmarkStore(join(dataDir(), 'snapshot-bookmarks.json'));
  })();
  return cached;
}
