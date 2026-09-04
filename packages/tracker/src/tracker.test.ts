import { describe, expect, it } from 'vitest';
import { applyClose, calibrationReport, realizedPnl100, type PaperTrade } from './index.js';

function trade(over: Partial<PaperTrade> = {}): PaperTrade {
  return {
    id: 'x',
    userId: 'u1',
    createdAt: '2026-08-01T14:00:00Z',
    snapshotRunId: 'r1',
    occSymbol: 'NVDA  261016P00200000',
    symbol: 'NVDA',
    expiration: '2026-10-16',
    strike: 200,
    multiplier: 100,
    contracts: 1,
    entryCredit: 4,
    actualFillCredit: null,
    entrySpot: 220,
    breakeven: 196,
    modeledPop: 0.8,
    modeledProbItm: 0.25,
    modeledEv100: 120,
    sigmaF: 0.4,
    delta: -0.25,
    dteAtEntry: 40,
    closedAt: null,
    outcome: null,
    terminalSpot: null,
    exitCredit: null,
    realizedPnl100: null,
    notes: null,
    ...over,
  };
}

describe('realizedPnl100', () => {
  it('expired OTM → keep the full credit', () => {
    expect(realizedPnl100(trade(), { outcome: 'expired_otm' })).toBe(400);
  });

  it('assigned → credit minus the ITM amount', () => {
    // S_T = 190, K = 200 → −10 intrinsic; credit 4 ⇒ −6/share ⇒ −600
    expect(realizedPnl100(trade(), { outcome: 'assigned', terminalSpot: 190 })).toBeCloseTo(-600, 6);
  });

  it('assigned at breakeven → ~zero', () => {
    expect(realizedPnl100(trade(), { outcome: 'assigned', terminalSpot: 196 })).toBeCloseTo(0, 6);
  });

  it('closed early → entry credit minus buy-back cost', () => {
    expect(realizedPnl100(trade(), { outcome: 'closed_early', exitCredit: 1.2 })).toBeCloseTo(280, 6);
  });

  it('uses the actual fill when recorded', () => {
    expect(realizedPnl100(trade({ actualFillCredit: 3.7 }), { outcome: 'expired_otm' })).toBe(370);
  });
});

describe('applyClose', () => {
  it('stamps the outcome and computes realized P&L', () => {
    const closed = applyClose(trade(), { outcome: 'assigned', terminalSpot: 188 }, '2026-10-16T20:00:00Z');
    expect(closed.outcome).toBe('assigned');
    expect(closed.realizedPnl100).toBeCloseTo(-800, 6);
    expect(closed.closedAt).toBe('2026-10-16T20:00:00Z');
  });
});

describe('calibrationReport', () => {
  it('is empty with no closed trades', () => {
    expect(calibrationReport([trade(), trade()])).toMatchObject({ n: 0, pop: null });
  });

  it('scores PoP: a well-calibrated 80% book that wins ~80%', () => {
    const trades: PaperTrade[] = [];
    for (let i = 0; i < 100; i++) {
      const win = i < 80;
      trades.push(
        applyClose(
          trade({ id: `t${i}`, modeledPop: 0.8 }),
          win ? { outcome: 'expired_otm' } : { outcome: 'assigned', terminalSpot: 150 },
          `2026-10-${String((i % 28) + 1).padStart(2, '0')}T20:00:00Z`,
        ),
      );
    }
    const r = calibrationReport(trades);
    expect(r.n).toBe(100);
    expect(r.pop!.realizedWinRate).toBeCloseTo(0.8, 6);
    expect(Math.abs(r.pop!.deltaPp)).toBeLessThan(1);
    expect(r.pop!.withinTarget).toBe(true);
    expect(r.pop!.buckets.find((b) => b.lo === 0.8)?.n).toBe(100);
  });

  it('flags an over-confident model (realized well below modeled PoP)', () => {
    const trades = Array.from({ length: 50 }, (_, i) =>
      applyClose(
        trade({ id: `t${i}`, modeledPop: 0.9 }),
        i < 30 ? { outcome: 'expired_otm' } : { outcome: 'assigned', terminalSpot: 150 },
        '2026-10-16T20:00:00Z',
      ),
    );
    const r = calibrationReport(trades);
    expect(r.pop!.realizedWinRate).toBeCloseTo(0.6, 6);
    expect(r.pop!.deltaPp).toBeLessThan(-25);
    expect(r.pop!.withinTarget).toBe(false);
  });

  it('measures credit bias from recorded fills', () => {
    const trades = [
      applyClose(trade({ id: 'a', entryCredit: 4, actualFillCredit: 3.6 }), { outcome: 'expired_otm' }, '2026-10-16T20:00:00Z'),
      applyClose(trade({ id: 'b', entryCredit: 2, actualFillCredit: 1.8 }), { outcome: 'expired_otm' }, '2026-10-16T20:00:00Z'),
    ];
    const r = calibrationReport(trades);
    expect(r.credit!.n).toBe(2);
    expect(r.credit!.medianBiasPct).toBeCloseTo(-10, 4); // filled ~10% below the mid model
    expect(r.credit!.withinTarget).toBe(true);
  });

  it('compares realized mean P&L to modeled EV', () => {
    const trades = [
      applyClose(trade({ id: 'a', modeledEv100: 100 }), { outcome: 'expired_otm' }, '2026-10-16T20:00:00Z'), // +400
      applyClose(trade({ id: 'b', modeledEv100: 100 }), { outcome: 'assigned', terminalSpot: 150 }, '2026-10-16T20:00:00Z'), // -4600
    ];
    const r = calibrationReport(trades);
    expect(r.ev!.meanModeled100).toBe(100);
    expect(r.ev!.meanRealized100).toBeCloseTo((400 - 4600) / 2, 6);
  });
});
