import type { Snapshot, SnapshotMeta } from '@pss/pipeline';

export interface SnapshotStore {
  /** Persist a snapshot, its rows, and the ingestion run/logs. Idempotent on runId. */
  saveSnapshot(snapshot: Snapshot): Promise<void>;
  /** Newest non-failed snapshot, or null. */
  latest(): Promise<Snapshot | null>;
  getById(id: string): Promise<Snapshot | null>;
  getByRunId(runId: string): Promise<Snapshot | null>;
  list(limit: number): Promise<SnapshotMeta[]>;
}
