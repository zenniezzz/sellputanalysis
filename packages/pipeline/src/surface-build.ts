/**
 * Stage F for one underlying (plan §5.6, §5.5): fit a smile per expiration,
 * derive σ30 (constant-maturity ATM vol), leave-one-out residuals, put skew, and
 * IV rank / percentile from the accrued history.
 */

import {
  constantMaturityIv,
  fitSmile,
  impliedVol,
  ivRankFromHistory,
  leaveOneOutResiduals,
  putSkew25Delta,
  smileIvAt,
  type IvHistoryPoint,
  type QuadFit,
  type SmilePoint,
} from '@pss/options';
import type { OptionQuote } from '@pss/market-data';

export interface ExpirationSurface {
  fit: QuadFit | null;
  atmIv: number;
  putSkew25d: number | null;
  /** strike → (our IV − smile fit excluding that strike). */
  residualByStrike: Map<number, number>;
}

export interface NameSurface {
  sigma30: number;
  ivRank: number | null;
  ivPctile: number | null;
  ivRankIsProxy: boolean;
  byExpiration: Map<string, ExpirationSurface>;
}

export interface SurfaceBuildInput {
  spot: number;
  spotAdj: number;
  q: number;
  hv20: number | null;
  /** expiration → { quotes, t, rate }. */
  expirations: Map<string, { quotes: OptionQuote[]; t: number; rate: number }>;
  history: IvHistoryPoint[];
  /** log-moneyness half-width for the smile fit. */
  smileHalfWidth?: number;
}

export function buildNameSurface(input: SurfaceBuildInput): NameSurface {
  const halfWidth = input.smileHalfWidth ?? 0.45;
  const byExpiration = new Map<string, ExpirationSurface>();
  const atmVars: { t: number; atmIv: number }[] = [];

  for (const [exp, { quotes, t, rate }] of input.expirations) {
    const points: (SmilePoint & { strike: number })[] = [];
    for (const o of quotes) {
      const x = Math.log(o.strike / input.spot);
      if (Math.abs(x) > halfWidth) continue;
      const mid = (o.bid + o.ask) / 2;
      if (o.bid <= 0 || o.ask < o.bid || mid < 0.05) continue;
      const iv = impliedVol(
        mid,
        { s: input.spotAdj, k: o.strike, r: rate, q: input.q, t },
        o.right === 'P' ? 'put' : 'call',
      );
      if (iv.ok) points.push({ x, iv: iv.iv, strike: o.strike });
    }

    const fit = fitSmile(points);
    const atmIv = fit
      ? smileIvAt(fit, 0)
      : points.sort((a, b) => Math.abs(a.x) - Math.abs(b.x))[0]?.iv ?? input.hv20 ?? 0.3;
    atmVars.push({ t, atmIv });

    const residualByStrike = new Map<number, number>();
    if (fit && points.length >= 6) {
      const loo = leaveOneOutResiduals(points);
      points.forEach((p, i) => {
        const r = loo[i];
        if (r != null) residualByStrike.set(p.strike, r);
      });
    }

    byExpiration.set(exp, { fit, atmIv, putSkew25d: null, residualByStrike });
  }

  const sigma30 = constantMaturityIv(atmVars) ?? input.hv20 ?? 0.3;

  // put skew now that σ30 is known
  for (const [exp, surf] of byExpiration) {
    const meta = input.expirations.get(exp)!;
    if (surf.fit) {
      surf.putSkew25d = putSkew25Delta(surf.fit, surf.atmIv, sigma30, meta.rate, input.q, meta.t);
    }
  }

  const rank = ivRankFromHistory({ atmIv30d: sigma30, hv20: input.hv20 }, input.history);

  return {
    sigma30,
    ivRank: rank.ivRank,
    ivPctile: rank.ivPctile,
    ivRankIsProxy: rank.basis !== 'own',
    byExpiration,
  };
}
