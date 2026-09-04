/**
 * Calibration harness (plan §1.2, §6.5). Scores the model's PoP, credit and EV
 * against realized outcomes on closed paper trades.
 */

import type { PaperTrade } from './trade.js';

export interface PopBucket {
  /** modeled-PoP band, e.g. [0.7, 0.8). */
  lo: number;
  hi: number;
  n: number;
  meanModeledPop: number;
  realizedWinRate: number;
  /** realizedWinRate − meanModeledPop, in percentage points. */
  deltaPp: number;
}

export interface CalibrationReport {
  n: number;
  dateRange: { from: string; to: string } | null;
  /** realized win rate vs mean modeled PoP across all closed trades. */
  pop: {
    meanModeledPop: number;
    realizedWinRate: number;
    deltaPp: number;
    /** binomial 95% half-width on the realized rate. */
    ciPp: number;
    withinTarget: boolean; // |delta| ≤ 5pp
    buckets: PopBucket[];
  } | null;
  /** median (actual fill − modeled) / modeled, over trades with a recorded fill. */
  credit: {
    n: number;
    medianBiasPct: number;
    withinTarget: boolean; // |bias| ≤ 15%
  } | null;
  /** realized mean P&L/contract vs mean modeled EV/contract. */
  ev: {
    meanRealized100: number;
    meanModeled100: number;
    ratio: number | null;
  } | null;
}

const won = (t: PaperTrade): boolean => (t.realizedPnl100 ?? 0) > 0;
const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length === 0 ? NaN : s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

export function calibrationReport(trades: PaperTrade[]): CalibrationReport {
  const closed = trades.filter((t) => t.outcome != null && t.realizedPnl100 != null);
  if (closed.length === 0) {
    return { n: 0, dateRange: null, pop: null, credit: null, ev: null };
  }

  const dates = closed.map((t) => t.closedAt!).sort();
  const dateRange = { from: dates[0]!.slice(0, 10), to: dates[dates.length - 1]!.slice(0, 10) };

  // --- PoP calibration ---
  const withPop = closed.filter((t) => t.modeledPop != null);
  let pop: CalibrationReport['pop'] = null;
  if (withPop.length > 0) {
    const meanModeledPop = mean(withPop.map((t) => t.modeledPop!));
    const realizedWinRate = withPop.filter(won).length / withPop.length;
    const deltaPp = (realizedWinRate - meanModeledPop) * 100;
    const p = realizedWinRate;
    const ciPp = 1.96 * Math.sqrt((p * (1 - p)) / withPop.length) * 100;

    const buckets: PopBucket[] = [];
    for (let i = 5; i < 10; i++) {
      const lo = i / 10;
      const hi = (i + 1) / 10;
      const inB = withPop.filter((t) => t.modeledPop! >= lo && (i === 9 ? t.modeledPop! <= hi : t.modeledPop! < hi));
      if (inB.length === 0) continue;
      const mm = mean(inB.map((t) => t.modeledPop!));
      const wr = inB.filter(won).length / inB.length;
      buckets.push({ lo, hi, n: inB.length, meanModeledPop: mm, realizedWinRate: wr, deltaPp: (wr - mm) * 100 });
    }

    pop = {
      meanModeledPop,
      realizedWinRate,
      deltaPp,
      ciPp,
      withinTarget: Math.abs(deltaPp) <= 5,
      buckets,
    };
  }

  // --- credit bias ---
  const withFill = closed.filter((t) => t.actualFillCredit != null && t.entryCredit > 0);
  const credit =
    withFill.length > 0
      ? (() => {
          const bias = withFill.map((t) => (t.actualFillCredit! - t.entryCredit) / t.entryCredit);
          const m = median(bias);
          return { n: withFill.length, medianBiasPct: m * 100, withinTarget: Math.abs(m) <= 0.15 };
        })()
      : null;

  // --- EV realized vs predicted ---
  const withEv = closed.filter((t) => t.modeledEv100 != null);
  const ev =
    withEv.length > 0
      ? (() => {
          const realized = mean(withEv.map((t) => t.realizedPnl100! / t.contracts));
          const modeled = mean(withEv.map((t) => t.modeledEv100!));
          return { meanRealized100: realized, meanModeled100: modeled, ratio: modeled !== 0 ? realized / modeled : null };
        })()
      : null;

  return { n: closed.length, dateRange, pop, credit, ev };
}
