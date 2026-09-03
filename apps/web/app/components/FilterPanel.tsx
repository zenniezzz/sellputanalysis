'use client';

import { NUMERIC_FILTER_META, type NumericFilterMeta, type ScreenFilters } from '@pss/screen';

const GROUPS: { key: NumericFilterMeta['group']; label: string }[] = [
  { key: 'universe', label: 'Universe' },
  { key: 'contract', label: 'Contract' },
  { key: 'liquidity', label: 'Liquidity' },
  { key: 'vol', label: 'Volatility' },
  { key: 'risk', label: 'Risk / return' },
  { key: 'capital', label: 'Capital' },
];

export function FilterPanel({
  filters,
  onChange,
  onReset,
}: {
  filters: ScreenFilters;
  onChange: (patch: Partial<ScreenFilters>) => void;
  onReset: () => void;
}) {
  const numField = (m: NumericFilterMeta) => {
    const value = filters[m.key] as number;
    const display = m.unit === 'pct' || m.unit === 'prob' ? value : value;
    return (
      <div className="field" key={m.key}>
        <label>{m.label}</label>
        <input
          type="number"
          min={m.unit === 'pct' || m.unit === 'prob' ? m.min * 100 : m.min}
          max={m.unit === 'pct' || m.unit === 'prob' ? m.max * 100 : m.max}
          step={m.unit === 'pct' || m.unit === 'prob' ? Math.max(m.step * 100, 1) : m.step}
          value={m.unit === 'pct' || m.unit === 'prob' ? +(Number(display) * 100).toFixed(2) : display}
          onChange={(e) => {
            const raw = Number(e.target.value);
            onChange({ [m.key]: m.unit === 'pct' || m.unit === 'prob' ? raw / 100 : raw } as Partial<ScreenFilters>);
          }}
        />
      </div>
    );
  };

  return (
    <div>
      {GROUPS.map((g) => {
        const fields = NUMERIC_FILTER_META.filter((m) => m.group === g.key);
        return (
          <section key={g.key}>
            <h3>{g.label}</h3>
            {fields.map(numField)}
            {g.key === 'vol' && (
              <>
                <div className="field">
                  <label>IV rank basis</label>
                  <select
                    value={filters.ivRankMode}
                    onChange={(e) => onChange({ ivRankMode: e.target.value as ScreenFilters['ivRankMode'] })}
                  >
                    <option value="pctile">IV percentile</option>
                    <option value="rank">IV rank</option>
                  </select>
                </div>
                <div className="field check">
                  <input
                    id="ownIv"
                    type="checkbox"
                    checked={filters.requireOwnIvRank}
                    onChange={(e) => onChange({ requireOwnIvRank: e.target.checked })}
                  />
                  <label htmlFor="ownIv">Require own-history IV rank</label>
                </div>
              </>
            )}
            {g.key === 'contract' && (
              <div className="field">
                <label>Expiration type</label>
                <select
                  value={filters.expirationType}
                  onChange={(e) => onChange({ expirationType: e.target.value as ScreenFilters['expirationType'] })}
                >
                  <option value="any">Any</option>
                  <option value="monthly">Monthly only</option>
                  <option value="weekly">Weekly only</option>
                </select>
              </div>
            )}
            {g.key === 'capital' && (
              <>
                <div className="field">
                  <label>Capital basis</label>
                  <select
                    value={filters.capitalBasis}
                    onChange={(e) => onChange({ capitalBasis: e.target.value as ScreenFilters['capitalBasis'] })}
                  >
                    <option value="csp">Cash-secured</option>
                    <option value="regt">Reg-T margin</option>
                  </select>
                </div>
                <div className="field">
                  <label>Max BP / position ($, blank = none)</label>
                  <input
                    type="number"
                    min={500}
                    step={500}
                    value={filters.maxBuyingPowerPerPosition ?? ''}
                    onChange={(e) =>
                      onChange({ maxBuyingPowerPerPosition: e.target.value === '' ? null : Number(e.target.value) })
                    }
                  />
                </div>
              </>
            )}
            {g.key === 'risk' && (
              <div className="field">
                <label>Earnings before expiry</label>
                <select
                  value={filters.earningsBeforeExpiry}
                  onChange={(e) =>
                    onChange({ earningsBeforeExpiry: e.target.value as ScreenFilters['earningsBeforeExpiry'] })
                  }
                >
                  <option value="exclude">Exclude</option>
                  <option value="flag">Flag only</option>
                  <option value="ignore">Ignore</option>
                </select>
              </div>
            )}
          </section>
        );
      })}

      <section>
        <h3>Exclusions</h3>
        <div className="field">
          <label>Exclude symbols (comma-sep)</label>
          <input
            type="text"
            defaultValue={filters.excludeSymbols.join(',')}
            onBlur={(e) =>
              onChange({
                excludeSymbols: e.target.value
                  .split(',')
                  .map((s) => s.trim().toUpperCase())
                  .filter(Boolean),
              })
            }
          />
        </div>
        {(
          [
            ['hideBorrow', 'Hide borrow caution'],
            ['hideDividend', 'Hide dividend caution'],
            ['hideBelowParity', 'Hide below-parity'],
            ['hideIvProxy', 'Hide IV-rank proxy'],
          ] as const
        ).map(([key, label]) => (
          <div className="field check" key={key}>
            <input
              id={key}
              type="checkbox"
              checked={filters[key]}
              onChange={(e) => onChange({ [key]: e.target.checked } as Partial<ScreenFilters>)}
            />
            <label htmlFor={key}>{label}</label>
          </div>
        ))}
      </section>

      <section>
        <h3>Display</h3>
        <div className="field">
          <label>Columns</label>
          <select
            value={filters.columns}
            onChange={(e) => onChange({ columns: e.target.value as ScreenFilters['columns'] })}
          >
            <option value="essentials">Essentials</option>
            <option value="greeks">Greeks</option>
            <option value="risk">Risk</option>
            <option value="returns">Returns</option>
            <option value="all">All</option>
          </select>
        </div>
      </section>

      <button className="reset" onClick={onReset}>
        Reset all filters
      </button>
    </div>
  );
}
