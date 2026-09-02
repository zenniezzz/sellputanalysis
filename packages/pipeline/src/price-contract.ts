/** Stage D–E for a single put contract (plan §5). Pure given its inputs. */

import {
  annualizedRoc,
  bePctBelowSpot,
  breakeven,
  bsmGreeks,
  cleanQuoteReject,
  cspCapital100,
  decayYield,
  expectedMoveDistance,
  expectedValue,
  fillModel,
  forecastVol,
  impliedVol,
  moneynessPct,
  normalCdf,
  regTCapital100,
  spreadPct,
} from '@pss/options';
import type { OptionQuote, Underlying } from '@pss/market-data';
import type { CandidateGate, ModelCaution, SnapshotRow } from './snapshot-types.js';

export interface PriceContext {
  underlying: Underlying;
  spot: number;
  spotAdj: number;
  q: number;
  rate: number;
  t: number;
  dte: number;
  sigma30: number;
  gate: CandidateGate;
  quoteAgeMs: number;
  earningsBeforeExpiry: boolean;
  vrpHaircut: number;
}

export interface PriceResult {
  row: SnapshotRow;
  /** vendor-vs-own IV abs % diff, when the vendor supplied greeks. */
  greekDiffPct: number | null;
  ivSolveFailed: boolean;
}

function baseRow(o: OptionQuote, ctx: PriceContext, mid: number): SnapshotRow {
  return {
    occSymbol: o.occSymbol,
    symbol: o.underlying,
    expiration: o.expiration,
    strike: o.strike,
    multiplier: o.multiplier,
    dte: ctx.dte,
    spot: ctx.spot,
    spotAdj: ctx.spotAdj,
    bid: o.bid,
    ask: o.ask,
    mid,
    last: o.last,
    volume: o.volume,
    openInterest: o.openInterest,
    quoteAsOf: o.quoteAsOf,
    entryCredit: null,
    entryCredit100: null,
    midCredit: mid,
    slippageK: 0.3,
    iv: null,
    ivVsFitted: null,
    ivRank: null,
    ivPctile: null,
    putSkew25d: null,
    delta: null,
    gamma: null,
    thetaDay: null,
    dailyDecay: null,
    vega: null,
    moneynessPct: moneynessPct(ctx.spot, o.strike),
    spreadPct: spreadPct(o.bid, o.ask),
    volOi: o.openInterest > 0 ? o.volume / o.openInterest : null,
    decayYield: null,
    thetaVega: null,
    breakeven: null,
    bePct: null,
    probItm: null,
    pop: null,
    emDistance: null,
    cspCapital100: null,
    regtCapital100: null,
    annRoc: null,
    capitalBasis: null,
    ev100: null,
    maxLoss100: null,
    evToMaxloss: null,
    creditToMaxloss: null,
    sigmaF: null,
    vrpHaircut: null,
    score: null,
    scoreComponents: null,
    modelCaution: {
      borrow: ctx.underlying.hardToBorrow || (ctx.underlying.borrowRate ?? 0) > 0.01,
      dividend: ctx.underlying.dividends.length === 0,
      ivRankProxy: true,
      belowParity: false,
      earningsBeforeExpiry: ctx.earningsBeforeExpiry,
      spotAsync: o.underlyingPriceAtQuote == null,
    } satisfies ModelCaution,
    assignmentWatch: false,
    isCandidate: false,
    excludedReason: null,
  };
}

