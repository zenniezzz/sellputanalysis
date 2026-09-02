import { describe, expect, it } from 'vitest';
import {
  computeScores,
  SCORE_PRESETS,
  scoreColorPosition,
  type ReferenceStats,
  type ScoreInputRow,
} from './score.js';

const CLEAN: ScoreCaution = { borrow: false, dividend: false, earningsBeforeExpiry: false, ivRankProxy: false };
type ScoreCaution = ScoreInputRow['caution'];

function row(over: Partial<ScoreInputRow> = {}): ScoreInputRow {
  return {
    priced: true,
    isCandidate: true,
    evToMaxloss: 0.006,
    annRoc: 0.18,
    ivVsFitted: 0.0,
    ivRank: 45,
    spreadPct: 0.05,
    delta: -0.25,
    caution: CLEAN,
    ...over,
  };
}

describe('computeScores', () => {
  it('ranks a better candidate above a worse one (cross-sectional)', () => {
    const rows = [
      row({ evToMaxloss: 0.012, annRoc: 0.3, ivVsFitted: 0.03, ivRank: 70, spreadPct: 0.03 }),
      row({ evToMaxloss: 0.001, annRoc: 0.05, ivVsFitted: -0.02, ivRank: 15, spreadPct: 0.12 }),
      row(),
    ];
    const { rows: scored, basis } = computeScores(rows, {});
    expect(basis).toBe('cross_sectional');
    expect(scored[0]!.score!).toBeGreaterThan(scored[2]!.score!);
    expect(scored[2]!.score!).toBeGreaterThan(scored[1]!.score!);
  });

  it('leaves unpriced rows null', () => {
    const { rows: scored } = computeScores([row({ priced: false }), row()], {});
    expect(scored[0]).toEqual({ score: null, components: null });
    expect(scored[1]!.score).not.toBeNull();
  });

  it('drops a null positive metric and still scores (renormalized)', () => {
    const withResidual = computeScores([row({ ivVsFitted: 0.02 }), row({ ivVsFitted: -0.02 }), row()], {});
    const withoutResidual = computeScores(
      [row({ ivVsFitted: null }), row({ ivVsFitted: null }), row({ ivVsFitted: null })],
      {},
    );
    for (const s of withoutResidual.rows) {
      expect(s.score).not.toBeNull();
      expect(s.components).not.toHaveProperty('ivVsFitted');
    }
    expect(withResidual.rows[0]!.score).not.toBeNull();
  });

  it('applies fixed penalties', () => {
    const base = computeScores([row(), row(), row()], {}).rows[0]!.score!;
    const penalized = computeScores(
      [row({ caution: { ...CLEAN, earningsBeforeExpiry: true } }), row(), row()],
      {},
    ).rows[0]!;
    expect(penalized.components!['penalty']).toBe(-SCORE_PRESETS.balanced.penalties.earningsBeforeExpiry);
    expect(penalized.score!).toBeCloseTo(base - SCORE_PRESETS.balanced.penalties.earningsBeforeExpiry, 6);
  });

  it('basis transitions cross_sectional → blended → reference with history depth', () => {
    const rows = [row({ evToMaxloss: 0.01 }), row({ evToMaxloss: 0.002 }), row()];
    // one metric partway into the reference window, the rest still cross-sectional
    const young: ReferenceStats = { evToMaxloss: { mean: 0.005, stddev: 0.003, nDays: 100 } };
    const mid: ReferenceStats = {
      evToMaxloss: { mean: 0.005, stddev: 0.003, nDays: 150 },
      annRoc: { mean: 0.18, stddev: 0.06, nDays: 150 },
      ivVsFitted: { mean: 0, stddev: 0.02, nDays: 150 },
      ivRank: { mean: 45, stddev: 20, nDays: 150 },
      spreadPct: { mean: 0.05, stddev: 0.02, nDays: 150 },
      deltaFromCenter: { mean: 0.05, stddev: 0.03, nDays: 150 },
    };
    const full = Object.fromEntries(
      Object.entries(mid).map(([k, v]) => [k, { ...v, nDays: 400 }]),
    ) as ReferenceStats;

    expect(computeScores(rows, young).basis).toBe('blended'); // one metric young, rest cross-sectional
    expect(computeScores(rows, mid).basis).toBe('blended');
    expect(computeScores(rows, full).basis).toBe('reference');
    expect(computeScores(rows, {}).basis).toBe('cross_sectional');
  });

  it('emits candidate metric samples for the reference store', () => {
    const { metricSamples } = computeScores(
      [row({ isCandidate: true, annRoc: 0.2 }), row({ isCandidate: false, annRoc: 0.9 }), row({ isCandidate: true, annRoc: 0.1 })],
      {},
    );
    expect(metricSamples.annRoc).toEqual([0.2, 0.1]);
  });
});

describe('scoreColorPosition', () => {
  it('maps the fixed [−2, +3] domain to [0, 1] with clamping', () => {
    expect(scoreColorPosition(-2)).toBe(0);
    expect(scoreColorPosition(3)).toBe(1);
    expect(scoreColorPosition(0.5)).toBeCloseTo(0.5, 6);
    expect(scoreColorPosition(-5)).toBe(0);
    expect(scoreColorPosition(null)).toBeNull();
  });
});
