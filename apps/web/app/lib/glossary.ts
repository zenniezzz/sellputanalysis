/** Glossary content (plan §8.7). Every table column links to its `id` here. */

export interface GlossaryEntry {
  id: string;
  term: string;
  group: string;
  definition: string;
  formula?: string;
  example?: string;
}

export const GLOSSARY: GlossaryEntry[] = [
  {
    id: 'spot',
    term: 'Spot (S)',
    group: 'Inputs',
    definition:
      'Current NBBO mid of the underlying, taken as of the option quote instant where the feed provides it.',
  },
  {
    id: 'dte',
    term: 'DTE',
    group: 'Inputs',
    definition:
      'Calendar days from the snapshot to the 16:00 ET expiration instant, DST-aware. Contracts with DTE < 2 are excluded.',
    formula: 'T = DTE / 365',
  },
  {
    id: 'moneyness',
    term: 'Moneyness %',
    group: 'Contract',
    definition: 'Where the strike sits relative to spot. Negative ⇒ the put is out of the money.',
    formula: '(K − S) / S',
    example: 'K=92, S=100 → −8.0% (8% OTM)',
  },
  {
    id: 'entry-credit',
    term: 'Entry credit',
    group: 'Returns',
    definition:
      'Modeled cash received per share after slippage and fees — the number every return metric uses. The greyed “mid” column is the optimistic reference.',
    formula: 'mid − k·½·spread − commission/100 − fees/100   (k = 0.30 default)',
  },
  {
    id: 'delta',
    term: 'Delta (Δ)',
    group: 'Greeks',
    definition:
      'Price change per $1 move in spot. Put delta ∈ (−1, 0). The screener filters on |Δ| (stable, market convention); P(ITM) below is the actual model probability and |Δ| slightly understates it because d1 > d2.',
    formula: 'Δ_put = −e^(−qT)·N(−d1)',
  },
  {
    id: 'daily-decay',
    term: 'Decay yield (θ%)',
    group: 'Returns',
    definition:
      'Extrinsic value the short position collects per calendar day, as a percent of the entry credit. Positive. A Monday snapshot reflects ~3 days of decay (calendar-time theta).',
    formula: 'daily_decay / entry_credit,  where daily_decay = −θ_day',
  },
  {
    id: 'iv',
    term: 'Implied vol (IV)',
    group: 'Volatility',
    definition:
      'Solved from the mid with our own Black–Scholes (Brent’s method), so every contract is on one model. Cross-checked nightly against the vendor’s IV.',
  },
  {
    id: 'ivrank',
    term: 'IV rank / percentile',
    group: 'Volatility',
    definition:
      'Where today’s 30-day ATM IV sits in its trailing 52-week range (rank) or the share of the last 252 days below it (percentile). Real once ≥ 60 self-accrued samples exist; until then an HV-percentile proxy or blank, flagged “iv~”.',
    formula: 'rank = (σ30 − σ30_low) / (σ30_high − σ30_low) · 100',
  },
  {
    id: 'skew',
    term: 'Put skew 25Δ',
    group: 'Volatility',
    definition:
      'IV of the 25-delta put minus the 30-day ATM IV, from the fitted smile. Positive and rising ⇒ puts relatively rich to sell.',
    formula: 'IV(25Δ put) − σ30',
  },
  {
    id: 'resid',
    term: 'IV vs fitted',
    group: 'Volatility',
    definition:
      'This contract’s IV minus a quadratic smile fit that excludes the contract itself (leave-one-out). A positive residual means it is rich relative to its own surface — a cleaner “edge” signal than raw IV.',
  },
  {
    id: 'pop',
    term: 'PoP',
    group: 'Risk',
    definition:
      'Probability of profit = P(S_T > breakeven) under the forecast distribution (real-world, VRP-haircut). Distinct from P(ITM), which is risk-neutral.',
  },
  {
    id: 'probitm',
    term: 'P(ITM)',
    group: 'Risk',
    definition:
      'Risk-neutral probability the put finishes in the money — the model’s N(−d2). It is not a real-world frequency; the gap versus PoP is the variance risk premium.',
    formula: 'N(−d2)',
  },
  {
    id: 'ev',
    term: 'EV / max-loss',
    group: 'Returns',
    definition:
      'Real-world expected P&L to expiry (under a forecast lognormal with a VRP haircut on volatility) divided by the max loss. The default ranking. See the Model & method page for what the VRP assumption does.',
    formula: 'EV = entry_credit − E_forecast[max(K − S_T, 0)] − assignment cost',
  },
  {
    id: 'annroc',
    term: 'Annualized ROC',
    group: 'Returns',
    definition:
      'Credit received divided by the capital basis (cash-secured or Reg-T margin — you pick; forced to Reg-T for cash-settled index options), annualized. Forecast-free.',
    formula: '(credit·100 / capital_basis) · (365 / DTE)',
  },
  {
    id: 'breakeven',
    term: 'Breakeven',
    group: 'Risk',
    definition: 'Underlying price at expiry where the trade nets zero.',
    formula: 'K − entry_credit',
  },
  {
    id: 'score',
    term: 'Composite score',
    group: 'Ranking',
    definition:
      'Weighted sum of z-scores (annROC, IV-vs-fitted residual, IV rank; minus distance of |Δ| from 0.15 — the low/safer end of the default band) with fixed penalties for the caution flags. EV/max-loss and spread are shown as their own columns but no longer feed the score directly. Blended between a rolling 1-year reference distribution and the current snapshot’s cross-section — the “score basis” chip shows which. Displayed as a 0–10 rating (higher is better) — a rescaling of the underlying z-score for readability; sorting, CSV/JSON export, and comparisons still use the full-precision value underneath.',
  },
  {
    id: 'assignment',
    term: 'Assignment watch',
    group: 'Risk',
    definition:
      'The short put is ITM with little time value left, or an ex-dividend date falls before expiry while ITM — early-assignment risk is elevated. Never set for cash-settled index options.',
  },
  {
    id: 'flags',
    term: 'Model-caution flags',
    group: 'Ranking',
    definition:
      'borrow (hard-to-borrow underlying distorts IV) · div (no dividend schedule, q=0) · iv~ (IV rank from proxy/absent history) · parity (quote below intrinsic) · earn (earnings before expiry) · spot~ (spot not synced to the quote instant). Each carries a fixed score penalty.',
  },
];

export const GLOSSARY_BY_ID: Record<string, GlossaryEntry> = Object.fromEntries(
  GLOSSARY.map((e) => [e.id, e]),
);
