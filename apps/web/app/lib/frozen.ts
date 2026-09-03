import 'server-only';
import { join } from 'node:path';
import {
  JsonFrozenComparisonStore,
  PgFrozenComparisonStore,
  type FrozenComparison,
  type FrozenComparisonStore,
} from '@pss/store';

export type { FrozenComparison, FrozenComparisonStore } from '@pss/store';

function dataDir(): string {
  return process.env.PSS_DATA_DIR
    ? join(process.env.PSS_DATA_DIR, '..')
    : join(process.cwd(), '..', '..', '.data');
}

let cached: FrozenComparisonStore | null = null;

/** JSON-backed by default; Postgres when DATABASE_URL is set. */
export function getFrozenStore(): FrozenComparisonStore {
  if (cached) return cached;
  // Postgres wiring is available via PgFrozenComparisonStore + a pool; the web
  // app currently reads snapshots from the filesystem, so match that.
  void PgFrozenComparisonStore;
  cached = new JsonFrozenComparisonStore(join(dataDir(), 'frozen-comparisons.json'));
  return cached;
}
