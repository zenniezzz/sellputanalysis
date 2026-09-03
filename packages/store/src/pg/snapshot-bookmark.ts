import { randomUUID } from 'node:crypto';
import type {
  SnapshotBookmark,
  SnapshotBookmarkInput,
  SnapshotBookmarkStore,
} from '../snapshot-bookmark.js';
import type { PgQueryable } from './store.js';

function toBookmark(r: Record<string, unknown>): SnapshotBookmark {
  return {
    id: String(r['id']),
    userId: (r['user_id'] as string | null) ?? null,
    name: String(r['name']),
    snapshotRunId: String(r['snapshot_run_id']),
    filterQuery: String(r['filter_query'] ?? ''),
    createdAt: new Date(r['created_at'] as string).toISOString(),
  };
}

export class PgSnapshotBookmarkStore implements SnapshotBookmarkStore {
  constructor(private readonly db: PgQueryable) {}

  async migrate(): Promise<void> {
    await this.db.query(`
      create table if not exists snapshot_bookmark (
        id              uuid primary key,
        user_id         uuid,
        name            text not null,
        snapshot_run_id text not null,
        filter_query    text not null default '',
        created_at      timestamptz not null
      );
      create index if not exists snapshot_bookmark_user_idx on snapshot_bookmark (user_id, created_at desc);
    `);
  }

  async list(userId: string | null): Promise<SnapshotBookmark[]> {
    const { rows } = await this.db.query(
      userId == null
        ? `select * from snapshot_bookmark where user_id is null order by created_at desc`
        : `select * from snapshot_bookmark where user_id = $1 order by created_at desc`,
      userId == null ? [] : [userId],
    );
    return rows.map(toBookmark);
  }

  async create(input: SnapshotBookmarkInput): Promise<SnapshotBookmark> {
    const row: SnapshotBookmark = {
      id: randomUUID(),
      userId: input.userId ?? null,
      name: input.name.trim(),
      snapshotRunId: input.snapshotRunId,
      filterQuery: input.filterQuery,
      createdAt: new Date().toISOString(),
    };
    await this.db.query(
      `insert into snapshot_bookmark (id, user_id, name, snapshot_run_id, filter_query, created_at)
       values ($1,$2,$3,$4,$5,$6)`,
      [row.id, row.userId, row.name, row.snapshotRunId, row.filterQuery, row.createdAt],
    );
    return row;
  }

  async delete(userId: string | null, id: string): Promise<void> {
    await this.db.query(
      userId == null
        ? `delete from snapshot_bookmark where id = $1 and user_id is null`
        : `delete from snapshot_bookmark where id = $1 and user_id = $2`,
      userId == null ? [id] : [id, userId],
    );
  }

  async get(id: string): Promise<SnapshotBookmark | null> {
    const { rows } = await this.db.query('select * from snapshot_bookmark where id = $1', [id]);
    return rows[0] ? toBookmark(rows[0]) : null;
  }
}
