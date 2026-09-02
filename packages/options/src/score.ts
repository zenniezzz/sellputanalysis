/**
 * Composite candidate score (plan §6.2, §6.3).
 *
 * A weighted sum of z-scores. Each z is blended between a **fixed reference
 * distribution** (rolling ~1 year, so the score is stable across filter changes)
 * and the **current snapshot's cross-section** (robust: median / MAD) while that
 * reference is still accruing:
 *
 *   z_i(row) = α_i · z_ref_i + (1 − α_i) · z_crosssec_i
 *   α_i = clamp((nDays_i − minReferenceDays) / (fullReferenceDays − minReferenceDays), 0, 1)
 *
 * NULL handling: a null positive-weight metric is dropped and the remaining
 * positive weights are renormalized to the original positive total. If the row
 * was never priced (`iv == null`) the score is null.
 *
 * Penalties are fixed (not z-scored) and subtracted after the weighted sum.
 */

export type ScoreMetric =
  | 'evToMaxloss'
  | 'annRoc'
  | 'ivVsFitted'
  | 'ivRank'
  | 'spreadPct'
  | 'deltaFromCenter';

export const SCORE_METRICS: ScoreMetric[] = [
  'evToMaxloss',
  'annRoc',
  'ivVsFitted',
  'ivRank',
  'spreadPct',
  'deltaFromCenter',
];

export interface ScoreCaution {
  borrow: boolean;
  dividend: boolean;
  earningsBeforeExpiry: boolean;
  ivRankProxy: boolean;
}

export interface ScoreInputRow {
  priced: boolean;
  isCandidate: boolean;
  evToMaxloss: number | null;
  annRoc: number | null;
  ivVsFitted: number | null;
  ivRank: number | null;
  spreadPct: number;
  delta: number | null;
  caution: ScoreCaution;
}

export interface MetricStats {
  mean: number;
  stddev: number;
  nDays: number;
}

export type ReferenceStats = Partial<Record<ScoreMetric, MetricStats>>;

export interface ScoreConfig {
  weights: Record<ScoreMetric, number>;
  penalties: { borrow: number; dividend: number; earningsBeforeExpiry: number; ivRankProxy: number };
  minReferenceDays: number;
  fullReferenceDays: number;
  /** z clamp to tame outliers. */
  zClamp: number;
}

const BALANCED: ScoreConfig = {
  weights: {
    evToMaxloss: 0.28,
    annRoc: 0.22,
    ivVsFitted: 0.16,
    ivRank: 0.14,
    spreadPct: -0.1,
    deltaFromCenter: -0.1,
  },
  penalties: { borrow: 0.5, dividend: 0.5, earningsBeforeExpiry: 1.0, ivRankProxy: 0.75 },
  minReferenceDays: 60,
  fullReferenceDays: 252,
  zClamp: 4,
};

export const SCORE_PRESETS: Record<'conservative' | 'balanced' | 'aggressive', ScoreConfig> = {
  balanced: BALANCED,
  conservative: {
    ...BALANCED,
    weights: {
      evToMaxloss: 0.2,
      annRoc: 0.16,
      ivVsFitted: 0.22,
      ivRank: 0.22,
      spreadPct: -0.12,
      deltaFromCenter: -0.18,
    },
    penalties: { borrow: 0.75, dividend: 0.75, earningsBeforeExpiry: 1.5, ivRankProxy: 1.1 },
  },
  aggressive: {
    ...BALANCED,
    weights: {
      evToMaxloss: 0.34,
      annRoc: 0.28,
      ivVsFitted: 0.12,
      ivRank: 0.06,
      spreadPct: -0.08,
      deltaFromCenter: -0.06,
    },
    penalties: { borrow: 0.25, dividend: 0.25, earningsBeforeExpiry: 0.75, ivRankProxy: 0.4 },
  },
};

export interface ScoredRow {
  score: number | null;
  components: Record<string, number> | null;
}

export interface ComputeScoresResult {
  rows: ScoredRow[];
  basis: 'cross_sectional' | 'blended' | 'reference';
  /** Candidate metric values, for appending to the reference store. */
  metricSamples: Partial<Record<ScoreMetric, number[]>>;
}

function metricValue(row: ScoreInputRow, m: ScoreMetric): number | null {
  switch (m) {
    case 'evToMaxloss':
      return row.evToMaxloss;
    case 'annRoc':
      return row.annRoc;
    case 'ivVsFitted':
      return row.ivVsFitted;
    case 'ivRank':
      return row.ivRank;
    case 'spreadPct':
      return row.spreadPct;
    case 'deltaFromCenter':
      return row.delta == null ? null : Math.abs(Math.abs(row.delta) - 0.25);
  }
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function robustSpread(xs: number[]): number {
  if (xs.length < 2) return 0;
  const med = median(xs);
  const mad = median(xs.map((x) => Math.abs(x - med)));
  if (mad > 0) return 1.4826 * mad;
  // MAD collapses on discrete data — fall back to sample stddev
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1));
}

