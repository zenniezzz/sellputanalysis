import 'server-only';
import type { SnapshotRow, SnapshotMeta, IngestionRun } from '@pss/pipeline';
import { DEFAULT_FILTERS, type ScreenedRow } from '@pss/screen';
import { getStore } from './store';
import { getFrozenStore, type FrozenComparison } from './frozen';

/**
 * Re-derives the per-basis display fields that `@pss/screen`'s `applyScreen`
 * adds, without dropping rows the live screen would have filtered out — a
 * frozen comparison pins exactly the contracts the user chose.
 */
function shape(row: SnapshotRow): ScreenedRow {
  const cashSettled = row.cspCapital100 == null;
  const basis = cashSettled ? 'regt' : DEFAULT_FILTERS.capitalBasis;
  const capital100 = basis === 'regt' ? row.regtCapital100 : row.cspCapital100;
  const credit100 = row.entryCredit100;
  const displayAnnRoc =
    capital100 != null && capital100 > 0 && credit100 != null && row.dte > 0
      ? (credit100 / capital100) * (365 / row.dte)
      : null;
  return {
    ...row,
    displayCapital100: capital100,
    displayAnnRoc,
    positionBp: capital100 != null ? capital100 * DEFAULT_FILTERS.intendedOrderSize : null,
    orderSizeVsOiPct:
      row.openInterest > 0 ? (DEFAULT_FILTERS.intendedOrderSize / row.openInterest) * 100 : null,
  };
}

export interface ResolvedComparison {
  frozen: FrozenComparison;
  meta: SnapshotMeta;
  run: IngestionRun;
  rows: ScreenedRow[];
  /** occSymbols in the frozen set with no matching row in the snapshot. */
  missing: string[];
}

/** Loads a frozen comparison and the ScreenedRows for its contracts. null if unknown. */
export async function resolveComparison(id: string): Promise<ResolvedComparison | null> {
  const frozen = await getFrozenStore().get(id);
  if (!frozen) return null;

  const store = await getStore();
  const snap = await store.getByRunId(frozen.snapshotRunId);
  if (!snap) return null;

  const byOcc = new Map(snap.rows.map((r) => [r.occSymbol.trim(), r]));
  const rows: ScreenedRow[] = [];
  const missing: string[] = [];
  for (const occ of frozen.occSymbols) {
    const row = byOcc.get(occ.trim());
    if (row) rows.push(shape(row));
    else missing.push(occ);
  }

  return { frozen, meta: snap.meta, run: snap.run, rows, missing };
}

/** Resolve the runId to freeze against: an explicit one, or the latest snapshot. */
export async function resolveSnapshotRunId(explicit?: string | null): Promise<string | null> {
  const store = await getStore();
  if (explicit) {
    const snap = await store.getByRunId(explicit);
    return snap ? snap.meta.runId : null;
  }
  const latest = await store.latest();
  return latest ? latest.meta.runId : null;
}
