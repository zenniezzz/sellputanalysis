'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import type { ScreenedRow } from '@pss/screen';

const KEY = 'pss:compare';
export const MAX_COMPARE = 6;

const EMPTY: string[] = [];
const listeners = new Set<() => void>();
let state: string[] = readStore();

function readStore(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return EMPTY;
    return parsed.filter((x): x is string => typeof x === 'string').slice(0, MAX_COMPARE);
  } catch {
    return EMPTY;
  }
}

function writeStore(next: string[]): void {
  state = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* localStorage unavailable — keep the in-memory copy */
  }
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/**
 * Persistent Compare selection, backed by `localStorage["pss:compare"]`.
 * Shared across every component that calls the hook.
 */
export function useCompareTray() {
  const selected = useSyncExternalStore(
    subscribe,
    () => state,
    () => EMPTY,
  );

  const toggle = useCallback((occ: string) => {
    if (state.includes(occ)) {
      writeStore(state.filter((x) => x !== occ));
    } else if (state.length < MAX_COMPARE) {
      writeStore([...state, occ]);
    }
  }, []);

  const clear = useCallback(() => writeStore(EMPTY), []);
  const isSelected = useCallback((occ: string) => state.includes(occ), []);

  return { selected, toggle, clear, isSelected };
}

/** Always-visible bar of selected contracts as removable chips (max 6). */
export function CompareTray({ rows }: { rows: ScreenedRow[] }) {
  const { selected, toggle, clear } = useCompareTray();
  const byOcc = useMemo(() => new Map(rows.map((r) => [r.occSymbol, r])), [rows]);

  return (
    <div className="compare-tray">
      <span className="ct-label">Compare {selected.length}/{MAX_COMPARE}</span>
      {selected.length === 0 && (
        <span className="ct-empty">tick contracts in the Candidates table to compare them</span>
      )}
      {selected.map((occ) => {
        const r = byOcc.get(occ);
        return (
          <span key={occ} className="ct-chip">
            {r ? `${r.symbol} ${r.expiration} ${r.strike}P` : occ.trim()}
            <button type="button" aria-label={`remove ${r?.symbol ?? occ.trim()}`} onClick={() => toggle(occ)}>
              ×
            </button>
          </span>
        );
      })}
      {selected.length > 0 && (
        <button type="button" className="ct-clear" onClick={clear}>
          clear
        </button>
      )}
    </div>
  );
}
