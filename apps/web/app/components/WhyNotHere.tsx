'use client';

import { useState } from 'react';
import { filtersToQuery, type ScreenFilters } from '@pss/screen';
import type { ContractExplanationDto } from '../lib/types';

export function WhyNotHere({ filters }: { filters: ScreenFilters }) {
  const [symbol, setSymbol] = useState('');
  const [result, setResult] = useState<ContractExplanationDto[] | null>(null);
  const [loading, setLoading] = useState(false);

  async function check() {
    const s = symbol.trim().toUpperCase();
    if (!s) return;
    setLoading(true);
    const q = filtersToQuery(filters).toString();
    const res = await fetch(`/api/explain?symbol=${encodeURIComponent(s)}&${q}`);
    const json = (await res.json()) as { contracts: ContractExplanationDto[] };
    setResult(json.contracts);
    setLoading(false);
  }

  return (
    <div className="explain">
      <h3 style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--ink-faint)' }}>
        Why isn&rsquo;t a ticker here?
      </h3>
      <input
        type="text"
        placeholder="e.g. NVDA"
        value={symbol}
        onChange={(e) => setSymbol(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && check()}
      />{' '}
      <button className="btn" onClick={check} disabled={loading}>
        {loading ? '…' : 'Check'}
      </button>

      {result != null && (
        <div style={{ marginTop: 10 }}>
          {result.length === 0 && <div className="contract">No priced contracts for that symbol in this snapshot.</div>}
          {result.map((c) => (
            <div className="contract" key={c.occSymbol}>
              <strong>
                {c.expiration} {c.strike}P
              </strong>{' '}
              ({c.dte} DTE) —{' '}
              {c.pipelineExclusion ? (
                <span className="fail">dropped at ingestion: {c.pipelineExclusion}</span>
              ) : c.isVisible ? (
                <span className="ok">passes — it is in the table</span>
              ) : (
                <span className="fail">fails: {c.failedFilters.join(', ')}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
