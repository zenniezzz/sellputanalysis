import { describe, expect, it } from 'vitest';
import {
  computeScores,
  SCORE_METRICS,
  SCORE_PRESETS,
  scoreColorPosition,
  scoreOutOf10,
  type ReferenceStats,
  type ScoreInputRow,
} from './score.js';

const CLEAN: ScoreCaution = { borrow: false, dividend: false, earningsBeforeExpiry: false, ivRankProxy: false };
type ScoreCaution = ScoreInputRow['caution'];

function row(over: Partial<ScoreInputRow> = {}): ScoreInputRow {
  return {
    priced: true,
    isCandidate: true,
    // evToMaxloss/ivRank/spreadPct are still real ScoreInputRow fields (kept
    // so run.ts's row construction didn't need to change) but no longer feed
    // the score at all -- these three placeholder values are never read by
    // computeScores; see the "no longer scores on ..." test below.
    evToMaxloss: 0.006,
    annRoc: 0.18,
    ivVsFitted: 0.0,
    ivRank: 45,
    spreadPct: 0.05,
    delta: -0.15, // at the deltaFromCenter target, so this metric contributes ~0 by default
    caution: CLEAN,
    ...over,
  };
}

describe('computeScores', () => {
  it('ranks a better candidate above a worse one (cross-sectional)', () => {
    const rows = [
      row({ annRoc: 0.3, ivVsFitted: 0.03 }),
      row({ annRoc: 0.05, ivVsFitted: -0.02 }),
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
    const rows = [row({ annRoc: 0.3 }), row({ annRoc: 0.05 }), row()];
    // one metric partway into the reference window, the rest still cross-sectional
    const young: ReferenceStats = { annRoc: { mean: 0.18, stddev: 0.06, nDays: 100 } };
    const mid: ReferenceStats = {
      annRoc: { mean: 0.18, stddev: 0.06, nDays: 150 },
      ivVsFitted: { mean: 0, stddev: 0.02, nDays: 150 },
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

  it('rewards |Δ| closest to 0.15 (the low end of the default band), not 0.25', () => {
    const atLowEnd = row({ delta: -0.15 });
    const atOldCenter = row({ delta: -0.25 }); // used to be the target pre-change
    const atHighEnd = row({ delta: -0.35 });
    const { rows: scored } = computeScores([atLowEnd, atOldCenter, atHighEnd], {});
    expect(scored[0]!.score!).toBeGreaterThan(scored[1]!.score!);
    expect(scored[1]!.score!).toBeGreaterThan(scored[2]!.score!);
  });

  it('scores on only three inputs now: annRoc, ivVsFitted, deltaFromCenter', () => {
    expect(SCORE_METRICS).toEqual(['annRoc', 'ivVsFitted', 'deltaFromCenter']);
    for (const preset of Object.values(SCORE_PRESETS)) {
      expect(preset.weights).not.toHaveProperty('evToMaxloss');
      expect(preset.weights).not.toHaveProperty('spreadPct');
      expect(preset.weights).not.toHaveProperty('ivRank');
    }
    // two rows identical except evToMaxloss/spreadPct/ivRank must score identically now
    const a = row({ evToMaxloss: 0.02, spreadPct: 0.02, ivRank: 90 });
    const b = row({ evToMaxloss: 0.001, spreadPct: 0.2, ivRank: 5 });
    const { rows: scored } = computeScores([a, b], {});
    expect(scored[0]!.score).toBe(scored[1]!.score);
  });

  it('balanced weights the three remaining inputs equally (1/3 each, signed for direction)', () => {
    const w = SCORE_PRESETS.balanced.weights;
    expect(w.annRoc).toBeCloseTo(1 / 3, 10);
    expect(w.ivVsFitted).toBeCloseTo(1 / 3, 10);
    expect(w.deltaFromCenter).toBeCloseTo(-1 / 3, 10);
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

describe('scoreOutOf10', () => {
  it('maps the same fixed [−2, +3] domain onto 0..10, agreeing with scoreColorPosition', () => {
    expect(scoreOutOf10(-2)).toBe(0);
    expect(scoreOutOf10(3)).toBe(10);
    expect(scoreOutOf10(0.5)).toBeCloseTo(5, 6);
    expect(scoreOutOf10(-5)).toBe(0); // clamped, same as scoreColorPosition
    expect(scoreOutOf10(8)).toBe(10); // clamped
    expect(scoreOutOf10(null)).toBeNull();
  });

  it('is a monotonic rescale — preserves ranking order', () => {
    const scores = [-1.8, -0.4, 0, 0.9, 2.1, 2.9];
    const rescaled = scores.map(scoreOutOf10);
    for (let i = 1; i < rescaled.length; i++) {
      expect(rescaled[i]!).toBeGreaterThan(rescaled[i - 1]!);
    }
  });
});
