import type { Snapshot, SnapshotRow } from '@pss/pipeline';

/**
 * Pure snapshot diff (plan §8.6, milestone M5). Compares the candidate sets of
 * two snapshots: what entered, what dropped out (and why), and how the shared
 * candidates moved in rank. Rank = position when candidates are sorted by
 * composite score descending (nulls last).
 */

export interface DiffAdded {
  occSymbol: string;
  symbol: string;
  expiration: string;
  strike: number;
}

export interface DiffDropped extends DiffAdded {
  reason: string;
}

export interface DiffMoved {
  occSymbol: string;
  symbol: string;
  prevRank: number;
  nextRank: number;
  scoreDelta: number;
  evDelta: number;
  ivRankDelta: number;
}

export interface SnapshotDiff {
  added: DiffAdded[];
  dropped: DiffDropped[];
  moved: DiffMoved[];
  prevRunId: string;
  nextRunId: string;
}

function candidatesByScore(snap: Snapshot): SnapshotRow[] {
  return snap.rows
    .filter((r) => r.isCandidate)
    .slice()
    .sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity));
}

const n = (x: number | null | undefined): number => (x == null || !Number.isFinite(x) ? 0 : x);

export function diffSnapshots(prev: Snapshot, next: Snapshot): SnapshotDiff {
  const prevCands = candidatesByScore(prev);
  const nextCands = candidatesByScore(next);

  const prevRank = new Map<string, number>();
  prevCands.forEach((r, i) => prevRank.set(r.occSymbol, i + 1));
  const nextRank = new Map<string, number>();
  nextCands.forEach((r, i) => nextRank.set(r.occSymbol, i + 1));

  const prevRow = new Map(prevCands.map((r) => [r.occSymbol, r]));
  const nextRowAll = new Map(next.rows.map((r) => [r.occSymbol, r]));

  const added: DiffAdded[] = [];
  const moved: DiffMoved[] = [];

  for (const r of nextCands) {
    if (!prevRank.has(r.occSymbol)) {
      added.push({
        occSymbol: r.occSymbol,
        symbol: r.symbol,
        expiration: r.expiration,
        strike: r.strike,
      });
      continue;
    }
    const p = prevRow.get(r.occSymbol)!;
    const pr = prevRank.get(r.occSymbol)!;
    const nr = nextRank.get(r.occSymbol)!;
    if (pr !== nr) {
      moved.push({
        occSymbol: r.occSymbol,
        symbol: r.symbol,
        prevRank: pr,
        nextRank: nr,
        scoreDelta: n(r.score) - n(p.score),
        evDelta: n(r.ev100) - n(p.ev100),
        ivRankDelta: n(r.ivRank) - n(p.ivRank),
      });
    }
  }

  const dropped: DiffDropped[] = [];
  for (const r of prevCands) {
    if (nextRank.has(r.occSymbol)) continue;
    const nextRow = nextRowAll.get(r.occSymbol);
    dropped.push({
      occSymbol: r.occSymbol,
      symbol: r.symbol,
      expiration: r.expiration,
      strike: r.strike,
      reason: nextRow?.excludedReason ?? 'not in snapshot',
    });
  }

  moved.sort((a, b) => a.nextRank - b.nextRank);
  added.sort((a, b) => a.symbol.localeCompare(b.symbol) || a.strike - b.strike);
  dropped.sort((a, b) => a.symbol.localeCompare(b.symbol) || a.strike - b.strike);

  return { added, dropped, moved, prevRunId: prev.meta.runId, nextRunId: next.meta.runId };
}
