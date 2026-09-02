import { join } from 'node:path';
import process from 'node:process';
import { JsonFileStore, PgSnapshotStore, type SnapshotStore } from '@pss/store';

/** JsonFileStore by default; Postgres when DATABASE_URL is set. */
export async function openStore(): Promise<{ store: SnapshotStore; close: () => Promise<void> }> {
  const url = process.env['DATABASE_URL'];
  if (url) {
    const { store, close } = await PgSnapshotStore.connect(url);
    return { store, close };
  }
  const root = process.env['PSS_DATA_DIR'] ?? join(process.cwd(), '.data', 'snapshots');
  return { store: new JsonFileStore(root), close: async () => {} };
}
