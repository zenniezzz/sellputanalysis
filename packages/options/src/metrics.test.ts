import { describe, expect, it } from 'vitest';
import {
  annualizedRoc,
  bePctBelowSpot,
  breakeven,
  cleanQuoteReject,
  cspCapital100,
  decayYield,
  expectedMoveDistance,
  fillModel,
  moneynessPct,
  regTCapital100,
  spreadPct,
} from './metrics.js';

describe('fillModel', () => {
  it('applies slippage and per-contract costs', () => {
    const f = fillModel({ bid: 2.0, ask: 2.2, slippageK: 0.3, commissionPerContract: 0.65, exchangeFeePerContract: 0.03, multiplier: 100 });
    expect(f.mid).toBeCloseTo(2.1, 10);
    // assumedFill = 2.1 - 0.3 * 0.1 = 2.07 ; minus (0.65+0.03)/100 = 0.0068
    expect(f.assumedFill).toBeCloseTo(2.07, 10);
    expect(f.entryCredit).toBeCloseTo(2.0632, 10);
    expect(f.entryCredit100).toBeCloseTo(206.32, 8);
  });

  it('k = 0 fills at mid (minus fees)', () => {
    const f = fillModel({ bid: 1, ask: 1.5, slippageK: 0 });
    expect(f.assumedFill).toBeCloseTo(1.25, 10);
  });
});

describe('cleanQuoteReject', () => {
  const ok = { bid: 1.0, ask: 1.1, quoteAgeMs: 1000, isNonStandard: false };
  it('passes a good quote', () => {
    expect(cleanQuoteReject(ok)).toBeNull();
  });
  it('rejects zero bid, crossed, wide, sub-penny, stale, non-standard', () => {
    expect(cleanQuoteReject({ ...ok, bid: 0 })).toBe('zero_bid');
    expect(cleanQuoteReject({ ...ok, bid: 1.2, ask: 1.1 })).toBe('crossed');
    expect(cleanQuoteReject({ bid: 1, ask: 2, quoteAgeMs: 0, isNonStandard: false })).toBe('wide_spread');
    expect(cleanQuoteReject({ bid: 0.01, ask: 0.02, quoteAgeMs: 0, isNonStandard: false })).toBe('sub_penny');
    expect(cleanQuoteReject({ ...ok, quoteAgeMs: 999_999 })).toBe('stale_quote');
    expect(cleanQuoteReject({ ...ok, isNonStandard: true })).toBe('non_standard');
  });
  it('allows a moderately wide cheap quote under the absolute cap', () => {
    expect(cleanQuoteReject({ bid: 0.2, ask: 0.35, quoteAgeMs: 0, isNonStandard: false })).toBeNull();
  });
});

describe('simple metrics', () => {
  it('moneyness is negative for an OTM put', () => {
    expect(moneynessPct(100, 92)).toBeCloseTo(-0.08, 10);
  });
  it('spread %', () => {
    expect(spreadPct(2, 2.2)).toBeCloseTo(0.2 / 2.1, 10);
    expect(spreadPct(0, 0)).toBe(Number.POSITIVE_INFINITY);
  });
  it('breakeven and cushion', () => {
    expect(breakeven(95, 2)).toBe(93);
    expect(bePctBelowSpot(100, 93)).toBeCloseTo(0.07, 10);
  });
  it('decay yield', () => {
    expect(decayYield(0.05, 2)).toBeCloseTo(0.025, 10);
  });
  it('expected-move distance uses sigma30', () => {
    const d = expectedMoveDistance(100, 90, 0.3, 40 / 365);
    expect(d).toBeGreaterThan(0);
  });
});

describe('capital & ROC', () => {
  it('CSP basis, null for cash-settled', () => {
    expect(cspCapital100(95, 2, 100, 'physical')).toBe(9300);
    expect(cspCapital100(95, 2, 100, 'cash')).toBeNull();
  });
  it('Reg-T naked put estimate', () => {
    // S=100,K=92,credit=1.9 : max(20%*100 - (100-92), 10%*92) = max(12, 9.2) = 12 ; *100 + 190
    expect(regTCapital100({ s: 100, k: 92, entryCredit: 1.9, multiplier: 100 })).toBeCloseTo(1390, 6);
    // broad index uses 0.15 : max(15 - 8, 9.2) = 9.2 (the OTM amount pushes below the floor) ; *100 + 190
    expect(regTCapital100({ s: 100, k: 92, entryCredit: 1.9, multiplier: 100, isBroadIndex: true })).toBeCloseTo(1110, 6);
  });
  it('annualized ROC', () => {
    expect(annualizedRoc(190, 9300, 40)).toBeCloseTo((190 / 9300) * (365 / 40), 10);
  });
});
