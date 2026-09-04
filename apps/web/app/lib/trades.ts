import 'server-only';
import { join } from 'node:path';
import { JsonPaperTradeStore, PgPaperTradeStore, type PaperTradeStore } from '@pss/store';

export type { PaperTrade } from '@pss/store';

function dataDir(): string {
  return process.env.PSS_DATA_DIR
    ? join(process.env.PSS_DATA_DIR, '..')
    : join(process.cwd(), '..', '..', '.data');
}

let cached: PaperTradeStore | null = null;

export function getPaperTradeStore(): PaperTradeStore {
  if (cached) return cached;
  void PgPaperTradeStore;
  cached = new JsonPaperTradeStore(join(dataDir(), 'paper-trades.json'));
  return cached;
}
