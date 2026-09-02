/**
 * Real-world expected value of selling a put and holding to expiry (plan §5.7).
 *
 * Under the risk-neutral measure EV ≈ 0 net of costs, so ranking on it is
 * pointless. The edge, when present, is the variance risk premium: implied vol
 * tends to exceed subsequently realized vol. EV is therefore computed under an
 * explicit forecast distribution — lognormal with drift `mu` (= r − q) and
 * volatility `sigmaF` (a haircut blend of realized and implied; see
 * `forecastVol`). Reported undiscounted (expected P&L in dollars at expiry).
 *
 *   payoff/share at expiry = min(entryCredit, S_T − B),  B = K − entryCredit
 *                          = entryCredit − max(K − S_T, 0)
 *   E_forecast[max(K − S_T, 0)] = K·N(−d2f) − S_adj·e^(μT)·N(−d1f)   (undiscounted)
 */

import { normalCdf } from './normal.js';

export interface ForecastVolInputs {
  hv20: number | null;
  hv252: number | null;
  /** 30-day ATM implied vol. */
  sigma30: number;
  /** Trailing 1-year median of sigma30, for shrinkage. `null` skips shrinkage. */
  sigma30Median?: number | null;
  weights?: { hv20: number; hv252: number; iv: number };
  /** Shrinkage intensity toward the median (0..1). */
  lambda?: number;
  /** Implied-over-realized haircut (§5.7 default 0.90). */
  vrpHaircut?: number;
}

/** Blend → shrink → haircut. Missing HV inputs are dropped and the weights renormalized. */
export function forecastVol(inp: ForecastVolInputs): number {
  const w = inp.weights ?? { hv20: 0.35, hv252: 0.25, iv: 0.4 };
  const lambda = inp.lambda ?? 0.35;
  const haircut = inp.vrpHaircut ?? 0.9;

  let num = w.iv * inp.sigma30;
  let den = w.iv;
  if (inp.hv20 != null) {
    num += w.hv20 * inp.hv20;
    den += w.hv20;
  }
  if (inp.hv252 != null) {
    num += w.hv252 * inp.hv252;
    den += w.hv252;
  }
  let blended = num / den;
  blended = Math.min(Math.max(blended, 0.05), 3);

  if (inp.sigma30Median != null) {
    blended = (1 - lambda) * blended + lambda * inp.sigma30Median;
  }
  return blended * haircut;
}

export interface EvInputs {
  /** Dividend-adjusted spot. */
  sAdj: number;
  k: number;
  /** Entry credit per share, net of slippage and fees. */
  entryCredit: number;
  /** Forecast drift, annualized cont. comp. (= r − q). */
  mu: number;
  /** Forecast volatility, decimal. */
  sigmaF: number;
  /** Years to expiry. */
  t: number;
  multiplier: number;
  /** Flat $ per assignment event (default 5). */
  assignmentFee?: number;
  /** Flat $ to close the assigned stock (default 0). */
  closeStockCommission?: number;
}

export interface EvResult {
  evPerShare: number;
  ev100: number;
  /** P(S_T > breakeven) under the forecast measure. */
  pop: number;
  /** P(S_T < K) under the forecast measure. */
  probAssigned: number;
  breakeven: number;
  maxLoss100: number;
  creditToMaxLoss: number;
  evToMaxLoss: number;
  /** E_forecast[max(K − S_T, 0)] — the undiscounted expected shortfall. */
  expectedShortfall: number;
}

export function expectedValue(inp: EvInputs): EvResult {
  const {
    sAdj,
    k,
    entryCredit,
    mu,
    sigmaF,
    t,
    multiplier,
    assignmentFee = 5,
    closeStockCommission = 0,
  } = inp;

  const vSqrtT = sigmaF * Math.sqrt(t);
  const d1f = (Math.log(sAdj / k) + (mu + 0.5 * sigmaF * sigmaF) * t) / vSqrtT;
  const d2f = d1f - vSqrtT;

  const expectedShortfall = k * normalCdf(-d2f) - sAdj * Math.exp(mu * t) * normalCdf(-d1f);
  const probAssigned = normalCdf(-d2f);
  const assignmentCostShare = (probAssigned * (assignmentFee + closeStockCommission)) / multiplier;

  const evPerShare = entryCredit - expectedShortfall - assignmentCostShare;
  const ev100 = evPerShare * multiplier;

  const breakeven = k - entryCredit;
  const dPop = (Math.log(sAdj / breakeven) + (mu - 0.5 * sigmaF * sigmaF) * t) / vSqrtT;
  const pop = normalCdf(dPop);

  const maxLoss100 = breakeven * multiplier;

  return {
    evPerShare,
    ev100,
    pop,
    probAssigned,
    breakeven,
    maxLoss100,
    creditToMaxLoss: (entryCredit * multiplier) / maxLoss100,
    evToMaxLoss: ev100 / maxLoss100,
    expectedShortfall,
  };
}
