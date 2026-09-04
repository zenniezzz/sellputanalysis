/**
 * User-adjustable screen filters (plan §7).
 *
 * These sit on top of the snapshot: the pipeline persists every priced put in the
 * strike window (candidates and non-candidates alike), and the screen re-filters
 * that set live. A filter can therefore be *relaxed* below the pipeline's default
 * gate and surface contracts the gate dropped — but never below what was priced
 * (the strike window and clean-quote gate still bound the universe).
 */

export type IvRankMode = 'rank' | 'pctile';
export type EarningsMode = 'exclude' | 'flag' | 'ignore';
export type ExpirationType = 'any' | 'monthly' | 'weekly';
export type CapitalBasis = 'csp' | 'regt';
export type SortDir = 'asc' | 'desc';
export type ColumnPreset = 'essentials' | 'greeks' | 'risk' | 'returns' | 'all';

export interface ScreenFilters {
  intendedOrderSize: number;
  dteMin: number;
  dteMax: number;
  deltaLo: number;
  deltaHi: number;
  maxSpreadPct: number;
  minEntryCredit: number;
  minAnnRoc: number;
  maxProbItm: number;
  minOpenInterest: number;
  minVolume: number;
  maxOrderSizeVsOiPct: number;
  ivRankMode: IvRankMode;
  minIvRankOrPctile: number;
  requireOwnIvRank: boolean;
  earningsBeforeExpiry: EarningsMode;
  expirationType: ExpirationType;
  minUnderlyingPrice: number;
  maxUnderlyingPrice: number;
  maxBuyingPowerPerPosition: number | null;
  capitalBasis: CapitalBasis;
  sectors: string[];
  excludeSymbols: string[];
  hideBorrow: boolean;
  hideDividend: boolean;
  hideBelowParity: boolean;
  hideIvProxy: boolean;
  /** Restrict to the signed-in user's watchlist (context supplied to applyScreen). */
  watchlistOnly: boolean;
  sort: SortKey;
  sortDir: SortDir;
  columns: ColumnPreset;
}

export const DEFAULT_FILTERS: ScreenFilters = {
  intendedOrderSize: 10,
  dteMin: 25,
  dteMax: 45,
  deltaLo: 0.15,
  deltaHi: 0.25,
  maxSpreadPct: 0.08,
  minEntryCredit: 0.3,
  minAnnRoc: 0.12,
  maxProbItm: 0.35,
  minOpenInterest: 500,
  minVolume: 100,
  maxOrderSizeVsOiPct: 5,
  ivRankMode: 'pctile',
  minIvRankOrPctile: 30,
  requireOwnIvRank: false,
  earningsBeforeExpiry: 'exclude',
  expirationType: 'any',
  minUnderlyingPrice: 5,
  maxUnderlyingPrice: 200,
  maxBuyingPowerPerPosition: null,
  capitalBasis: 'csp',
  sectors: [],
  excludeSymbols: [],
  hideBorrow: false,
  hideDividend: false,
  hideBelowParity: true,
  hideIvProxy: false,
  watchlistOnly: false,
  sort: 'score',
  sortDir: 'desc',
  columns: 'essentials',
};

export interface NumericFilterMeta {
  key: keyof ScreenFilters;
  label: string;
  min: number;
  max: number;
  step: number;
  unit?: 'pct' | 'usd' | 'int' | 'prob';
  group: 'universe' | 'contract' | 'liquidity' | 'vol' | 'risk' | 'capital';
}

/** Ranges the codec clamps to and the UI renders (plan §7.1). */
export const NUMERIC_FILTER_META: NumericFilterMeta[] = [
  { key: 'intendedOrderSize', label: 'Order size (contracts)', min: 1, max: 1000, step: 1, unit: 'int', group: 'capital' },
  { key: 'dteMin', label: 'DTE min', min: 2, max: 120, step: 1, unit: 'int', group: 'contract' },
  { key: 'dteMax', label: 'DTE max', min: 2, max: 120, step: 1, unit: 'int', group: 'contract' },
  { key: 'deltaLo', label: '|Δ| min', min: 0.05, max: 0.5, step: 0.01, group: 'contract' },
  { key: 'deltaHi', label: '|Δ| max', min: 0.05, max: 0.5, step: 0.01, group: 'contract' },
  { key: 'maxSpreadPct', label: 'Max spread %', min: 0.01, max: 0.25, step: 0.005, unit: 'pct', group: 'liquidity' },
  { key: 'minEntryCredit', label: 'Min entry credit ($/sh)', min: 0.05, max: 5, step: 0.05, unit: 'usd', group: 'contract' },
  { key: 'minAnnRoc', label: 'Min annualized ROC', min: 0, max: 1, step: 0.01, unit: 'pct', group: 'risk' },
  { key: 'maxProbItm', label: 'Max P(ITM)', min: 0.05, max: 0.6, step: 0.01, unit: 'prob', group: 'risk' },
  { key: 'minOpenInterest', label: 'Min open interest', min: 0, max: 10000, step: 50, unit: 'int', group: 'liquidity' },
  { key: 'minVolume', label: 'Min volume (today)', min: 0, max: 5000, step: 25, unit: 'int', group: 'liquidity' },
  // stored as a percent value (5 = 5%), not a fraction
  { key: 'maxOrderSizeVsOiPct', label: 'Max order size vs OI (%)', min: 1, max: 50, step: 1, unit: 'int', group: 'liquidity' },
  { key: 'minIvRankOrPctile', label: 'Min IV rank / pctile', min: 0, max: 100, step: 1, unit: 'int', group: 'vol' },
  { key: 'minUnderlyingPrice', label: 'Min underlying price', min: 1, max: 1000, step: 1, unit: 'usd', group: 'universe' },
  { key: 'maxUnderlyingPrice', label: 'Max underlying price', min: 1, max: 5000, step: 1, unit: 'usd', group: 'universe' },
];

export type SortKey =
  | 'score'
  | 'evToMaxloss'
  | 'annRoc'
  | 'decayYield'
  | 'iv'
  | 'ivRank'
  | 'putSkew25d'
  | 'ivVsFitted'
  | 'delta'
  | 'pop'
  | 'probItm'
  | 'spreadPct'
  | 'dte'
  | 'openInterest'
  | 'volume'
  | 'entryCredit'
  | 'displayCapital'
  | 'symbol';

export const COLUMN_PRESETS: Record<ColumnPreset, SortKey[]> = {
  essentials: ['score', 'symbol', 'dte', 'entryCredit', 'spreadPct', 'iv', 'ivRank', 'putSkew25d', 'ivVsFitted', 'delta', 'decayYield', 'pop', 'evToMaxloss', 'annRoc'],
  greeks: ['score', 'symbol', 'dte', 'iv', 'delta', 'decayYield', 'ivVsFitted'],
  risk: ['score', 'symbol', 'dte', 'delta', 'probItm', 'pop', 'evToMaxloss', 'displayCapital'],
  returns: ['score', 'symbol', 'dte', 'entryCredit', 'decayYield', 'annRoc', 'evToMaxloss'],
  all: [
    'score', 'symbol', 'dte', 'entryCredit', 'spreadPct', 'iv', 'ivRank', 'putSkew25d', 'ivVsFitted',
    'delta', 'decayYield', 'probItm', 'pop', 'evToMaxloss', 'annRoc', 'displayCapital', 'openInterest', 'volume',
  ],
};