interface MetricModel {
  alpha: number;
  refMean: number;
  refStd: number;
  crossMed: number;
  crossStd: number;
  usable: boolean;
}

export function computeScores(
  rows: ScoreInputRow[],
  reference: ReferenceStats,
  config: ScoreConfig = SCORE_PRESETS.balanced,
): ComputeScoresResult {
  const priced = rows.filter((r) => r.priced);
  const models = new Map<ScoreMetric, MetricModel>();
  const metricSamples: Partial<Record<ScoreMetric, number[]>> = {};

  for (const m of SCORE_METRICS) {
    const crossValues = priced.map((r) => metricValue(r, m)).filter((v): v is number => v != null);
    const crossMed = crossValues.length ? median(crossValues) : 0;
    const crossStd = robustSpread(crossValues);

    const ref = reference[m];
    let alpha = 0;
    if (ref && ref.stddev > 0) {
      alpha = Math.max(0, Math.min(1, (ref.nDays - config.minReferenceDays) / (config.fullReferenceDays - config.minReferenceDays)));
    }
    const crossOk = crossStd > 0 && crossValues.length >= 2;
    const usable = alpha > 0 || crossOk;

    models.set(m, {
      alpha: crossOk ? alpha : 1, // no cross-section ⇒ lean entirely on reference
      refMean: ref?.mean ?? 0,
      refStd: ref?.stddev ?? 1,
      crossMed,
      crossStd: crossOk ? crossStd : 1,
      usable,
    });

    metricSamples[m] = rows
      .filter((r) => r.isCandidate)
      .map((r) => metricValue(r, m))
      .filter((v): v is number => v != null);
  }

  const positiveTotal = SCORE_METRICS.filter((m) => config.weights[m] > 0).reduce(
    (a, m) => a + config.weights[m],
    0,
  );

  const scored: ScoredRow[] = rows.map((row) => {
    if (!row.priced) return { score: null, components: null };

    const components: Record<string, number> = {};
    let usedPositive = 0;
    let weightedSum = 0;

    for (const m of SCORE_METRICS) {
      const model = models.get(m)!;
      const w = config.weights[m];
      if (w === 0 || !model.usable) continue;
      const v = metricValue(row, m);
      if (v == null) continue; // null positive/negative term dropped
      const zRef = (v - model.refMean) / model.refStd;
      const zCross = (v - model.crossMed) / model.crossStd;
      let z = model.alpha * zRef + (1 - model.alpha) * zCross;
      z = Math.max(-config.zClamp, Math.min(config.zClamp, z));
      const contrib = w * z;
      components[m] = contrib;
      weightedSum += contrib;
      if (w > 0) usedPositive += w;
    }

    // renormalize the positive side to the original positive total
    if (usedPositive > 0 && usedPositive < positiveTotal) {
      const scale = positiveTotal / usedPositive;
      for (const m of SCORE_METRICS) {
        if (config.weights[m] > 0 && components[m] != null) {
          weightedSum += components[m]! * (scale - 1);
          components[m]! *= scale;
        }
      }
    }

    const penalty =
      (row.caution.borrow ? config.penalties.borrow : 0) +
      (row.caution.dividend ? config.penalties.dividend : 0) +
      (row.caution.earningsBeforeExpiry ? config.penalties.earningsBeforeExpiry : 0) +
      (row.caution.ivRankProxy ? config.penalties.ivRankProxy : 0);
    components['penalty'] = -penalty;

    return { score: weightedSum - penalty, components };
  });

  const usedAlphas = SCORE_METRICS.filter((m) => config.weights[m] !== 0 && models.get(m)!.usable).map(
    (m) => models.get(m)!.alpha,
  );
  const basis: ComputeScoresResult['basis'] =
    usedAlphas.length === 0 || usedAlphas.every((a) => a <= 0.001)
      ? 'cross_sectional'
      : usedAlphas.every((a) => a >= 0.999)
        ? 'reference'
        : 'blended';

  return { rows: scored, basis, metricSamples };
}

/** Map a composite score to a 0..1 colour position over the fixed [−2, +3] domain (plan §6.2). */
export function scoreColorPosition(score: number | null): number | null {
  if (score == null) return null;
  return Math.max(0, Math.min(1, (score - -2) / (3 - -2)));
}
