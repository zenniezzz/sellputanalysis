'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  DEFAULT_FILTERS,
  filtersFromQuery,
  filtersToQuery,
  type ScreenFilters,
  type SortKey,
} from '@pss/screen';
import type { ScreenResponse } from '../lib/types';
import { AccountBar } from './AccountBar';
import { CandidatesTable } from './CandidatesTable';
import { CompareTray, useCompareTray } from './CompareTray';
import { CompareView } from './CompareView';
import { FilterPanel } from './FilterPanel';
import { SavedScreens } from './SavedScreens';
import { FirstRunBar } from './FirstRunBar';
import { SnapshotsPanel } from './SnapshotsPanel';
import { StatusBanner } from './StatusBanner';
import { TradesPanel } from './TradesPanel';
import { UniversePanel } from './UniversePanel';
import { WhyNotHere } from './WhyNotHere';

type View = 'candidates' | 'compare' | 'snapshots' | 'universe' | 'trades';

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
  const [view, setView] = useState<View>('candidates');
  const [onlySymbol, setOnlySymbol] = useState<string | null>(null);
  const [freezeMsg, setFreezeMsg] = useState<string | null>(null);
  const { selected } = useCompareTray();
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const query = useMemo(() => filtersToQuery(filters).toString(), [filters]);

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

  const freeze = useCallback(async () => {
    const name = window.prompt('Freeze this screen as:');
    if (!name?.trim()) return;
    const res = await fetch('/api/bookmarks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), snapshotRunId: data.meta.runId, filterQuery: query }),
    });
    setFreezeMsg(res.ok ? `Frozen "${name.trim()}"` : 'Sign in to freeze screens');
    setTimeout(() => setFreezeMsg(null), 4000);
  }, [data.meta.runId, query]);

  useEffect(() => () => clearTimeout(debounceRef.current), []);

  const { meta, run: ingestion, counts, nearestMatches } = data;
  const shownRows = useMemo(
    () => (onlySymbol ? data.visible.filter((r) => r.symbol === onlySymbol) : data.visible),
    [data.visible, onlySymbol],
  );

  return (
    <>
      <a href="#results" className="skip-link">
        Skip to results
      </a>
      <div className="toolbar">
        <h1>Put-Sell Screener</h1>
        <span className={`badge ${meta.status}`}>{meta.status}</span>
        <span className="badge" title="composite-score reference basis">
          score: {meta.scoreBasis.replace('_', '-')}
        </span>
        <span className="meta">
          {meta.runId} · {(meta.dataCompleteness * 100).toFixed(0)}% complete ·{' '}
          {meta.displayDelayed ? 'delayed data' : 'realtime'}
        </span>
        {ingestion.greekXcheckMedianAbsPct != null && (
          <span className="badge">Δ x-check {ingestion.greekXcheckMedianAbsPct.toFixed(2)}%</span>
        )}
        <span style={{ flex: 1 }} />
        <a className="badge" href="/glossary">
          Glossary
        </a>
        <a className="badge" href="/method">
          Model &amp; method
        </a>
        <a className="badge" href="/docs">
          API
        </a>
        <a
          className="badge"
          href={`mailto:beta@example.com?subject=Screener%20feedback%20(${meta.runId})`}
        >
          Beta feedback
        </a>
        <AccountBar email={user?.email ?? null} />
      </div>

      <FirstRunBar />
      <StatusBanner meta={meta} />
      <CompareTray rows={data.visible} />

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
          <nav className="tabnav" role="tablist">
            <button role="tab" aria-selected={view === 'candidates'} className={view === 'candidates' ? 'active' : ''} onClick={() => setView('candidates')}>
              Candidates
            </button>
            <button role="tab" aria-selected={view === 'universe'} className={view === 'universe' ? 'active' : ''} onClick={() => setView('universe')}>
              Universe
            </button>
            <button role="tab" aria-selected={view === 'compare'} className={view === 'compare' ? 'active' : ''} onClick={() => setView('compare')}>
              Compare ({selected.length})
            </button>
            <button role="tab" aria-selected={view === 'snapshots'} className={view === 'snapshots' ? 'active' : ''} onClick={() => setView('snapshots')}>
              Snapshots
            </button>
            <button role="tab" aria-selected={view === 'trades'} className={view === 'trades' ? 'active' : ''} onClick={() => setView('trades')}>
              Trades
            </button>
          </nav>

          {view === 'trades' ? (
            <TradesPanel signedIn={!!user} />
          ) : view === 'universe' ? (
            <UniversePanel
              onPick={(sym) => {
                setOnlySymbol(sym);
                setView('candidates');
              }}
            />
          ) : view === 'snapshots' ? (
            <SnapshotsPanel signedIn={!!user} />
          ) : (
            <>
              <div className="results-head">
                <span className="count">
                  {onlySymbol ? shownRows.length : counts.visible.toLocaleString()} candidates
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
                <span className="spacer" />
                {freezeMsg && (
                  <span className="sub" style={{ color: 'var(--accent)' }}>
                    {freezeMsg}
                  </span>
                )}
                <button className="btn" onClick={freeze}>
                  Freeze
                </button>
                <SavedScreens
                  signedIn={!!user}
                  currentQuery={query}
                  onLoad={(q) => run(filtersFromQuery(new URLSearchParams(q)))}
                />
                <a className="btn" href={`/api/export?format=csv&${query}`}>
                  CSV
                </a>
                <a className="btn" href={`/api/export?format=json&${query}`}>
                  JSON
                </a>
              </div>

              {view === 'compare' ? (
                <CompareView rows={data.visible} selected={selected} />
              ) : (
                <>
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
                </>
              )}
            </>
          )}

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
