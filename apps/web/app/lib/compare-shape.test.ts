import { describe, expect, it } from 'vitest';
import type { ScreenedRow } from '@pss/screen';
import { bestInRow, COMPARE_METRICS, compareTable, compareToCsv } from './compare-shape';

function row(over: Partial<ScreenedRow>): ScreenedRow {
  return {
    occSymbol: 'X',
    symbol: 'X',
    expiration: '2026-10-17',
    strike: 100,
    multiplier: 100,
    dte: 30,
    delta: -0.25,
    score: 0,
    evToMaxloss: 0,
    displayAnnRoc: 0,
    decayYield: 0,
    entryCredit: 1,
    iv: 0.3,
    ivRank: 50,
    putSkew25d: 0.02,
    ivVsFitted: 0,
    pop: 0.7,
    probItm: 0.25,
    spreadPct: 0.03,
    breakeven: 99,
    openInterest: 1000,
    ...over,
  } as ScreenedRow;
}

const metric = (key: string) => COMPARE_METRICS.find((m) => m.key === key)!;

describe('bestInRow', () => {
  it('picks the max when higherBetter', () => {
    const rows = [
      row({ occSymbol: 'A', score: 1 }),
      row({ occSymbol: 'B', score: 3 }),
      row({ occSymbol: 'C', score: 2 }),
    ];
    expect(bestInRow(rows, metric('score'))).toEqual(new Set(['B']));
  });

  it('picks the min when lower is better', () => {
    const rows = [
      row({ occSymbol: 'A', probItm: 0.4 }),
      row({ occSymbol: 'B', probItm: 0.1 }),
    ];
    expect(bestInRow(rows, metric('probItm'))).toEqual(new Set(['B']));
  });

  it('delta rule picks the |Δ| closest to 0.25', () => {
    const rows = [
      row({ occSymbol: 'A', delta: -0.1 }),
      row({ occSymbol: 'B', delta: -0.27 }),
      row({ occSymbol: 'C', delta: -0.5 }),
    ];
    expect(bestInRow(rows, metric('delta'))).toEqual(new Set(['B']));
  });

  it('ties all win; all-null highlights nothing', () => {
    const rows = [row({ occSymbol: 'A', score: 2 }), row({ occSymbol: 'B', score: 2 })];
    expect(bestInRow(rows, metric('score'))).toEqual(new Set(['A', 'B']));
    const nulls = [row({ occSymbol: 'A', ivRank: null }), row({ occSymbol: 'B', ivRank: null })];
    expect(bestInRow(nulls, metric('ivRank')).size).toBe(0);
  });

  it('dte is not ranked', () => {
    const rows = [row({ occSymbol: 'A', dte: 20 }), row({ occSymbol: 'B', dte: 40 })];
    expect(bestInRow(rows, metric('dte')).size).toBe(0);
  });
});

describe('compareTable', () => {
  it('produces metric rows × contract columns with best flags', () => {
    const rows = [
      row({ occSymbol: 'A', symbol: 'AAA', score: 1 }),
      row({ occSymbol: 'B', symbol: 'BBB', score: 5 }),
    ];
    const t = compareTable(rows);
    expect(t.contracts.map((c) => c.occSymbol)).toEqual(['A', 'B']);
    const scoreRow = t.rows.find((r) => r.key === 'score')!;
    expect(scoreRow.cells.map((c) => c.best)).toEqual([false, true]);
    expect(scoreRow.higherBetter).toBe(true);
  });
});

describe('compareToCsv', () => {
  it('is transposed: metric column then one column per contract', () => {
    const csv = compareToCsv([
      row({ occSymbol: 'A ', symbol: 'AAA', score: 1 }),
      row({ occSymbol: 'B', symbol: 'BBB', score: 2 }),
    ]);
    const lines = csv.trimEnd().split('\n');
    expect(lines[0]).toBe('metric,A,B');
    expect(lines[1]).toBe('ticker,AAA,BBB');
    expect(lines.some((l) => l.startsWith('Composite score,1,2'))).toBe(true);
  });
});
