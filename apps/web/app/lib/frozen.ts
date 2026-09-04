import 'server-only';
import { join } from 'node:path';
import {
  JsonFrozenComparisonStore,
  PgFrozenComparisonStore,
  type FrozenComparison,
  type FrozenComparisonStore,
} from '@pss/store';
import { getPgPool } from './pg-pool';

export type { FrozenComparison, FrozenComparisonStore } from '@pss/store';

function dataDir(): string {
  return process.env.PSS_DATA_DIR
    ? join(process.env.PSS_DATA_DIR, '..')
    : join(process.cwd(), '..', '..', '.data');
}

let cached: Promise<FrozenComparisonStore> | null = null;

/** JSON-backed by default; Postgres (via the shared pool) when DATABASE_URL is set. */
export async function getFrozenStore(): Promise<FrozenComparisonStore> {
  cached ??= (async () => {
    const pool = await getPgPool();
    if (pool) {
      const store = new PgFrozenComparisonStore(pool);
      await store.migrate();
      return store;
    }
    return new JsonFrozenComparisonStore(join(dataDir(), 'frozen-comparisons.json'));
  })();
  return cached;
}
