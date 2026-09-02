/** Derived per-contract metrics and the fill/cost model (plan §5.4, §5.5). */

export interface FillModelParams {
  bid: number;
  ask: number;
  /** 0 optimistic … 1 = hit the bid. Default 0.30. */
  slippageK?: number;
  /** Default $0.65 / contract. */
  commissionPerContract?: number;
  /** Default $0.03 / contract. */
  exchangeFeePerContract?: number;
  multiplier?: number;
}

export interface FillModelResult {
  mid: number;
  midCredit: number;
  assumedFill: number;
  /** Per share, net of slippage and fees. */
  entryCredit: number;
  /** Per contract. */
  entryCredit100: number;
}

export function fillModel(p: FillModelParams): FillModelResult {
  const mult = p.multiplier ?? 100;
  const k = p.slippageK ?? 0.3;
  const commissionShare = (p.commissionPerContract ?? 0.65) / mult;
  const feeShare = (p.exchangeFeePerContract ?? 0.03) / mult;

  const mid = (p.bid + p.ask) / 2;
  const halfSpread = (p.ask - p.bid) / 2;
  const assumedFill = mid - k * halfSpread;
  const entryCredit = assumedFill - commissionShare - feeShare;

  return { mid, midCredit: mid, assumedFill, entryCredit, entryCredit100: entryCredit * mult };
}

export type Settlement = 'physical' | 'cash';

export interface CleanQuoteParams {
  bid: number;
  ask: number;
  quoteAgeMs: number;
  isNonStandard: boolean;
  freshnessWindowMs?: number; // default 180_000
}

export type CleanQuoteReject =
  | 'zero_bid'
  | 'crossed'
  | 'wide_spread'
  | 'sub_penny'
  | 'stale_quote'
  | 'non_standard';

/** Plan §5.2 clean-quote gate. Returns null when the quote passes. */
export function cleanQuoteReject(p: CleanQuoteParams): CleanQuoteReject | null {
  const mid = (p.bid + p.ask) / 2;
  if (p.bid <= 0) return 'zero_bid';
  if (p.ask < p.bid) return 'crossed';
  if (p.ask - p.bid > Math.max(0.2, 0.6 * mid)) return 'wide_spread';
  if (mid < 0.02) return 'sub_penny';
  if (p.quoteAgeMs > (p.freshnessWindowMs ?? 180_000)) return 'stale_quote';
  if (p.isNonStandard) return 'non_standard';
  return null;
}

export function moneynessPct(s: number, k: number): number {
  return (k - s) / s;
}

export function spreadPct(bid: number, ask: number): number {
  const mid = (bid + ask) / 2;
  return mid > 0 ? (ask - bid) / mid : Number.POSITIVE_INFINITY;
}

export function breakeven(k: number, entryCredit: number): number {
  return k - entryCredit;
}

export function bePctBelowSpot(s: number, be: number): number {
  return (s - be) / s;
}

export function decayYield(dailyDecay: number, entryCredit: number): number {
  return dailyDecay / entryCredit;
}

export function expectedMoveDistance(s: number, k: number, sigma30: number, t: number): number {
  return (s - k) / (s * sigma30 * Math.sqrt(t));
}

/** Cash-secured basis, per contract. `null` for cash-settled instruments (§1.4). */
export function cspCapital100(
  k: number,
  entryCredit: number,
  multiplier: number,
  settlement: Settlement,
): number | null {
  if (settlement === 'cash') return null;
  return k * multiplier - entryCredit * multiplier;
}

export interface RegTParams {
  s: number;
  k: number;
  entryCredit: number;
  multiplier: number;
  /** 0.15 factor instead of 0.20. */
  isBroadIndex?: boolean;
  /** Floor is 10% of this. Default 'K' (broker-conservative). */
  floorBase?: 'K' | 'S';
}

/** Reg-T naked-put estimate, per contract (§5.5). Brokers vary; portfolio margin differs. */
export function regTCapital100(p: RegTParams): number {
  const f = p.isBroadIndex ? 0.15 : 0.2;
  const otmAmount = Math.max(p.s - p.k, 0);
  const base = (p.floorBase ?? 'K') === 'K' ? p.k : p.s;
  const perShare = Math.max(f * p.s - otmAmount, 0.1 * base);
  return perShare * p.multiplier + p.entryCredit * p.multiplier;
}

export function annualizedRoc(
  entryCredit100: number,
  capitalBasis100: number,
  dteCalendar: number,
): number {
  return (entryCredit100 / capitalBasis100) * (365 / dteCalendar);
}
