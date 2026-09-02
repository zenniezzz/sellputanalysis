/**
 * Provider-agnostic market-data contracts (plan §3.3).
 *
 * M0 simplification: numeric fields are `number`, not the fixed-precision
 * `Decimal` the plan specifies for storage. The persistence layer in M1
 * introduces decimals at the DB boundary; the math packages operate in float64
 * regardless (BSM needs transcendental functions).
 */

export type Iso8601 = string;

export type Result<T> =
  | { ok: true; value: T; stale?: boolean }
  | { ok: false; error: ProviderError };

export type ProviderError =
  | { kind: 'rate_limited'; retryAfterMs: number }
  | { kind: 'entitlement'; detail: string }
  | { kind: 'not_found' }
  | { kind: 'upstream_5xx'; status: number }
  | { kind: 'timeout' }
  | { kind: 'malformed'; detail: string };

export function ok<T>(value: T, stale = false): Result<T> {
  return { ok: true, value, stale };
}
export function err(error: ProviderError): Result<never> {
  return { ok: false, error };
}

export interface DividendEvent {
  exDate: Iso8601;
  amount: number;
}

export interface Underlying {
  symbol: string;
  name: string;
  spot: number;
  spotAsOf: Iso8601;
  dividends: DividendEvent[];
  hv20: number | null;
  hv252: number | null;
  borrowRate: number | null;
  hardToBorrow: boolean;
  optionVolume20dAvg: number | null;
  hasWeeklies: boolean;
  isAdr: boolean;
  sector: string | null;
  settlement: 'physical' | 'cash';
  exerciseStyle: 'american' | 'european';
  settlementTime: 'am' | 'pm' | null;
}

export interface VendorGreeks {
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  iv: number;
}

export interface OptionQuote {
  occSymbol: string;
  underlying: string;
  expiration: Iso8601;
  strike: number;
  right: 'P' | 'C';
  multiplier: number;
  bid: number;
  ask: number;
  bidSize: number;
  askSize: number;
  last: number | null;
  volume: number;
  openInterest: number;
  quoteAsOf: Iso8601;
  underlyingPriceAtQuote: number | null;
  underlyingPriceAsOf: Iso8601 | null;
  isNonStandard: boolean;
  vendorGreeks?: VendorGreeks;
}

export interface ZeroRatePoint {
  tenorYears: number;
  zeroRate: number;
}

export interface EarningsInfo {
  next: Iso8601;
  confirmed: boolean;
}

export interface MarketData {
  getMostActive(limit: number): Promise<Result<Underlying[]>>;
  getExpirations(symbol: string): Promise<Result<Iso8601[]>>;
  getChain(symbol: string, expiration: Iso8601): Promise<Result<OptionQuote[]>>;
  getUnderlying(symbol: string): Promise<Result<Underlying>>;
  getEarnings(symbol: string): Promise<Result<EarningsInfo | null>>;
}

export interface RatesSource {
  getCurve(asOf: Iso8601): Promise<Result<ZeroRatePoint[]>>;
}
