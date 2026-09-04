import 'server-only';
import { join } from 'node:path';
import { JsonPaperTradeStore, PgPaperTradeStore, type PaperTradeStore } from '@pss/store';
import { getPgPool } from './pg-pool';

export type { PaperTrade } from '@pss/store';

function dataDir(): string {
  return process.env.PSS_DATA_DIR
    ? join(process.env.PSS_DATA_DIR, '..')
    : join(process.cwd(), '..', '..', '.data');
}

let cached: Promise<PaperTradeStore> | null = null;

/** JSON-backed by default; Postgres (via the shared pool) when DATABASE_URL is set. */
export async function getPaperTradeStore(): Promise<PaperTradeStore> {
  cached ??= (async () => {
    const pool = await getPgPool();
    if (pool) {
      const store = new PgPaperTradeStore(pool);
      await store.migrate();
      return store;
    }
    return new JsonPaperTradeStore(join(dataDir(), 'paper-trades.json'));
  })();
  return cached;
}
