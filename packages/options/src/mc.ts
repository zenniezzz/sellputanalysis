/**
 * Deterministic Monte-Carlo reference for the EV closed form (plan §5.9).
 * Test/validation helper — not used in the production ranking path.
 */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard-normal sampler via Box–Muller, seeded and deterministic. */
export function stdNormalSampler(seed: number): () => number {
  const rng = mulberry32(seed);
  let spare: number | null = null;
  return () => {
    if (spare !== null) {
      const v = spare;
      spare = null;
      return v;
    }
    let u1 = rng();
    const u2 = rng();
    if (u1 < 1e-300) u1 = 1e-300;
    const mag = Math.sqrt(-2 * Math.log(u1));
    spare = mag * Math.sin(2 * Math.PI * u2);
    return mag * Math.cos(2 * Math.PI * u2);
  };
}

export interface McEvParams {
  sAdj: number;
  k: number;
  entryCredit: number;
  mu: number;
  sigmaF: number;
  t: number;
  paths?: number;
  seed?: number;
}

/** Mean and standard error of the short-put payoff min(C, S_T − B) under the forecast lognormal. */
export function mcEvPerShare(p: McEvParams): { mean: number; stderr: number } {
  const paths = p.paths ?? 200_000;
  const z = stdNormalSampler(p.seed ?? 12345);
  const drift = (p.mu - 0.5 * p.sigmaF * p.sigmaF) * p.t;
  const vol = p.sigmaF * Math.sqrt(p.t);
  const b = p.k - p.entryCredit;

  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < paths; i++) {
    const sT = p.sAdj * Math.exp(drift + vol * z());
    const payoff = Math.min(p.entryCredit, sT - b);
    sum += payoff;
    sumSq += payoff * payoff;
  }
  const mean = sum / paths;
  const variance = Math.max(sumSq / paths - mean * mean, 0);
  return { mean, stderr: Math.sqrt(variance / paths) };
}
