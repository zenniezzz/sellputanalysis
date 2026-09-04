/**
 * Snapshot/IV-history/metric-reference stores for the CLI pipeline runner
 * (plan §10.2 — "a separate worker"). JSON files under `.data/` by default;
 * Postgres, via one shared pool, when `DATABASE_URL` is set — mirrors
 * `apps/web/app/lib/store.ts`'s pattern so the worker and the read app agree
 * on where a scheduled run's output actually lands (M7 production cutover:
 * before this, `cli:run-snapshot` always wrote JSON regardless of
 * `DATABASE_URL`, so pointing the web app at Postgres in production would
 * have shown nothing — nothing ever wrote there).
 */
import type { IvHistoryStore, MetricReferenceStore, SnapshotStore } from '@pss/store';
import {
  JsonFileStore,
  JsonIvHistoryStore,
  JsonMetricReferenceStore,
  PgIvHistoryStore,
  PgMetricReferenceStore,
  PgSnapshotStore,
  type PgQueryable,
} from '@pss/store';

export interface CliStores {
  snapshotStore: SnapshotStore;
  ivStore: IvHistoryStore;
  metricStore: MetricReferenceStore;
  close(): Promise<void>;
}

export async function openStores(paths: {
  snapDir: string;
  ivDir: string;
  metricFile: string;
}): Promise<CliStores> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    return {
      snapshotStore: new JsonFileStore(paths.snapDir),
      ivStore: new JsonIvHistoryStore(paths.ivDir),
      metricStore: new JsonMetricReferenceStore(paths.metricFile),
      close: async () => {},
    };
  }

  const pg = (await import('pg')) as unknown as {
    default: { Pool: new (c: { connectionString: string }) => PgQueryable & { end(): Promise<void> } };
  };
  const pool = new pg.default.Pool({ connectionString: url });

  const snapshotStore = new PgSnapshotStore(pool);
  const ivStore = new PgIvHistoryStore(pool);
  const metricStore = new PgMetricReferenceStore(pool);
  await Promise.all([snapshotStore.migrate(), ivStore.migrate(), metricStore.migrate()]);

  return { snapshotStore, ivStore, metricStore, close: () => pool.end() };
}
