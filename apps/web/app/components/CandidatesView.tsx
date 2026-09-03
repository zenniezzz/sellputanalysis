'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { DEFAULT_FILTERS, filtersToQuery, type ScreenFilters, type SortKey } from '@pss/screen';
import type { ScreenResponse } from '../lib/types';
import { FilterPanel } from './FilterPanel';
import { CandidatesTable } from './CandidatesTable';
import { WhyNotHere } from './WhyNotHere';

export function CandidatesView({ initial }: { initial: ScreenResponse }) {
  const router = useRouter();
  const pathname = usePathname();
  const [data, setData] = useState<ScreenResponse>(initial);
  const [filters, setFilters] = useState<ScreenFilters>(initial.filters);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const run = useCallback(
    (next: ScreenFilters) => {
      const query = filtersToQuery(next).toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });

      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setLoading(true);
      fetch(`/api/screen?${query}`, { signal: ac.signal })
        .then((r) => r.json())
        .then((json: ScreenResponse) => {
          setData(json);
          setFilters(json.filters);
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

  const reset = useCallback(() => run(DEFAULT_FILTERS), [run]);

  const setSort = useCallback(
    (key: SortKey) => {
      const dir = filters.sort === key && filters.sortDir === 'desc' ? 'asc' : 'desc';
      run({ ...filters, sort: key, sortDir: dir });
    },
    [filters, run],
  );

  useEffect(() => () => clearTimeout(debounceRef.current), []);

  const { meta, run: ingestion, counts, nearestMatches } = data;

  return (
    <>
      <div className="toolbar">
        <h1>Put-Sell Screener</h1>
        <span className={`badge ${meta.status}`}>{meta.status}</span>
        <span className="meta">
          {meta.runId} · {(meta.dataCompleteness * 100).toFixed(0)}% complete · score {meta.scoreBasis} ·{' '}
          {meta.displayDelayed ? 'delayed data' : 'realtime'}
        </span>
        {ingestion.greekXcheckMedianAbsPct != null && (
          <span className="badge">Δ x-check {ingestion.greekXcheckMedianAbsPct.toFixed(2)}%</span>
        )}
      </div>

      <div className="layout">
        <aside className="panel filters">
          <FilterPanel filters={filters} onChange={update} onReset={reset} />
        </aside>

        <main>
          <div className="results-head">
            <span className="count">{counts.visible.toLocaleString()} candidates</span>
            <span className="sub">
              of {counts.priced.toLocaleString()} priced · {counts.excluded.toLocaleString()} filtered out
              {loading ? ' · …' : ''}
            </span>
            <span className="spacer" />
            <a className="btn" href={`/api/export?format=csv&${filtersToQuery(filters).toString()}`}>
              CSV
            </a>
            <a className="btn" href={`/api/export?format=json&${filtersToQuery(filters).toString()}`}>
              JSON
            </a>
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
            rows={data.visible}
            preset={filters.columns}
            sort={filters.sort}
            sortDir={filters.sortDir}
            onSort={setSort}
          />

          <WhyNotHere filters={filters} />

          <p className="disclaimer">
            Screening tool, not investment advice. Selling puts — cash-secured or on margin — carries
            substantial loss potential if the underlying falls sharply. Data may be delayed.
          </p>
        </main>
      </div>
    </>
  );
}

function formatRelax(key: string, to: number): string {
  if (/Pct|Roc|ProbItm|Spread/.test(key)) return `${(to * 100).toFixed(0)}%`;
  return String(to);
}
