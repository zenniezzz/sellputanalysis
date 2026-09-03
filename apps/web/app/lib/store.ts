import 'server-only';
import { join } from 'node:path';
import { JsonFileStore, PgSnapshotStore, type SnapshotStore } from '@pss/store';

let cached: SnapshotStore | null = null;

/** JsonFileStore (reads `.data/snapshots` at the repo root) unless DATABASE_URL is set. */
export async function getStore(): Promise<SnapshotStore> {
  if (cached) return cached;
  const url = process.env.DATABASE_URL;
  if (url) {
    const { store } = await PgSnapshotStore.connect(url);
    cached = store;
  } else {
    const root =
      process.env.PSS_DATA_DIR ?? join(process.cwd(), '..', '..', '.data', 'snapshots');
    cached = new JsonFileStore(root);
  }
  return cached;
}
