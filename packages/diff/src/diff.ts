/**
 * Snapshots diff (plan §8.6) — candidates added / dropped / rank-moved between
 * two frozen snapshots, with score / EV / IV-rank deltas and the drop-out
 * reason. Only `isCandidate` rows participate. Pure logic, no I/O.
 */

import type { Snapshot, SnapshotRow } from '@pss/pipeline';

export interface DiffContract {
  occSymbol: string;
  symbol: string;
  strike: number;
  expiration: string;
  /** Rank (by score desc) in the snapshot this contract belongs to. */
  rank: number;
  score: number | null;
  /** Only set on `dropped` entries. */
  reason?: string;
}

export interface DiffMove {
  occSymbol: string;
  symbol: string;
  prevRank: number;
  nextRank: number;
  scoreDelta: number | null;
  evToMaxlossDelta: number | null;
  ivRankDelta: number | null;
}

export interface SnapshotDiff {
  added: DiffContract[];
  dropped: DiffContract[];
  moved: DiffMove[];
  metricSchemaChanged: boolean;
  prevRunId: string;
  nextRunId: string;
}

interface Ranked {
  rank: number;
  row: SnapshotRow;
}

/** Candidate rows ranked by composite score, descending; nulls sort last. */
function rankCandidates(snap: Snapshot): Map<string, Ranked> {
  const ordered = snap.rows
    .filter((r) => r.isCandidate)
    .slice()
    .sort((a, b) => (b.score ?? Number.NEGATIVE_INFINITY) - (a.score ?? Number.NEGATIVE_INFINITY));
  const out = new Map<string, Ranked>();
  ordered.forEach((row, i) => out.set(row.occSymbol, { rank: i + 1, row }));
  return out;
}

function delta(prev: number | null, next: number | null): number | null {
  return prev == null || next == null ? null : next - prev;
}

function toContract(entry: Ranked): DiffContract {
  return {
    occSymbol: entry.row.occSymbol,
    symbol: entry.row.symbol,
    strike: entry.row.strike,
    expiration: entry.row.expiration,
    rank: entry.rank,
    score: entry.row.score,
  };
}

function byScoreThenSymbol(a: DiffContract, b: DiffContract): number {
  return (b.score ?? Number.NEGATIVE_INFINITY) - (a.score ?? Number.NEGATIVE_INFINITY) ||
    a.occSymbol.localeCompare(b.occSymbol);
}

export function diffSnapshots(prev: Snapshot, next: Snapshot): SnapshotDiff {
  const prevRanked = rankCandidates(prev);
  const nextRanked = rankCandidates(next);
  const nextByOcc = new Map(next.rows.map((r) => [r.occSymbol, r] as const));

  const added: DiffContract[] = [];
  const moved: DiffMove[] = [];

  for (const [occSymbol, entry] of nextRanked) {
    const before = prevRanked.get(occSymbol);
    if (!before) {
      added.push(toContract(entry));
      continue;
    }
    if (before.rank !== entry.rank) {
      moved.push({
        occSymbol,
        symbol: entry.row.symbol,
        prevRank: before.rank,
        nextRank: entry.rank,
        scoreDelta: delta(before.row.score, entry.row.score),
        evToMaxlossDelta: delta(before.row.evToMaxloss, entry.row.evToMaxloss),
        ivRankDelta: delta(before.row.ivRank, entry.row.ivRank),
      });
    }
  }

  const dropped: DiffContract[] = [];
  for (const [occSymbol, entry] of prevRanked) {
    if (nextRanked.has(occSymbol)) continue;
    const stillPresent = nextByOcc.get(occSymbol);
    const reason =
      stillPresent && !stillPresent.isCandidate
        ? stillPresent.excludedReason ?? 'not in snapshot'
        : 'not in snapshot';
    dropped.push({ ...toContract(entry), reason });
  }

  added.sort(byScoreThenSymbol);
  dropped.sort(byScoreThenSymbol);
  moved.sort((a, b) => a.nextRank - b.nextRank);

  return {
    added,
    dropped,
    moved,
    metricSchemaChanged: prev.meta.metricSchemaVersion !== next.meta.metricSchemaVersion,
    prevRunId: prev.meta.runId,
    nextRunId: next.meta.runId,
  };
}