export function priceContract(o: OptionQuote, ctx: PriceContext): PriceResult {
  const mid = (o.bid + o.ask) / 2;
  const row = baseRow(o, ctx, mid);

  const reject = cleanQuoteReject({
    bid: o.bid,
    ask: o.ask,
    quoteAgeMs: ctx.quoteAgeMs,
    isNonStandard: o.isNonStandard,
  });
  if (reject) {
    row.excludedReason = `quote:${reject}`;
    return { row, greekDiffPct: null, ivSolveFailed: false };
  }

  const ivRes = impliedVol(mid, { s: ctx.spotAdj, k: o.strike, r: ctx.rate, q: ctx.q, t: ctx.t }, 'put');
  if (!ivRes.ok) {
    row.excludedReason = `iv:${ivRes.failure}`;
    if (ivRes.failure === 'below_intrinsic') row.modelCaution.belowParity = true;
    return { row, greekDiffPct: null, ivSolveFailed: true };
  }

  const g = bsmGreeks({ s: ctx.spotAdj, k: o.strike, r: ctx.rate, q: ctx.q, sigma: ivRes.iv, t: ctx.t }, 'put');
  const fill = fillModel({ bid: o.bid, ask: o.ask, multiplier: o.multiplier });
  const sigmaF = forecastVol({
    hv20: ctx.underlying.hv20,
    hv252: ctx.underlying.hv252,
    sigma30: ctx.sigma30,
    vrpHaircut: ctx.vrpHaircut,
  });
  const ev = expectedValue({
    sAdj: ctx.spotAdj,
    k: o.strike,
    entryCredit: fill.entryCredit,
    mu: ctx.rate - ctx.q,
    sigmaF,
    t: ctx.t,
    multiplier: o.multiplier,
  });

  const isCash = ctx.underlying.settlement === 'cash';
  const csp = cspCapital100(o.strike, fill.entryCredit, o.multiplier, ctx.underlying.settlement);
  const regt = regTCapital100({
    s: ctx.spot,
    k: o.strike,
    entryCredit: fill.entryCredit,
    multiplier: o.multiplier,
    isBroadIndex: isCash,
  });
  const capitalBasis: 'csp' | 'regt' = isCash || csp == null ? 'regt' : 'csp';
  const capital100 = capitalBasis === 'csp' ? (csp as number) : regt;
  const be = breakeven(o.strike, fill.entryCredit);
  const intrinsic = Math.max(o.strike - ctx.spot, 0);
  const timeValue = mid - intrinsic;

  Object.assign(row, {
    entryCredit: fill.entryCredit,
    entryCredit100: fill.entryCredit100,
    slippageK: 0.3,
    iv: ivRes.iv,
    delta: g.delta,
    gamma: g.gamma,
    thetaDay: g.thetaPerDay,
    dailyDecay: g.dailyDecay,
    vega: g.vega,
    decayYield: decayYield(g.dailyDecay, fill.entryCredit),
    thetaVega: g.vega !== 0 ? g.dailyDecay / g.vega : null,
    breakeven: be,
    bePct: bePctBelowSpot(ctx.spot, be),
    probItm: normalCdf(-g.d2),
    pop: ev.pop,
    emDistance: expectedMoveDistance(ctx.spot, o.strike, ctx.sigma30, ctx.t),
    cspCapital100: csp,
    regtCapital100: regt,
    annRoc: annualizedRoc(fill.entryCredit100, capital100, ctx.dte),
    capitalBasis,
    ev100: ev.ev100,
    maxLoss100: ev.maxLoss100,
    evToMaxloss: ev.evToMaxLoss,
    creditToMaxloss: ev.creditToMaxLoss,
    sigmaF,
    vrpHaircut: ctx.vrpHaircut,
    assignmentWatch:
      intrinsic > 0 && timeValue < 0.1 * intrinsic && ctx.underlying.exerciseStyle === 'american',
  } satisfies Partial<SnapshotRow>);

  applyGate(row, ctx.gate);

  let greekDiffPct: number | null = null;
  if (o.vendorGreeks && Number.isFinite(o.vendorGreeks.iv) && o.vendorGreeks.iv > 0) {
    greekDiffPct = Math.abs(ivRes.iv - o.vendorGreeks.iv) / o.vendorGreeks.iv;
  }
  return { row, greekDiffPct, ivSolveFailed: false };
}

function applyGate(row: SnapshotRow, gate: CandidateGate): void {
  const checks: [boolean, string][] = [
    [row.dte >= gate.dteMin && row.dte <= gate.dteMax, 'dte'],
    [row.delta != null && Math.abs(row.delta) >= gate.deltaLo && Math.abs(row.delta) <= gate.deltaHi, 'delta'],
    [row.spreadPct <= gate.maxSpreadPct, 'spread'],
    [(row.entryCredit ?? 0) >= gate.minEntryCredit, 'credit'],
    [(row.annRoc ?? 0) >= gate.minAnnRoc, 'annRoc'],
    [(row.probItm ?? 1) <= gate.maxProbItm, 'probItm'],
    [row.openInterest >= gate.minOpenInterest, 'oi'],
    [row.volume >= gate.minVolume, 'volume'],
    [!row.modelCaution.earningsBeforeExpiry, 'earnings'],
  ];
  const failed = checks.filter(([pass]) => !pass).map(([, name]) => name);
  row.isCandidate = failed.length === 0;
  if (!row.isCandidate) row.excludedReason = `gate:${failed.join(',')}`;
}
