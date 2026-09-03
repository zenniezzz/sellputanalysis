import { describe, expect, it } from 'vitest';
import type { SnapshotRow } from '@pss/pipeline';
import { bestInRow, compareToCsv, transposeContracts, DEFAULT_COMPARE_METRICS } from './compare.js';
import { mkRow } from './testkit.js';

const A = mkRow({
  occSymbol: 'AAA   261016P00095000',
  symbol: 'AAA',
  strike: 95,
  score: 0.9,
  evToMaxloss: 0.004,
  annRoc: 0.25,
  decayYield: 0.03,
  ivRank: 60,
  ivVsFitted: 0.02,
  delta: -0.25,
  pop: 0.82,
  probItm: 0.18,
  spreadPct: 0.03,
  entryCredit: 2.1,
  openInterest: 8000,
  modelCaution: { borrow: true },
});

const B = mkRow({
  occSymbol: 'BBB   261016P00230000',
  symbol: 'BBB',
  strike: 230,
  score: 0.4,
  evToMaxloss: 0.001,
  annRoc: 0.31,
  decayYield: 0.02,
  ivRank: 55,
  ivVsFitted: -0.01,
  delta: -0.34,
  pop: 0.7,
  probItm: 0.3,
  spreadPct: 0.06,
  entryCredit: 1.4,
  openInterest: 3000,
});

const C = mkRow({
  occSymbol: 'CCC   261016P00038000',
  symbol: 'CCC',
  strike: 38,
  score: 0.4,
  evToMaxloss: 0.002,
  annRoc: 0.19,
  decayYield: 0.025,
  ivRank: null,
  ivVsFitted: 0.005,
  delta: -0.12,
  pop: 0.75,
  probItm: 0.25,
  spreadPct: 0.08,
  entryCredit: 0.9,
  openInterest: 5000,
});

describe('transposeContracts', () => {
  it('produces one row per metric and one column per contract', () => {
    const table = transposeContracts([A, B, C]);
    expect(table.contracts.map((c) => c.occSymbol)).toEqual([A.occSymbol, B.occSymbol, C.occSymbol]);
    expect(table.rows.length).toBe(DEFAULT_COMPARE_METRICS.length);
    for (const row of table.rows) expect(row.values.length).toBe(3);
  });

  it('honours a metric subset and its order', () => {
    const table = transposeContracts([A, B], ['annRoc', 'score']);
    expect(table.rows.map((r) => r.key)).toEqual(['annRoc', 'score']);
  });

  it('prefers ScreenedRow.displayAnnRoc over annRoc when present', () => {
    const screened: SnapshotRow & { displayAnnRoc: number | null } = { ...A, displayAnnRoc: 0.5 };
    const screenedB: SnapshotRow & { displayAnnRoc: number | null } = { ...B, displayAnnRoc: null };
    const table = transposeContracts([screened, screenedB]);
    const annRow = table.rows.find((r) => r.key === 'annRoc')!;
    expect(annRow.values).toEqual([0.5, B.annRoc]);
  });

  it('joins the model_caution flags into a string', () => {
    const table = transposeContracts([A, B]);
    const flags = table.rows.find((r) => r.key === 'flags')!;
    expect(flags.values).toEqual(['borrow', '']);
  });
});

describe('bestInRow', () => {
  it('is direction-aware and ignores non-directional / tied rows', () => {
    const table = transposeContracts([A, B, C]);
    const best = bestInRow(table);

    expect(best.get('score')).toBe(A.occSymbol); // higher-is-better
    expect(best.get('annRoc')).toBe(B.occSymbol); // B has the highest ROC
    expect(best.get('spreadPct')).toBe(A.occSymbol); // lower-is-better
    expect(best.get('ivRank')).toBe(A.occSymbol); // C is null, A > B
    expect(best.get('delta')).toBe(A.occSymbol); // |Δ|−0.25 distance smallest for A (exactly 0)
    expect(best.has('iv')).toBe(false); // non-directional
    expect(best.has('breakeven')).toBe(false);
  });

  it('records no winner on a tie', () => {
    const t1 = mkRow({ occSymbol: 'T1', score: 0.5 });
    const t2 = mkRow({ occSymbol: 'T2', score: 0.5 });
    const best = bestInRow(transposeContracts([t1, t2], ['score']));
    expect(best.has('score')).toBe(false);
  });
});

describe('compareToCsv', () => {
  it('emits a transposed grid: metric column then one column per contract', () => {
    const csv = compareToCsv(transposeContracts([A, B], ['score', 'flags']));
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('metric,AAA   261016P00095000,BBB   261016P00230000');
    expect(lines[1]).toBe('Composite score,0.9,0.4');
    expect(lines[2]).toBe('Model caution,borrow,');
  });
});
