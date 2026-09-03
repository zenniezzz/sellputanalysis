import { randomUUID } from 'node:crypto';
import type {
  FrozenComparison,
  FrozenComparisonInput,
  FrozenComparisonStore,
} from '../frozen-comparison.js';
import type { PgQueryable } from './store.js';

export class PgFrozenComparisonStore implements FrozenComparisonStore {
  constructor(private readonly db: PgQueryable) {}

  async migrate(): Promise<void> {
    await this.db.query(`
      create table if not exists frozen_comparison (
        id                uuid primary key,
        user_id           uuid,
        snapshot_run_id   text not null,
        occ_symbols       text[] not null,
        created_at        timestamptz not null
      );
    `);
  }

  async create(input: FrozenComparisonInput): Promise<FrozenComparison> {
    const seen = new Set<string>();
    const occSymbols = input.occSymbols
      .map((s) => s.trim())
      .filter((s) => s && !seen.has(s) && seen.add(s));
    const row: FrozenComparison = {
      id: randomUUID(),
      userId: input.userId ?? null,
      snapshotRunId: input.snapshotRunId,
      occSymbols,
      createdAt: new Date().toISOString(),
    };
    await this.db.query(
      `insert into frozen_comparison (id, user_id, snapshot_run_id, occ_symbols, created_at)
       values ($1,$2,$3,$4,$5)`,
      [row.id, row.userId, row.snapshotRunId, row.occSymbols, row.createdAt],
    );
    return row;
  }

  async get(id: string): Promise<FrozenComparison | null> {
    const { rows } = await this.db.query('select * from frozen_comparison where id = $1', [id]);
    const r = rows[0];
    if (!r) return null;
    return {
      id: String(r['id']),
      userId: (r['user_id'] as string | null) ?? null,
      snapshotRunId: String(r['snapshot_run_id']),
      occSymbols: (r['occ_symbols'] as string[]) ?? [],
      createdAt: new Date(r['created_at'] as string).toISOString(),
    };
  }
}
