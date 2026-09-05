'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { DEFAULT_FILTERS, filtersToQuery, type ScreenFilters, type SortKey } from '@pss/screen';
import type { ScreenResponse } from '../lib/types';
import { CandidatesTable } from './CandidatesTable';
import { FilterPanel } from './FilterPanel';
import { TopPutVolume } from './TopPutVolume';
import { TopPutVolumeMonthly } from './TopPutVolumeMonthly';
import { WhyNotHere } from './WhyNotHere';

export function CandidatesView({
  initial,
  user,
  watchlist: initialWatchlist,
}: {
  initial: ScreenResponse;
  user: { email: string | null } | null;
  watchlist: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [data, setData] = useState<ScreenResponse>(initial);
  const [filters, setFilters] = useState<ScreenFilters>(initial.filters);
  const [watchlist, setWatchlist] = useState<string[]>(initialWatchlist);
  const [highlightedOcc, setHighlightedOcc] = useState<string | null>(null);
  const [expandedOcc, setExpandedOcc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [onlySymbol, setOnlySymbol] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const run = useCallback(
    (next: ScreenFilters) => {
      const q = filtersToQuery(next).toString();
      router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setLoading(true);
      fetch(`/api/screen?${q}`, { signal: ac.signal })
        .then((r) => r.json())
        .then((json: ScreenResponse) => {
          setData(json);
          setFilters(json.filters);
          setWatchlist(json.watchlist);
        })
        .catch((e) => {
          if ((e as Error).name !== 'AbortError') console.error(e);
        })
        .finally(() => setLoading(false));
    },
    [pathname, router],
  );

  const update = useCallback(
    (patch: Partial<ScreenFilters>) => {
      const next = { ...filters, ...patch };
      setFilters(next);
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => run(next), 160);
    },
    [filters, run],
  );

  const setSort = useCallback(
    (key: SortKey) => {
      const dir = filters.sort === key && filters.sortDir === 'desc' ? 'asc' : 'desc';
      run({ ...filters, sort: key, sortDir: dir });
    },
    [filters, run],
  );

  const saveWatchlist = useCallback(
    async (symbols: string[]) => {
      const res = await fetch('/api/watchlist', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ symbols }),
      });
      const json = (await res.json()) as { symbols?: string[] };
      if (json.symbols) {
        setWatchlist(json.symbols);
        run(filters);
      }
    },
    [filters, run],
  );

  useEffect(() => () => clearTimeout(debounceRef.current), []);

  const { meta, counts, nearestMatches } = data;
  const shownRows = useMemo(
    () => (onlySymbol ? data.visible.filter((r) => r.symbol === onlySymbol) : data.visible),
    [data.visible, onlySymbol],
  );

  return (
    <>
      <a href="#results" className="skip-link">
        Skip to results
      </a>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <h1>Put-Sell Screener</h1>
        </div>
        <span className={`status status-${meta.status}`}>{meta.status}</span>
        <span className="meta">
          {meta.runId} · {(meta.dataCompleteness * 100).toFixed(0)}% complete ·{' '}
          {meta.displayDelayed ? 'delayed data' : 'realtime'}
        </span>
        <span className="spacer" />
        <a className="navlink" href="/todays-pick">
          Today&apos;s pick
        </a>
        <a className="navlink" href="/method">
          Method
        </a>
        <a className="navlink" href="/glossary">
          Glossary
        </a>
      </header>

      <div className="layout">
        <aside className="panel filters">
          <FilterPanel
            filters={filters}
            onChange={update}
            onReset={() => run(DEFAULT_FILTERS)}
            signedIn={!!user}
            watchlist={watchlist}
            onWatchlistChange={saveWatchlist}
          />
        </aside>

        <main id="results">
          <div className="results-head">
            <span className="count">
              {(onlySymbol ? shownRows.length : counts.visible).toLocaleString()} candidates
            </span>
            <span className="sub">
              of {counts.priced.toLocaleString()} priced · {counts.excluded.toLocaleString()} filtered out
              {loading ? ' · …' : ''}
            </span>
            {onlySymbol && (
              <button className="btn" onClick={() => setOnlySymbol(null)}>
                {onlySymbol} only ✕
              </button>
            )}
          </div>

          {counts.visible === 0 && nearestMatches.length > 0 && (
            <div className="nearest">
              No matches. Nearest:{' '}
              {nearestMatches.map((m, i) => (
                <span key={m.key}>
                  {i > 0 && ' · '}
                  <button onClick={() => update({ [m.key]: m.to } as Partial<ScreenFilters>)}>
                    relax {m.label} → {formatRelax(m.key, m.to)}
                  </button>{' '}
                  (+{m.adds})
                </span>
              ))}
            </div>
          )}

          <CandidatesTable
            rows={shownRows}
            preset={filters.columns}
            sort={filters.sort}
            sortDir={filters.sortDir}
            onSort={setSort}
            highlightedOcc={highlightedOcc}
            onHover={setHighlightedOcc}
            expandedOcc={expandedOcc}
            onToggleExpand={(occ) => setExpandedOcc((cur) => (cur === occ ? null : occ))}
            snapshotRunId={meta.runId}
            signedIn={!!user}
          />

          <WhyNotHere filters={filters} />

          <TopPutVolume onPick={(sym) => setOnlySymbol((cur) => (cur === sym ? null : sym))} />
          <TopPutVolume
            onPick={(sym) => setOnlySymbol((cur) => (cur === sym ? null : sym))}
            minSpot={5}
            maxSpot={200}
            title="Top 25 by put volume — today, $5–$200 spot"
          />
          <TopPutVolumeMonthly onPick={(sym) => setOnlySymbol((cur) => (cur === sym ? null : sym))} />

          <p className="disclaimer">
            Screening tool, not investment advice. Selling puts — cash-secured or on margin — carries
            substantial loss potential if the underlying falls sharply. Data may be delayed.
          </p>
        </main>
      </div>
    </>
  );
}

const FRACTION_KEYS = new Set(['maxSpreadPct', 'minAnnRoc', 'maxProbItm']);
function formatRelax(key: string, to: number): string {
  return FRACTION_KEYS.has(key) ? `${(to * 100).toFixed(0)}%` : String(to);
}
