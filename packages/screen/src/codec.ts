/**
 * ScreenFilters ↔ URL query string (plan §7). Round-trips, clamps to the meta
 * ranges, and omits values equal to the default so shared URLs stay short.
 */

import {
  DEFAULT_FILTERS,
  NUMERIC_FILTER_META,
  type ColumnPreset,
  type CapitalBasis,
  type EarningsMode,
  type ExpirationType,
  type IvRankMode,
  type ScreenFilters,
  type SortDir,
  type SortKey,
} from './filters.js';

const NUM_RANGE = new Map(NUMERIC_FILTER_META.map((m) => [m.key, m] as const));

function clampNumeric(key: keyof ScreenFilters, value: number): number {
  const meta = NUM_RANGE.get(key);
  if (!meta || !Number.isFinite(value)) return DEFAULT_FILTERS[key] as number;
  return Math.min(meta.max, Math.max(meta.min, value));
}

const asBool = (v: string | null, dflt: boolean): boolean => (v == null ? dflt : v === '1' || v === 'true');
const asEnum = <T extends string>(v: string | null, allowed: readonly T[], dflt: T): T =>
  v != null && (allowed as readonly string[]).includes(v) ? (v as T) : dflt;
const asList = (v: string | null): string[] => (v ? v.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean) : []);

export function filtersFromQuery(params: URLSearchParams): ScreenFilters {
  const n = (key: keyof ScreenFilters): number => {
    const raw = params.get(key);
    return raw == null ? (DEFAULT_FILTERS[key] as number) : clampNumeric(key, Number(raw));
  };

  const f: ScreenFilters = {
    intendedOrderSize: Math.round(n('intendedOrderSize')),
    dteMin: Math.round(n('dteMin')),
    dteMax: Math.round(n('dteMax')),
    deltaLo: n('deltaLo'),
    deltaHi: n('deltaHi'),
    maxSpreadPct: n('maxSpreadPct'),
    minEntryCredit: n('minEntryCredit'),
    minAnnRoc: n('minAnnRoc'),
    maxProbItm: n('maxProbItm'),
    minOpenInterest: Math.round(n('minOpenInterest')),
    minVolume: Math.round(n('minVolume')),
    maxOrderSizeVsOiPct: n('maxOrderSizeVsOiPct'),
    ivRankMode: asEnum<IvRankMode>(params.get('ivRankMode'), ['rank', 'pctile'], DEFAULT_FILTERS.ivRankMode),
    minIvRankOrPctile: Math.round(n('minIvRankOrPctile')),
    requireOwnIvRank: asBool(params.get('requireOwnIvRank'), DEFAULT_FILTERS.requireOwnIvRank),
    earningsBeforeExpiry: asEnum<EarningsMode>(params.get('earningsBeforeExpiry'), ['exclude', 'flag', 'ignore'], DEFAULT_FILTERS.earningsBeforeExpiry),
    expirationType: asEnum<ExpirationType>(params.get('expirationType'), ['any', 'monthly', 'weekly'], DEFAULT_FILTERS.expirationType),
    minUnderlyingPrice: n('minUnderlyingPrice'),
    maxUnderlyingPrice: n('maxUnderlyingPrice'),
    maxBuyingPowerPerPosition:
      params.get('maxBuyingPowerPerPosition') == null || params.get('maxBuyingPowerPerPosition') === ''
        ? null
        : Math.max(0, Number(params.get('maxBuyingPowerPerPosition'))),
    capitalBasis: asEnum<CapitalBasis>(params.get('capitalBasis'), ['csp', 'regt'], DEFAULT_FILTERS.capitalBasis),
    sectors: asList(params.get('sectors')),
    excludeSymbols: asList(params.get('excludeSymbols')),
    hideBorrow: asBool(params.get('hideBorrow'), DEFAULT_FILTERS.hideBorrow),
    hideDividend: asBool(params.get('hideDividend'), DEFAULT_FILTERS.hideDividend),
    hideBelowParity: asBool(params.get('hideBelowParity'), DEFAULT_FILTERS.hideBelowParity),
    hideIvProxy: asBool(params.get('hideIvProxy'), DEFAULT_FILTERS.hideIvProxy),
    watchlistOnly: asBool(params.get('watchlistOnly'), DEFAULT_FILTERS.watchlistOnly),
    sort: asEnum<SortKey>(params.get('sort'), SORT_KEYS, DEFAULT_FILTERS.sort),
    sortDir: asEnum<SortDir>(params.get('sortDir'), ['asc', 'desc'], DEFAULT_FILTERS.sortDir),
    columns: asEnum<ColumnPreset>(params.get('columns'), ['essentials', 'greeks', 'risk', 'returns', 'all'], DEFAULT_FILTERS.columns),
  };

  // keep the bands coherent
  if (f.dteMin > f.dteMax) [f.dteMin, f.dteMax] = [f.dteMax, f.dteMin];
  if (f.deltaLo > f.deltaHi) [f.deltaLo, f.deltaHi] = [f.deltaHi, f.deltaLo];
  if (f.minUnderlyingPrice > f.maxUnderlyingPrice) [f.minUnderlyingPrice, f.maxUnderlyingPrice] = [f.maxUnderlyingPrice, f.minUnderlyingPrice];
  return f;
}

export function filtersToQuery(f: ScreenFilters): URLSearchParams {
  const params = new URLSearchParams();
  const d = DEFAULT_FILTERS as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(f) as [keyof ScreenFilters, unknown][]) {
    if (value == null) continue;
    if (Array.isArray(value)) {
      if (value.length) params.set(key, value.join(','));
      continue;
    }
    if (JSON.stringify(value) === JSON.stringify(d[key])) continue;
    params.set(key, String(value));
  }
  return params;
}

const SORT_KEYS = [
  'score', 'evToMaxloss', 'annRoc', 'decayYield', 'iv', 'ivRank', 'putSkew25d', 'ivVsFitted',
  'delta', 'pop', 'probItm', 'spreadPct', 'dte', 'openInterest', 'volume', 'entryCredit', 'displayCapital', 'symbol',
] as const satisfies readonly SortKey[];
