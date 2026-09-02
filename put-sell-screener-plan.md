# Put-Sell Screener — Implementation Plan

**Version:** 3.0 · **Status:** build-ready · **Owner:** _project lead_
**Scope:** v1, screening only · **Users:** cash-secured & Reg-T margin put sellers
**Suggested stack:** Next.js + TypeScript + Postgres + a background worker

Each morning (and on demand), screen the most actively traded options for the
strongest put-selling candidates — ranked by **real-world expected value**,
**annualized return on capital**, or **pure decay yield** (user's choice) against
assignment risk and the volatility surface, with a frozen snapshot so every
comparison is reproducible.

---

## 0. Document control

- **This Markdown file is the single source of truth.** Any HTML/artifact version
  is generated from it and must not be edited independently.
- Conventions in [§2](#2-domain-concepts--conventions) are **binding** on every
  formula, column, filter and schema field.
- Section numbers are stable references.

### 0.1 Changelog

| Version | Changes |
|---|---|
| 1.0 | Initial plan. |
| 2.0 | Added EV, fill/cost model, surface fit, worker architecture, Compare surface, full data model, NFR/testing/security/observability, risk ratings, milestone estimates. |
| **3.0** | **Corrected the put-theta formula (sign bug).** Replaced the EV closed form with an implementable one. Carved cash-settled index options out of all capital/assignment math. Added a no-forecast ranking mode + VRP as a first-class calibrated input and a named risk. Fixed the `metric_reference` and score cold-starts. Fixed the `snapshot_row` partition key; added `raw_payload_manifest`, `schema_version`. Fixed the clean-quote gate; defined the quote-freshness window. Added strike pre-filtering, `underlyingPriceAtQuote`, finite-difference greek tests, DB backup/DR, a security-review milestone, onboarding, DST/expiration-boundary handling. Moved the realized-performance tracker into v1. Corrected the `P(ITM)` calibration metric. |

---

## 1. Product overview

### 1.1 Goals

Turn "what put should I sell this morning?" into a 2-minute, repeatable workflow:

1. Normalize every candidate onto **one pricing model** so cross-name comparison
   is fair.
2. Offer a **risk-combined** ranking (expected value) *and* forecast-free
   rankings (ROC, decay yield) so a user can screen with or without the model's
   volatility forecast.
3. Put the volatility-surface context (skew, term structure, IV rank,
   IV-vs-fitted residual) next to the yield so the user can tell an *edge* from a
   *fair premium*.
4. **Freeze** any view so "I compared these five puts on 2026-09-02" is a
   reproducible statement.

### 1.2 Success metrics (v1)

| Metric | Target | Measured by |
|---|---|---|
| Load → vetted shortlist of ≤ 5 contracts | < 2 min | moderated usability tests, n ≥ 8 |
| Daily snapshot completeness (names priced / 50) | ≥ 46 on ≥ 95 % of trading days | `ingestion_run` |
| Snapshot reproducibility (re-derive every displayed number from stored inputs) | 100 % | CI test on a fixture snapshot |
| **PoP calibration** — realized win rate vs displayed **PoP** (the forecast-measure probability, **not** `P(ITM)`) over ≥ 500 logged paper trades | within ±5 pp (binomial 95 % CI ≈ ±4.4 pp at n = 500) | realized-performance tracker (M6.5) |
| Realized credit vs modeled `entry_credit` on **actual paper fills** | median within ±15 % | realized-performance tracker |
| p95 read-API latency (cached snapshot) | < 300 ms | k6 + prod RUM |
| Weekly active users who freeze ≥ 1 snapshot or comparison | trend ↑ over beta | product analytics |
| Share of sessions that open the Compare tab | ≥ 40 % | product analytics |
| Week-1 → week-2 return rate (beta cohort) | ≥ 35 % | product analytics |

### 1.3 Users & personas

| Persona | Capital tier | Implication |
|---|---|---|
| Small retail | $5k–50k | Cannot cash-secure most single names. Needs the **max buying power / position** filter and a "fits my account" view; leans on ETFs and lower-priced names. |
| Core retail | $50k–250k | The design centre. Cash-secured on most names, occasional Reg-T margin. |
| Small PM / serious retail | $250k+ | Reg-T or portfolio margin; cares about sector concentration; wants the API and saved screens. |

The tool never infers capital tier — the user sets the max-BP filter (remembered
per account, or per browser for anonymous users).

### 1.4 Instruments in scope

- **In:** US-listed **equity and ETF** options, standard `100`-share deliverable,
  monthly and weekly expirations.
- **In (flagged):** broad-based **index options** (SPX, XSP, RUT). These are
  cash-settled and European-exercise, so they are tagged
  `settlement = cash`, `exercise = european`, `settlement_time ∈ {am, pm}`,
  `tax = 1256`. Consequences enforced in the math (§5): **no cash-secured basis**
  (Reg-T/SPAN only), no early-assignment logic, Reg-T factor `0.15` not `0.20`.
  AM-settled series (traditional third-Friday SPX/RUT) settle to the **Special
  Opening Quotation (SET)** on the expiration date; the last practical trading
  time is the **prior close**, so their effective DTE is one day short — the UI
  labels this.
- **Out (v1):** futures options; non-standard / adjusted deliverables (detected
  and excluded); options on ADRs with irregular dividends (flagged, excluded);
  single names whose borrow rate exceeds a threshold (flagged; excluded only if
  the user opts in).

### 1.5 Competitive positioning

Market Chameleon, TastyTrade, Barchart Premier, OptionStrat and the thinkorswim
scanner all screen options. The wedge is the **combination**: a real-world-EV
ranking *plus* forecast-free rankings, surface-relative richness, a reproducible
frozen snapshot, and an explicit side-by-side **Compare** view. We do not compete
on universe breadth or charting.

### 1.6 Non-functional requirements

| Area | Requirement |
|---|---|
| Deployment model | Multi-tenant SaaS. A shared daily snapshot is public / anonymous-readable; accounts add saved screens, watchlists and a higher on-demand-refresh quota. |
| Availability | 99.5 % monthly for the read path (error budget ≈ 3.6 h/month). A failed ingestion degrades gracefully — the last good snapshot stays served. |
| Performance | p95 < 300 ms cached read; < 1.5 s cold; snapshot build < 8 min wall-clock. |
| Browsers | Evergreen Chrome/Edge/Firefox/Safari, last 2 versions. Desktop-first; mobile = responsive card view. |
| Accessibility | **WCAG 2.2 AA.** Every chart has a table-view equivalent; full keyboard operation of table and Compare. |
| Data freshness | Snapshot age shown on every screen; "delayed" badge whenever the feed is delayed or `DISPLAY_DELAYED` is on. |
| Privacy / compliance | Only PII stored is account email. A public privacy policy, a DPA for EU users, and a self-service account-and-data deletion path. No trade data leaves the user's account. |
| i18n | English-only, US market conventions, v1. Number/date formatting via `Intl`; copy externalised for later. |

---

## 2. Domain concepts & conventions

### 2.1 Conventions (binding)

| Convention | Rule |
|---|---|
| **Implied volatility** | Stored and computed as a **decimal** (`0.45`); displayed as a percent. |
| **Premium / credit** | Quoted **per share** everywhere in UI and filters. Multiply by the contract multiplier (`100`, or the instrument's actual value) **only** for capital, margin, credit-received and P&L math. Per-contract schema fields carry a `_100` suffix. |
| **Greeks** | Per share. |
| **Theta sign** | BSM `theta_day` is **negative** (the option loses value over time). The tool ranks on **`daily_decay = −theta_day`** (positive) and **`decay_yield = daily_decay / entry_credit`**. Never rank on raw `theta_day`. |
| **Time** | `T = DTE_calendar / 365`. `DTE_calendar` = calendar days from the snapshot date to the expiration date. Contracts with `DTE_calendar < 2` are excluded (never floored-and-priced). All date math goes through one tested `tradingCalendar` module (DST-aware, holiday-aware). |
| **Expiration instant** | `16:00:00 America/New_York` on the expiration date for physically-settled and PM-settled options; the SET print on the expiration date for AM-settled index options (effective last-trade = prior close). |
| **Moneyness** | For a put, `(K − S) / S`. Negative ⇒ out-of-the-money. |
| **"Mark"** | `mark = mid = (bid + ask) / 2` of the **NBBO** at `quote_as_of`. `last` is stored, never used for pricing. Rows failing the clean-quote gate (§5.2) are excluded from math and candidacy but retained in `snapshot_row`. |
| **Rounding** | Money, greeks, probabilities stored as `numeric` (fixed precision, §9) — never binary float. |
| **Timezone** | Business logic in `America/New_York`; all stored timestamps UTC. |

### 2.2 Glossary (load-bearing terms)

Full definitions, formulas and pinned worked examples live in the in-app
glossary ([§8.7](#87--glossary)).

| Term | Working definition |
|---|---|
| Spot (`S`) | Current NBBO mid of the underlying, as of the option quote instant where available (`underlyingPriceAtQuote`), else the standalone quote. |
| `S_adj` | `S` minus the present value of dividends with ex-date before expiry (§3.5). |
| DTE | Calendar days to expiration (§2.1). |
| Moneyness | `(K − S) / S` for a put; negative = OTM. |
| Entry credit | Modeled cash received **per share** after slippage and fees (§5.4). `mid_credit` shown alongside as the optimistic reference. |
| Delta | dP/dS per share; put delta ∈ (−1, 0). We **filter** on \|delta\| (stable, market convention) and **display `P(ITM) = N(−d2)`** as the model probability — \|delta\| ≈ `e^(−qT)·N(−d1)` slightly **understates** the chance of finishing ITM because `d1 > d2`. |
| Gamma | d²P/dS² per share. |
| `daily_decay` | `−theta_day`, positive; extrinsic value collected per calendar day. |
| Vega | dP/dσ per share, per 1.00 change in σ; displayed per 1 vol point (÷100). |
| IV rank | Position of today's 30-day ATM IV (`σ30`) in its trailing 52-week range, 0–100. Stored **as computed on the date**, not recomputed as the window rolls. |
| IV percentile | Share of the trailing 252 trading days with `σ30` below today, 0–100. Preferred after a vol-regime shift. |
| `σ_f` (forecast vol) | The volatility used for **real-world EV** (§5.7): a blend of realized and implied vol, shrunk and haircut for the variance risk premium. |
| VRP | Variance risk premium — implied vol's historical tendency to exceed subsequently realized vol; the source of positive put-selling EV. |
| Put skew | `IV(25Δ put) − σ30` on the same expiration. Positive and rising ⇒ puts relatively rich. |
| IV-vs-fitted residual | `row.iv − smile_fit(row)`, with the smile fit **excluding the row itself**. Positive ⇒ this specific contract is rich relative to its own surface. |
| Term structure | `σ30(front) − σ30(next)`. Positive (backwardation) often signals an event or stress. |
| EV | Real-world expected P&L per share of selling and holding to expiry, under the §5.7 forecast distribution. Undiscounted by default. |
| PoP | `P(S_T > breakeven)` under the forecast distribution. |
| Assignment | Short put exercised against you; you buy 100 shares at `K`. Risk rises when the put is ITM with little time value and around ex-dividend. N/A for cash-settled index options. |
| Breakeven `B` | `K − entry_credit`. |

---

## 3. Data sources

### 3.1 What each stage needs

| Data | Used by | Source note |
|---|---|---|
| Option volume by underlying / most-active | Universe (stage B) | **OCC daily volume file** (free, per-class) — also the trailing 20-day option-volume average; and/or the provider's most-active list. Ranked **within the DTE window**. |
| Full option chains: bid, ask, sizes, last, volume, OI, quote timestamp, **underlying price at quote** | Chains (stage C) | Per contract, per expiration in the window. |
| Underlying: spot, **discrete dividend schedule** to +400 d, HV20, HV252 | Contract math | §3.5. |
| Borrow rate / hard-to-borrow flag | Universe filter, model-caution | §3.6. |
| Risk-free curve | Contract math | Bootstrapped zero curve, §3.5. |
| Next earnings date (confirmed vs estimated) | Candidate filter | §7. |
| ≥ 1 year of 30-day ATM IV per underlying | IV rank / percentile | Cold-start plan in §11; ORATS backfill at M2. |

### 3.2 Source options

| Need | Prototype (free / cheap) | Production |
|---|---|---|
| Most-active / volume | OCC daily volume file; CBOE most-active | OCC file; Polygon; vendor |
| Chains + quotes + greeks | CBOE delayed JSON (~15 min, no key); `yfinance` | **Tradier** (~$10/mo market data, greeks incl., real-time with a funded account) or Polygon ($29–199/mo) |
| Greeks | compute our own | compute our own; vendor greeks used only as a monitoring cross-check |
| Spot / dividends | `yfinance`; Nasdaq dividend calendar | vendor + Nasdaq |
| Borrow rate | none reliable free | broker feed (IBKR) or vendor (ORATS, S3) |
| Rates | Treasury.gov daily par yields; FRED `DGS*` | same |
| Earnings dates | FMP free tier | FMP paid (~$20–30/mo) or vendor; always store confirmed/estimated |
| Historical IV | none good free → HV proxy | ORATS 1-year backfill, then self-accumulate |

> **Recommendation.** Single production provider **Tradier**; free fallback and
> prototype path **CBOE delayed**, behind the same interface. Self-accumulate
> `σ30` from day one; buy a **one-time 1-year ATM-IV backfill from ORATS** at M2
> to remove the IV-rank cold-start.

### 3.3 Provider interface & data contracts

```ts
type Iso8601 = string;            // UTC
type Decimal = string;            // fixed precision, parsed to a Decimal type

interface Underlying {
  symbol: string; name: string;
  spot: Decimal; spotAsOf: Iso8601;
  dividends: { exDate: Iso8601; amount: Decimal }[];   // discrete, to +400d
  hv20: Decimal; hv252: Decimal;
  borrowRate: Decimal | null; hardToBorrow: boolean;
  optionVolume20dAvg: number | null;
  hasWeeklies: boolean; isAdr: boolean; sector: string | null;
  settlement: 'physical' | 'cash';
  exerciseStyle: 'american' | 'european';
  settlementTime: 'am' | 'pm' | null;
}

interface OptionQuote {
  occSymbol: string;                    // OCC 21-char symbol — the contract identity
  underlying: string; expiration: Iso8601; strike: Decimal;
  right: 'P' | 'C'; multiplier: number;
  bid: Decimal; ask: Decimal; bidSize: number; askSize: number;
  last: Decimal | null; volume: number; openInterest: number;
  quoteAsOf: Iso8601;
  underlyingPriceAtQuote: Decimal | null;   // spot at the same instant as this quote
  underlyingPriceAsOf: Iso8601 | null;
  isNonStandard: boolean;
  vendorGreeks?: { delta; gamma; theta; vega; iv: Decimal };   // cross-check only
}

interface MarketData {
  getMostActive(limit: number): Promise<Result<Underlying[]>>;
  getExpirations(symbol: string): Promise<Result<Iso8601[]>>;
  getChain(symbol: string, expiration: Iso8601): Promise<Result<OptionQuote[]>>;
  getUnderlying(symbol: string): Promise<Result<Underlying>>;
  getEarnings(symbol: string): Promise<Result<{ next: Iso8601; confirmed: boolean } | null>>;
}
interface RatesSource {
  getCurve(asOf: Iso8601): Promise<Result<{ tenorYears: number; zeroRate: Decimal }[]>>;
}
```

**Error model.** Every call returns
`Result<T> = { ok: true; value: T; stale?: boolean } | { ok: false; error: ProviderError }`:

```ts
type ProviderError =
  | { kind: 'rate_limited'; retryAfterMs: number }
  | { kind: 'entitlement'; detail: string }      // not entitled to real-time / this symbol
  | { kind: 'not_found' }
  | { kind: 'upstream_5xx'; status: number }
  | { kind: 'timeout' }
  | { kind: 'malformed'; detail: string };
```

Adapter responsibilities: transport retries on `timeout` / `upstream_5xx` (max 3,
exponential backoff + jitter); honor `rate_limited.retryAfterMs`; normalize every
payload to the shapes above. The pipeline decides skippable
(`not_found` / `malformed` / `entitlement` on one symbol ⇒ log + exclude) vs fatal.

### 3.4 Rate-limit budget

One full snapshot, 50 names:

| Call | Count | Note |
|---|---:|---|
| `getMostActive` | 1 | |
| `getUnderlying` | 50 | batched where the provider allows |
| `getExpirations` | ≤ 50 | cached 24 h; usually bundled with the chain |
| `getChain` (whole expiration + greeks, one call) | ~50 × 7 ≈ **350** | the bottleneck |
| `getEarnings` | ≤ 50 | cached 24 h ⇒ ~5–10 live calls/day |
| Rates | 1 | |

**Tradier REST ≈ 120 req/min.** Mitigations: (1) one call per **expiration**, not
per strike; (2) fetch names **concurrently**, pool of 8, behind a **shared Redis
token-bucket at 100 req/min**; (3) 24 h cache on expirations/earnings; (4) the
streaming market-events endpoint if still tight. **M0 spike** proves a real
50-name run completes in < 8 min.

### 3.5 Rates & dividends

- **Rates.** Pull the Treasury daily par-yield curve, bootstrap to a
  continuously-compounded **zero** curve, interpolate linearly on zero rates for
  `r(T)`, day-count ACT/365F. Store the full curve per snapshot (`rates_curve`).
- **Dividends.** Use the **discrete** schedule:
  `S_adj = S − Σ dividend_i · e^(−r·t_i)` over ex-dates `t_i < T`, and set `q = 0`.
  If the schedule is unavailable, fall back to continuous
  `q = trailing_annual_dividend / S` and set `model_caution.dividend = true`.

### 3.6 Borrow rate

Expensive-to-borrow underlyings break put-call parity — the put's price embeds
the borrow cost, so IV solved from the mark is inflated and the contract looks
richer to sell than it is. If `borrowRate > 1 %` annualized or `hardToBorrow`:
set `model_caution.borrow = true`, still price it, **flag** it in the UI and apply
a fixed score penalty (§6). A universe filter can exclude these (default: include
+ flag).

### 3.7 Cadence

| Job | Schedule (ET) | Note |
|---|---|---|
| Rates curve | 07:45 | cached for the day |
| Scheduled snapshot | **10:00, 12:30, 15:15** | The 10:00 run is the "morning" default (moved from 09:45 to let opening spreads settle). |
| On-demand refresh | user-triggered | global cooldown 10 min; per-user quota 6/day anon, 30/day signed-in; concurrent requests dedupe onto one job |
| `σ30` history sample | end of each scheduled run | one row per underlying |
| Earnings calendar refresh | 06:30 | 5-day forward window |

### 3.8 Caching

| Data | TTL | Store |
|---|---|---|
| Expirations, earnings | 24 h | Redis |
| Underlying quote (interactive) | 60 s | Redis |
| Chain (interactive) | 90 s | Redis |
| Published snapshot read endpoints | immutable; CDN edge cache keyed by **`snapshotId` + normalized filter/sort query string** | CDN |
| Rates curve | until 07:45 next day | Redis + `rates_curve` |

### 3.9 Licensing

Delayed data is generally redistributable; **real-time** exchange data shown to
end users requires an agreement and per-user fees. **Action:** before any public
launch, confirm Tradier's redistribution terms in writing and either display
**15-minute-delayed** quotes to non-entitled users or complete exchange
agreements. A global `DISPLAY_DELAYED` mode shifts every quote timestamp and
label accordingly and is built from M1.

---

## 4. Daily pipeline

One idempotent job per `runId = {date}-{HHMM}-{scheduled|ondemand|replay}`.

### 4.1 Stages

| Stage | Name | Work | Failure handling |
|---|---|---|---|
| A | Rates | Bootstrap the zero curve → `rates_curve`. | Fatal — abort. |
| B | Universe | `getMostActive(120)` → universe filters (§4.3) → top 50 by in-window volume. | Widen 120→200 if < 50; then fatal. |
| C | Chains | Per name: expirations with `DTE ∈ [minDTE−4, maxDTE+4]` → `getChain`. | Per-name skippable → `ingestion_log`. |
| D | Contract math | Per put **with strike in `[0.60·S, 1.05·S]`**: clean-quote gate → solve IV → greeks → derived metrics (§5). | Per-contract skippable. |
| E | Candidate filter | Apply the default gate (§7). | — |
| F | Surface & IV rank | Fit per-expiration smile; `σ30`, `IV(25Δ put)`, per-contract residual; IV rank / percentile from `iv_history` or HV proxy. | Proxy path sets `model_caution.iv_rank_proxy`; fit failure ⇒ residual `null`. |
| G | Score & rank | EV, ROC, decay yield, composite score (§6); sort by the snapshot default. | — |
| H | Persist | `snapshot` + `snapshot_row` (every priced put with \|delta\| ≤ 0.45 **or** within the strike window and `bid > 0`) + `ingestion_log` + `ingestion_run`; write raw payload bundles to object storage and index them in `raw_payload_manifest`. | Transactional. |

The strike pre-filter in D bounds pricing to ~30–50 strikes per expiration
(~12 k IV solves per run; Brent ≈ 1–2 ms each ⇒ stage D < 30 s).

### 4.2 Pipeline SLOs

| Metric | Target | Abort / degrade |
|---|---|---|
| Wall-clock run time | < 8 min | alert at 12 min; kill at 20 min |
| Names successfully priced | ≥ 46 / 50 | `degraded` < 46; not `good` < 40; never published < 30 |
| Stage D wall-clock | < 60 s | alert |
| IV-solve success (candidate contracts) | ≥ 98 % | alert < 95 % |
| Own-vs-vendor greek median abs deviation | < 2 % | alert > 5 % — likely a formula/units regression |

`snapshot.status ∈ {good, degraded, failed}` and `data_completeness` are shown in
the UI.

### 4.3 Universe filters (stage B)

- Underlying price ≥ **$10**
- Standard monthly options with a `100`-share standard deliverable
- 20-day average option volume ≥ **20 000 contracts**
- Not leveraged / inverse ETP (toggle, default exclude)
- Rank by **volume in the DTE window**, not total volume
- De-duplicate across root symbols; drop non-standard / adjusted series

### 4.4 Concurrency & observability

- Name fan-out: worker pool 8, shared Redis token-bucket at 100 req/min.
- Per-name retry: 2 attempts, then dead-letter into `ingestion_log`.
- Structured JSON logs with `runId, symbol, stage, durationMs, outcome`.
- Per-run metrics: `run_duration_seconds, names_ok, names_failed,
  contracts_priced, iv_solve_failures, candidates_found,
  greek_xcheck_median_abs_pct`. Dashboards + alerts in §10.7.

### 4.5 Historical replay

For every run, the raw JSON responses for **chains, underlyings, earnings, borrow,
dividends and the rates curve** are written to object storage and indexed in
`raw_payload_manifest`. Replay mode (`--asOf <date> [--run <HHMM>]`) reconstructs
stages A–C purely from those bundles, so earnings dates, borrow rates and
dividends are all point-in-time-correct; stages D–H run unchanged. Bundles
retained 400 days; backtest-critical bundles can be pinned. **Built from M1** so
the §13 backtester and the §11 point-in-time risk are covered from the start.

---

## 5. Calculations

### 5.1 Model

**Black–Scholes–Merton** with dividends via the PV-of-spot adjustment (§3.5). BSM
is the screening standard and keeps every row on one model. American
early-exercise is handled as a **flag, not a reprice** (§5.8); a binomial
re-price for flagged contracts is a v1.1 item. Cash-settled European index options
use BSM directly with no early-exercise logic.

### 5.2 Inputs & the clean-quote gate

```
S        underlyingPriceAtQuote  (else standalone spot; set model_caution.spot_async)
S_adj    S − PV(dividends with ex-date < T)          # q = 0 when this is used
K        strike
r        r(T) from the bootstrapped zero curve
q        0 with discrete dividends, else trailing dividend yield
T        DTE_calendar / 365                          # contracts with DTE_calendar < 2 excluded upstream
mid      (bid + ask) / 2
```

**Clean-quote gate** (reject before any math; row retained in `snapshot_row` with
`excluded_reason`):

```
reject if  bid ≤ 0
        or ask < bid
        or (ask − bid) > max($0.20, 0.60 · mid)      # absolute-or-relative spread cap
        or mid < $0.02
        or quoteAsOf older than freshness_window     # default 180 s; 45 s under a fast-market flag
        or isNonStandard
```

### 5.3 Implied volatility

Solve `BSM_put(σ) − mid = 0` for `σ ∈ [0.005, 5.0]` with **Brent's method**
(bisection fallback). `BSM_put` is monotone in σ with range
`[max(K·e^(−rT) − S_adj, 0), K·e^(−rT)]`.

- `mid < discounted_intrinsic` **and** quote stale/crossed ⇒ drop, log.
- `mid < discounted_intrinsic` **and** a legitimate deep-ITM quote (borrow /
  early-exercise value) ⇒ keep row, `model_caution.below_parity = true`, use
  vendor IV if present else `iv = null` (excluded from candidacy and scoring).
- `mid > K·e^(−rT)` (arb, extremely rare) ⇒ drop, log.
- No convergence in 100 iterations ⇒ drop, log.
- Round-trip check: `|BSM_put(σ_solved) − mid| ≤ 0.005` else drop.

### 5.4 Fill & cost model

```
half_spread        = (ask − bid) / 2
slippage_k         = 0.30                       # 0 optimistic … 1 = hit the bid; config
assumed_fill       = mid − slippage_k · half_spread
commission_share   = 0.0065                     # $0.65 / contract; config
exchange_fee_share = 0.0003
entry_credit       = assumed_fill − commission_share − exchange_fee_share      # per share
mid_credit         = mid                                                       # reference column
```

Every downstream return metric uses `entry_credit`. `mid_credit` is shown greyed
alongside so the spread cost is visible. Exit is assumed to be expiry-worthless
(no close cost); assignment costs are modeled in EV (§5.7).

### 5.5 Greeks & derived metrics

```
d1 = [ ln(S_adj / K) + (r − q + σ²/2)·T ] / (σ·√T)
d2 = d1 − σ·√T
n(x) = standard-normal pdf     N(x) = standard-normal cdf
```

| Metric | Formula | Notes |
|---|---|---|
| Put price | `K·e^(−rT)·N(−d2) − S_adj·e^(−qT)·N(−d1)` | must reprice to `mid` |
| Delta (put) | `−e^(−qT)·N(−d1)` | ∈ (−1, 0); filter axis |
| Gamma | `e^(−qT)·n(d1) / (S_adj·σ·√T)` | per share |
| **Theta (put), per year** | `− S_adj·e^(−qT)·n(d1)·σ / (2√T)  +  r·K·e^(−rT)·N(−d2)  −  q·S_adj·e^(−qT)·N(−d1)` | **corrected in v3.0** — the `r` and `q` terms were sign-flipped in v2.0. Sanity check: S=K=100, r=5%, q=0, σ=20%, T=1 → −1.66/yr. |
| `theta_day` | `theta_year / 365` | negative |
| **`daily_decay`** | `− theta_day` | **positive**; the ranking input |
| Vega | `S_adj·e^(−qT)·n(d1)·√T / 100` | per 1 vol point |
| Moneyness % | `(K − S) / S` | raw `S` |
| Spread % | `(ask − bid) / mid` | |
| vol/OI | `volume / openInterest` | |
| Credit (per contract) | `entry_credit · multiplier` | schema `entry_credit_100` |
| **Decay yield (daily)** | `daily_decay / entry_credit` | positive; forecast-free |
| Theta / vega | `daily_decay / vega` | decay per unit of vol risk |
| Breakeven `B` | `K − entry_credit` | |
| BE % below spot | `(S − B) / S` | downside cushion |
| `P(ITM)` risk-neutral | `N(−d2)` | model probability of finishing ITM; **risk-neutral, not a real-world frequency** |
| Expected-move distance | `(S − K) / (S · σ30 · √T)` | uses the underlying's 30-day ATM IV so skew doesn't distort cross-name comparison |
| CSP capital (per contract) | `K · multiplier − entry_credit · multiplier` | **`null` when `settlement = cash`** |
| Reg-T capital (per contract) | `multiplier · max( f·S − max(S − K, 0),  0.10·base ) + entry_credit·multiplier` | `f = 0.20` equity / `0.15` broad index; `base = K` default (config `S` for the FINRA minimum). Portfolio margin is separate and ~stress-based (3–5× lower) — out of scope v1. |
| **Annualized ROC** | `(entry_credit·multiplier) / capital_basis · (365 / DTE_calendar)` | `capital_basis` = CSP or Reg-T per the toggle; **forced to Reg-T when `settlement = cash`**; forecast-free |
| IV rank | `(σ30 − σ30_52wLow) / (σ30_52wHigh − σ30_52wLow) · 100` | 0–100 |
| IV percentile | trailing-252-day share below today · 100 | preferred after regime shifts |
| Put skew | `IV(25Δ put, this expiry) − σ30` | from the smile fit (§5.6) |
| IV-vs-fitted residual | `row.iv − smile_fit_excluding_row(row)` | surface-relative richness |
| Term structure | `σ30(front) − σ30(next)` | underlying level |

### 5.6 Volatility surface fit (stage F)

Per underlying, per expiration in the window: fit a **quadratic in
log-moneyness** (robust / Huber) to the mid-IVs of liquid strikes
(`spread% ≤ 15 %`, `OI ≥ 100`); SVI is a v1.1 upgrade. Each contract's residual is
computed from a fit **that excludes that contract** (leave-one-out) so a rich
point doesn't pull its own benchmark. `σ30` is obtained by interpolating
**linearly in total variance** (`σ²·T`) between the two bracketing expirations,
then `√`. `IV(25Δ put)` is read off the fitted smile at the 25-delta strike.

### 5.7 Expected value (real-world, forecast measure)

Under the **risk-neutral** measure the EV of selling at fair value is ≈ 0 net of
costs — useless for ranking. The put-selling edge, when it exists, is the
**variance risk premium**: implied vol has historically tended to exceed
subsequently realized vol. EV is therefore computed under an explicit **forecast**
distribution, and the VRP assumption is a first-class, calibrated input
(§6.5, §11).

```
σ_f  = clamp( w_hv20·HV20 + w_hv252·HV252 + w_iv·σ30 , 0.05 , 3.0 )
       shrunk toward σ30_1y_median with intensity λ
       × vrp_haircut
   defaults  w_hv20 = 0.35, w_hv252 = 0.25, w_iv = 0.40, λ = 0.35, vrp_haircut = 0.90
μ    = r − q                                    # forecast drift; risk-free, deliberately conservative; config
T    = DTE_calendar / 365
```

`ln S_T ~ Normal( ln S_adj + (μ − σ_f²/2)·T , σ_f²·T )`.

Short-put P&L per share at expiry `= min( entry_credit , S_T − B )`. Using
`min(C, S_T − B) = C − max(K − S_T, 0)`:

```
d1f = [ ln(S_adj / K) + (μ + σ_f²/2)·T ] / (σ_f·√T)
d2f = d1f − σ_f·√T

E_forecast[ max(K − S_T, 0) ]  =  K·N(−d2f) − S_adj·e^(μT)·N(−d1f)        # undiscounted

P(assigned) = P(S_T < K)       =  N(−d2f)
assignment_cost_share          =  P(assigned) · (assignment_fee + close_stock_commission) / multiplier
                                  # defaults: assignment_fee $5 flat → /multiplier ; close commission $0

EV_per_share  =  entry_credit − E_forecast[ max(K − S_T, 0) ] − assignment_cost_share
EV_100        =  EV_per_share · multiplier

PoP  =  P(S_T > B)  =  N(  [ ln(S_adj / B) + (μ − σ_f²/2)·T ] / (σ_f·√T)  )
```

EV is reported **undiscounted** (expected P&L in dollars at expiry). A PV variant
discounted at `μ` sits behind a config flag (§14).

Model-light companions, shown alongside:

```
max_loss_100       = B · multiplier
credit_to_maxloss  = (entry_credit · multiplier) / max_loss_100
EV_to_maxloss      = EV_100 / max_loss_100
```

Every EV figure carries the row's `model_caution` flags and the `σ_f` /
`vrp_haircut` used, surfaced in the row expander.

### 5.8 American exercise & assignment watch

v1 uses European (BSM) values. `assignment_watch = true` when the put is ITM and
`time_value < 0.10 × intrinsic`, or an ex-dividend date falls before expiration
while the put is ITM. Always `false` for `settlement = cash` / `exercise = european`.

### 5.9 Validation

| Check | Standard |
|---|---|
| `black-scholes` module vs a **golden set** (Hull 9th ed. worked examples + 20 QuantLib cases) | `1e-6` |
| **Greeks vs central-difference bump** (`ΔS = 0.01·S`, `Δσ = 1e-3`, `ΔT = 1 day`, `Δr = 1 bp`) — the regression guard for analytic sign errors | < 0.5 % relative |
| Property tests: price ↑ in σ; `delta ∈ (−1,0)`; `gamma, vega ≥ 0`; put-call parity `C − P = S_adj·e^(−qT) − K·e^(−rT)`; IV round-trip | exact / `1e-6` |
| EV closed form vs 100 000-path Monte-Carlo of the same lognormal | ≤ 1 % relative |
| Nightly own-vs-vendor greek median abs deviation | < 2 % (alert) |

---

## 6. Ranking & scoring

### 6.1 Primary sort — the user picks one

1. **EV-to-max-loss** (default) — risk-adjusted; depends on the §5.7 forecast.
2. **Annualized ROC** — yield on capital; **forecast-free**.
3. **Decay yield** — pure theta collection; **forecast-free**.

Modes 2 and 3 let a user who distrusts the VRP assumption screen without it.

### 6.2 Composite score (optional column; drives the scatter colour)

A weighted sum of z-scores taken against **fixed reference distributions**
(`metric_reference`, rolling 1-year per metric) — **not** the current result set —
so a contract's score does not move when an unrelated filter changes.

```
score =  0.28 · z_ref(EV_to_maxloss)
       + 0.22 · z_ref(annualized_ROC)
       + 0.16 · z_ref(iv_vs_fitted_residual)
       + 0.14 · z_ref(iv_rank)
       − 0.10 · z_ref(spread_pct)
       − 0.10 · z_ref(|delta| − 0.25)
       − penalty          # fixed, not z-scored:
                           #   0.50 borrow caution   0.50 dividend caution
                           #   1.00 earnings_before_expiry (in "flag" mode)
                           #   0.75 iv_rank_proxy
```

**NULL handling.** If a positive-weight component is `null` (e.g. residual when
the smile fit failed, `iv_rank` on a proxy-less name), drop that term and
renormalise the remaining positive weights to the original positive total
(`0.80`); penalties still apply; record `score_components.present[]`. If `iv`
itself is `null`, `score = null`, the row is not a candidate and is greyed in the
UI.

**Colour domain.** The scatter maps `score` through a **fixed** domain
`[−2, +3]` (clamped) so a dot's colour is stable across filter changes.

### 6.3 Cold start for `metric_reference`

`z_ref` needs history. Until **60 trading days** of a metric exist, z-scores are
computed from the **current snapshot's cross-section** using **median / MAD**
(robust), and `snapshot.score_basis = 'cross_sectional'` (badged in the UI).
Between 60 and 252 days, blend linearly toward the reference distribution. From
252 days, `score_basis = 'reference'`.

### 6.4 Per-underlying collapse & diversification

- Default view: **one row per underlying** — the highest-score qualifying
  contract — with an expander for the name's other qualifying contracts. A toggle
  shows all contracts.
- **"Example basket"** panel (opt-in, distinct from the table): greedily pick N
  (default 5) maximising total score subject to ≤ 2 per sector. Labelled an
  *example construction*, no position sizing, carries the §11.1 disclaimer.

### 6.5 VRP calibration

The realized-performance tracker (M6.5, §13) logs modeled `σ_f` and PoP against
realized outcomes. A monthly job re-estimates `vrp_haircut` (and, later, the
blend weights) from that log and proposes an update; changes are versioned in
`metric_schema_version` and never applied silently to historical snapshots.

---

## 7. Filters

Filter state lives in the URL query string **and** can be saved as a **named
screen** (signed-in). A live count updates per control; a zero-result combination
offers the nearest match by relaxing the most-restrictive filter.

### 7.1 Controls

| Control | Default | Range / options | Unit |
|---|---|---|---|
| Intended order size | 10 | 1–1 000 | contracts (feeds capital & size-vs-OI) |
| DTE window | 25–45 | 5–120 (min 2 hard) | calendar days |
| \|Delta\| band | 0.15–0.35 | 0.05–0.50 | — |
| Max spread % | 8 | 1–25 | % of mid |
| Min entry credit | 0.30 | 0.05–5.00 | **$ per share** |
| Min annualized ROC | 12 | 0–100 | % |
| Max `P(ITM)` | 0.35 | 0.05–0.60 | probability |
| Min open interest | 500 | 0–10 000 | contracts |
| Min volume (today) | 100 | 0–5 000 | contracts |
| Max order size vs OI | 5 | 1–50 | % (uses *intended order size*) |
| Min IV rank **or** IV percentile | 30 | 0–100 | user picks the driver |
| Days since last earnings | any | 0–90 | calendar days |
| Earnings before expiry | Exclude | Exclude / Flag / Ignore | confirmed dates hard-exclude; estimated only flag |
| Expiration type | Any | Any / Monthly / Weekly | |
| Min underlying price | 10 | 1–1 000 | $ |
| **Max buying power / position** | none | $500 – $500 000 | capital basis × intended order size |
| Capital basis | Cash-secured | Cash-secured / Reg-T (auto Reg-T for index) | |
| Sector | All | multi-select + exclude list | |
| Model-caution flags | show all | hide {borrow, dividend, below-parity, iv-proxy} individually | |
| Exclude leveraged / inverse ETPs | On | toggle | |
| Exclude hard-to-borrow | Off | toggle | |
| Watchlist only | Off | toggle (signed-in) | |

> **The filter that matters most: _earnings before expiration._** Default
> Exclude; Flag / Ignore is a conscious choice. Estimated earnings dates never
> hard-exclude — they move.

---

## 8. Screens & UI

### 8.1 Information architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│ 2026-09-02 10:00 ET ▾   status: good (48/50)  score basis: reference  │
│                                       [Refresh] [Freeze]  ⏱ delayed 15m│
├──────────────────────────────────────────────────────────────────────┤
│  Universe │ CANDIDATES │ Compare (3) │ Snapshots                       │
├──────────────────────────────────────────────────────────────────────┤
│  ▸ Filters  [sort: EV/ML ▾]  [preset: Balanced ▾]  [screen ▾]  142 hits│
├───────────────────────────────┬──────────────────────────────────────┤
│  Scatter (EV/ML vs |delta|)   │  Results — 1 row / underlying ▾       │
│      · · ·                     │  ☐ NVDA  Oct17 172.5P  EV/ML .18 …   │
│    · target band ·            │  ☐ AMD   Oct17 148P    EV/ML .15 …   │
│      · ·  ·                    │  ☑ META  Oct10 690P    EV/ML .13 …   │
│  [chart ⇄ table]              │  CSV ▾  API  columns: Essentials ▾    │
└───────────────────────────────┴──────────────────────────────────────┘
```

### 8.2 First-run

New users land on the default **Balanced** screen already populated. A
dismissible 5-step coach-mark tour walks filters → scatter → table → Compare →
Freeze. The empty Compare tab shows a "how this works" card. Every choice is
remembered (account, or `localStorage` for anonymous).

### 8.3 Universe tab

One row per underlying: ticker, spot, in-window put volume, put/call ratio, `σ30`,
IV rank, IV percentile, term-structure, 5-day return, distance to 52-week low,
next earnings (+ "before nearest monthly?" flag), borrow flag, sector, #
qualifying candidates. Click → Candidates filtered to that name.

### 8.4 Candidates tab

- **Column presets:** Essentials / Greeks / Risk / Returns / All. Essentials =
  `ticker · exp · DTE · strike · moneyness% · entry_credit · mid_credit · Δ ·
  P(ITM) · decay_yield · EV/ML · annROC · IVR · spread% · flags`.
- Sticky header; right-aligned tabular numerals; sort any column.
- Semantic shading: IV rank on a sequential ramp; spread % → amber past the
  filter; `flags` as chips (earnings, borrow, dividend, below-parity, iv-proxy,
  assignment-watch, spot-async).
- **Unpriced rows** (`iv = null`): shown greyed with an "unpriced" chip, excluded
  from the scatter and scoring, retained for the diff and the explainer.
- **Row expander:** a **P&L probability cone** to expiry (forecast distribution,
  breakeven and strike marked, shaded EV), the full greek set, the score
  component breakdown, `σ_f` / `vrp_haircut`, every qualifying contract for the
  name as a mini term-structure, the assigned-stock scenario line, outbound links.
- **"Why isn't _X_ here?"** — type a ticker, see which gate/filter excluded each
  of its contracts.
- Export: current view → CSV; full snapshot → JSON. Read API (§10.4).

### 8.5 Compare tab

- Add contracts from any table or the scatter (checkbox) → a **Compare tray**
  (max 6).
- Transposed layout: **columns = contracts, rows = metrics**, grouped
  (Contract · Greeks · Returns · Risk · Surface · Flags). Best-in-row
  highlighted, worst muted.
- Overlaid **P&L probability cones** on one axis.
- Export the comparison → **PDF** (print stylesheet) and **CSV** (transposed).
- "Freeze comparison" persists this exact set + snapshot id as a shareable
  read-only link (anonymous or account-owned).

### 8.6 Snapshots tab

List of frozen snapshots (timestamp, status, completeness, score basis, filter
summary, count). Open any read-only. **Diff** two: candidates added / dropped /
rank-moved, with `σ30`, IV-rank, EV and score deltas and the drop-out reason.
Diffs across a `metric_schema_version` change label new metrics rather than
erroring.

### 8.7 Glossary

Every column header links to its glossary entry (hover = one-liner, click =
anchor). Each entry: definition, formula, and a **pinned canonical worked
example** with fixed inputs (never a live row). Collapsible.

### 8.8 The scatter — spec

- **Default:** X = \|delta\|, Y = **EV-to-max-loss**. Shaded vertical band at
  \|delta\| 0.15–0.35.
- Size = open interest (log); colour = composite score through the fixed
  `[−2, +3]` domain (§6.2). Size and colour each have an "off" toggle.
- Axis dropdowns over any numeric column, with presets:

| Preset | X | Y | Reads as |
|---|---|---|---|
| Value vs risk *(default)* | \|delta\| | EV / max-loss | best risk-adjusted sells, top of the band |
| Yield vs risk | \|delta\| | decay yield | fastest premium decay for the risk |
| Vol compensation | IV rank | theta / vega | paid to carry vol risk? |
| Surface edge | IV-vs-fitted residual | EV / max-loss | genuinely rich vs just skew |
| Term structure | DTE | annualized ROC | which expiration |
| Liquidity | spread % | volume (log) | can I actually fill it |

- **Overplotting:** > 60 points ⇒ hexbin with the top-score point drawn on top;
  full points on zoom.
- **Interaction:** hover = tooltip; click = add to Compare + scroll the row into
  view. Touch: tap = tooltip, tap-again = select.
- **`chart ⇄ table`** renders the same data as an accessible table.

### 8.9 Application states

| State | Treatment |
|---|---|
| Snapshot building | Progress bar with stage; last good snapshot still readable. |
| Degraded snapshot | Amber banner: "48/50 names — GOOG, TSLA missing". |
| Ingestion failed | Red banner; serve last good; "next attempt 12:30 ET". |
| Cross-sectional score basis | Info chip: "scores are relative to today's results until 60 days of history accrue". |
| Market closed / weekend | Neutral banner with snapshot age. |
| Zero candidates | "No matches. Nearest: relax Min IV rank 30→22 (+14 rows)." |
| Provider outage | Banner; on-demand refresh disabled with the reason. |
| Not signed in | Saved screens / watchlists / higher quota gated with a sign-in prompt. |

### 8.10 Responsive & accessibility

- **Desktop-first.** ≥ 1024 px: table + side scatter. 640–1024: stacked.
  < 640: **card view** (one candidate per card + expander); scatter simplified to
  the default axes with larger hit targets.
- **WCAG 2.2 AA:** semantic table markup with `scope`; every chart has the
  `chart ⇄ table` equivalent; full keyboard operation (arrow-key cell nav,
  `space` to add to Compare, `/` to focus filter); visible focus rings; contrast
  checked light and dark; motion respects `prefers-reduced-motion`; target sizes
  ≥ 24 px.

### 8.11 Auth timing

Anonymous: the shared snapshot, all filters via URL, CSV/PDF export, 6
refreshes/day, shareable frozen links. **Accounts, from M3.5:** saved named
screens, watchlists, 30 refreshes/day, owned frozen comparisons. Auth = email
magic link + optional Google OAuth (Auth.js); sessions in `httpOnly` cookies.

---

## 9. Data model

Postgres. `numeric(18,6)` prices/greeks/credits, `numeric(9,6)`
probabilities/rates, enums as `text` + `check`, `timestamptz` UTC. `snapshot_row`
is **append-only and immutable**.

### 9.1 Reference & instrument data

```sql
instrument (
  symbol text primary key, name text not null,
  type text check (type in ('equity','etf','index')),
  sector text,
  is_leveraged boolean not null default false,
  is_adr boolean not null default false,
  has_weeklies boolean not null default false,
  settlement text check (settlement in ('physical','cash')) not null,
  exercise_style text check (exercise_style in ('american','european')) not null,
  settlement_time text check (settlement_time in ('am','pm')),
  multiplier integer not null default 100,
  option_volume_20d integer,
  borrow_rate numeric(9,6), hard_to_borrow boolean not null default false,
  updated_at timestamptz not null
)

earnings (
  symbol text primary key references instrument(symbol),
  next_date date not null, confirmed boolean not null, updated_at timestamptz not null
)

iv_history (                         -- values are AS COMPUTED on `date`, never recomputed as the window rolls
  symbol text references instrument(symbol),
  date date not null,
  atm_iv_30d numeric(9,6) not null, hv20 numeric(9,6), hv252 numeric(9,6),
  atm_iv_30d_1y_median numeric(9,6),
  put_skew_25d numeric(9,6),
  iv_rank numeric(6,3), iv_pctile numeric(6,3),
  source text check (source in ('own','orats_backfill','hv_proxy')) not null,
  primary key (symbol, date)
)

rates_curve ( as_of date primary key, points jsonb not null )   -- [{tenorYears, zeroRate}]

corporate_action (
  symbol text references instrument(symbol),
  ex_date date not null,
  kind text check (kind in ('dividend','split','special')) not null,
  value numeric(18,6) not null,
  primary key (symbol, ex_date, kind)
)

metric_reference (
  metric text, window_end date,
  mean numeric(18,6) not null, stddev numeric(18,6) not null,
  n_days integer not null,
  primary key (metric, window_end)
)

raw_payload_manifest (
  run_id text,
  symbol text,                        -- '' for run-level payloads (rates, most_active)
  kind text check (kind in ('chain','underlying','earnings','borrow','dividends','rates','most_active')) not null,
  object_key text not null, bytes bigint not null, fetched_at timestamptz not null,
  pinned boolean not null default false,
  primary key (run_id, symbol, kind)
)
```

### 9.2 Snapshots

```sql
snapshot (
  id uuid primary key,
  run_id text unique not null,
  created_at timestamptz not null,
  snapshot_day date not null,                     -- partition key for snapshot_row
  run_type text check (run_type in ('scheduled','ondemand','replay')) not null,
  status text check (status in ('good','degraded','failed')) not null,
  data_completeness numeric(4,3) not null,
  score_basis text check (score_basis in ('cross_sectional','blended','reference')) not null,
  metric_schema_version integer not null,
  rates_as_of date not null references rates_curve(as_of),
  universe_hash text not null, provider text not null, display_delayed boolean not null,
  filter_defaults jsonb not null, notes text
)

snapshot_row (
  snapshot_id uuid not null references snapshot(id),
  snapshot_day date not null,                     -- denormalised for partitioning
  occ_symbol text not null,
  symbol text not null, expiration date not null, strike numeric(18,6) not null,
  multiplier integer not null, dte integer not null,
  spot numeric(18,6) not null, spot_adj numeric(18,6) not null,
  bid numeric(18,6), ask numeric(18,6), mid numeric(18,6) not null,
  last numeric(18,6), volume integer, open_interest integer,
  quote_as_of timestamptz not null,
  entry_credit numeric(18,6), entry_credit_100 numeric(18,6),
  mid_credit numeric(18,6), slippage_k numeric(4,3),
  iv numeric(9,6), iv_vs_fitted numeric(9,6),
  iv_rank numeric(6,3), iv_pctile numeric(6,3), put_skew_25d numeric(9,6),
  delta numeric(9,6), gamma numeric(12,8),
  theta_day numeric(12,8), daily_decay numeric(12,8), vega numeric(12,8),
  moneyness_pct numeric(9,6), spread_pct numeric(9,6), vol_oi numeric(12,6),
  decay_yield numeric(12,8), theta_vega numeric(12,6),
  breakeven numeric(18,6), be_pct numeric(9,6),
  prob_itm numeric(9,6), pop numeric(9,6), em_distance numeric(9,6),
  csp_capital_100 numeric(18,6), regt_capital_100 numeric(18,6),
  ann_roc numeric(9,6), capital_basis text check (capital_basis in ('csp','regt')),
  ev_100 numeric(18,6), max_loss_100 numeric(18,6),
  ev_to_maxloss numeric(9,6), credit_to_maxloss numeric(9,6),
  sigma_f numeric(9,6), vrp_haircut numeric(6,4),
  score numeric(9,4), score_components jsonb,
  model_caution jsonb not null, assignment_watch boolean not null,
  is_candidate boolean not null, excluded_reason text,
  primary key (snapshot_id, occ_symbol)
) partition by range (snapshot_day);               -- monthly partitions, created ahead by a cron
```

### 9.3 User data

```sql
app_user ( id uuid primary key, email citext unique not null, created_at timestamptz not null )

saved_screen ( id uuid primary key, user_id uuid references app_user(id),
  name text not null, filters jsonb not null, sort text not null, preset text not null,
  created_at timestamptz, updated_at timestamptz )

watchlist_symbol ( user_id uuid references app_user(id), symbol text, primary key (user_id, symbol) )

frozen_comparison ( id uuid primary key, user_id uuid,          -- null = anonymous
  snapshot_id uuid references snapshot(id), occ_symbols text[] not null,
  created_at timestamptz not null, last_viewed_at timestamptz )
  -- anonymous rows GC'd 90 days after last_viewed_at

alert_rule ( id uuid primary key, user_id uuid references app_user(id),
  screen_id uuid references saved_screen(id),
  channel text check (channel in ('email','slack')), target text,
  active boolean not null default true, created_at timestamptz )   -- v1.1
```

### 9.4 Operations

```sql
ingestion_log ( run_id text, symbol text, stage text,
  outcome text check (outcome in ('ok','skipped','failed')) not null,
  error jsonb, duration_ms integer, primary key (run_id, symbol, stage) )

ingestion_run ( run_id text primary key, started_at timestamptz, finished_at timestamptz,
  names_ok integer, names_failed integer, contracts_priced integer,
  iv_solve_failures integer, candidates_found integer,
  greek_xcheck_median_abs_pct numeric(6,3), status text )
```

### 9.5 Indexes, growth, retention

- Indexes: `snapshot_row (snapshot_id, score desc nulls last)`,
  `snapshot_row (snapshot_id, symbol, score desc)` (per-underlying collapse),
  `snapshot_row (occ_symbol, snapshot_day)` (cross-snapshot contract history),
  `snapshot (created_at desc)`, `iv_history (symbol, date desc)`,
  `ingestion_log (run_id)`, `raw_payload_manifest (run_id)`.
- Volume: ~1 200 rows/snapshot × ~23 runs/day ≈ 28 k/day ≈ **7 M rows/year** —
  trivial for Postgres.
- **`snapshot_row` partitioned monthly on `snapshot_day`**; 18 months hot, then
  `pg_dump` cold partitions to object storage and detach.
- Raw payload bundles: ~600 MB/day ⇒ ~240 GB over 400 days; object storage,
  lifecycle-deleted at 400 days unless `pinned`.
- **Reproducibility guarantee:** `snapshot` + its `rates_curve` row + the
  `iv_history` rows as-of `created_at` + `filter_defaults` + `metric_schema_version`
  reproduce every displayed number. A CI test asserts this on a fixture snapshot.
- **Schema evolution:** adding a metric bumps `metric_schema_version`; historical
  rows keep their version; diff and replay are version-aware; backfill optional.

### 9.6 "Why did it drop out?"

Cross-snapshot query on `occ_symbol` (indexed): compare `is_candidate` / `score`
between two snapshots; on `true → false`, evaluate each gate on the newer row to
name the failing condition.

---

## 10. Architecture

### 10.1 Component diagram

```
                    ┌─────────────────────┐
   Vercel Cron ────▶│ /api/ingest/trigger │──enqueue──▶ ┌──────────────┐
   (10:00/12:30/    │ (Next.js, <1s)      │             │  Job queue   │
    15:15 ET)       └─────────────────────┘             │  (Inngest /  │
                                                        │   BullMQ)    │
   User "Refresh" ──▶ /api/snapshots/refresh ─enqueue──▶└──────┬───────┘
                                                               │
                                                     ┌─────────▼──────────┐
                          shared token-bucket ◀──────│  Ingestion worker  │  long-running
                          ┌──────────────┐           │  (Node svc,        │  container
                          │  Redis       │◀──cache──▶ │   Railway/Fly)     │
                          │  (Upstash)   │           │  stages A–H        │
                          └──────────────┘           └───┬───────┬────────┘
                          ┌──────────────┐   ┌───────────▼──┐    │ persist
                          │  Tradier /   │◀──┤  provider    │    │
                          │  CBOE / FMP /│   │  adapters    │    ▼
                          │  Treasury /  │   └──────────────┘  ┌──────────────────────┐
                          │  OCC / ORATS │                     │ Postgres (Neon, PITR)│
                          └──────────────┘                     │ + object storage      │
                                                               │  (snapshots, payloads,│
                                                               │   nightly dumps)      │
                                                               └──────────┬───────────┘
   Browser ◀── CDN edge cache ◀── /api/snapshots/* (Next.js, read-only) ──┘
```

### 10.2 Why a separate worker

Vercel functions cap at 60–300 s; a 50-name snapshot takes minutes. The
**ingestion worker** is a small always-on Node container (~$5–10/mo) running the
queue consumer. Next.js only *enqueues* and *serves*. The queue gives retries,
concurrency control, dedup of concurrent on-demand requests, and a dead-letter.

### 10.3 Options math

`packages/options` — TypeScript, no runtime deps: normal pdf/cdf (`|error| < 1e-9`),
Brent root-finder, BSM price + analytic greeks (theta per §5.5), IV solver with
the §5.3 guards, EV closed form + a Monte-Carlo checker (test-only). ~500 LOC +
~450 LOC tests. CI cross-checks against the `black-scholes` npm package as a
sanity band and runs the finite-difference greek test.

### 10.4 API layer

REST, JSON, cursor-paginated. All params validated with `zod` and **clamped to
the §7 ranges**; unknown params rejected.

| Endpoint | Auth | Note |
|---|---|---|
| `GET /api/snapshots?limit&cursor` | none | list |
| `GET /api/snapshots/latest` | none | redirect to newest `good` |
| `GET /api/snapshots/:id` | none | metadata + `ingestion_run` summary |
| `GET /api/snapshots/:id/candidates?…filters…&sort&cursor` | none | immutable ⇒ edge-cached by id + query |
| `GET /api/snapshots/:id/universe` | none | |
| `GET /api/snapshots/:id/diff/:otherId` | none | |
| `GET /api/contracts/:occSymbol/history` | none | across snapshots |
| `POST /api/snapshots/refresh` | optional | rate-limited; enqueues; returns job id |
| `POST /api/snapshots/:id/freeze` · `POST /api/comparisons` | optional | shareable id |
| `GET/POST/PUT/DELETE /api/screens` · `/api/watchlist` | required | |
| `POST /internal/ingest/run` | HMAC secret, constant-time compare, IP allowlist | worker only |

### 10.5 Testing strategy

| Layer | What |
|---|---|
| Unit | options math vs golden set (`1e-6`); **finite-difference greek bump < 0.5 %**; every metric formula; fill model; `z_ref`; cold-start blend. |
| Property | monotonicity, bounds, put-call parity, IV round-trip, `tradingCalendar` across DST transitions. |
| Contract | each provider adapter vs recorded fixtures; a nightly live smoke on 2 symbols. |
| Integration | full pipeline vs a mock provider → assert completeness, candidate count, no NaNs, cash-settled carve-outs. |
| Golden snapshot | fixed raw payloads → expected candidate ordering + top-10 scores (regression). |
| Reproducibility | rebuild every number in a fixture snapshot from stored inputs; assert equality. |
| E2E (Playwright) | load latest → filter → open Compare → freeze → diff, on every preview deploy. |
| Load (k6) | read API at 100 rps sustained; p95 < 300 ms. |

### 10.6 CI/CD & migrations

GitHub Actions: lint + typecheck + unit + property + integration on every PR;
`drizzle-kit` migration-diff check; preview deploy + E2E on the preview; merge to
`main` → migrations behind a manual gate → promote. Seed script (one fixture
snapshot + reference data) for local dev.

### 10.7 Observability & alerting

- **Errors:** Sentry (web + worker).
- **Metrics:** the §4.4 counters to Grafana Cloud (free tier). Dashboards: run
  duration, completeness, IV-solve rate, greek cross-check, candidate count, API
  latency, refresh-queue depth.
- **Alerts:** ingestion `failed`; completeness < 40; run > 12 min; greek
  cross-check > 5 %; two consecutive scheduled runs missed (healthchecks.io
  dead-man's switch); read-API 5xx > 1 %.

### 10.8 Security

- `/internal/*` + ingest trigger: HMAC bearer, constant-time compare, IP
  allowlist.
- Public read endpoints: anonymous, edge IP rate-limit 60 req/min.
- Auth: Auth.js; `httpOnly`+`Secure`+`SameSite=Lax` cookies; CSRF token on
  mutations.
- Input: `zod` everywhere; filter params clamped; parameterized queries only.
- Headers: strict CSP, HSTS, `X-Content-Type-Options`, `Referrer-Policy`,
  `Permissions-Policy`.
- Secrets: platform env store; quarterly rotation; never in the client bundle.
- Supply chain: Dependabot; `npm audit` gate in CI; lockfile-only installs; SBOM.
- **Pre-launch:** an external dependency audit + a focused security review of the
  ingest secret, the filter-param surface, and auth (M6.8).

### 10.9 Backup & disaster recovery

- Postgres: Neon **PITR**, target **RPO ≤ 5 min, RTO ≤ 1 h**. Nightly logical
  `pg_dump` to versioned object storage, retained 30 days.
- Object storage: versioning + lifecycle rules; cross-region replication of
  snapshot JSON and pinned payloads.
- A recovery runbook, drilled once per quarter (part of M6.8), covering: restore
  from PITR, replay the day's snapshots, verify the reproducibility test.

### 10.10 Cost estimate (monthly, ballpark)

| Item | $ |
|---|---|
| Tradier market data (funded account) | 10 |
| FMP earnings (paid tier) | 20–30 |
| Neon Postgres (with PITR) | 19–39 |
| Ingestion worker (Railway / Fly) | 5–10 |
| Redis (Upstash) | 0–10 |
| Object storage (payloads + dumps, ~250 GB) | 6–10 |
| Vercel (Pro if needed) | 0–20 |
| Sentry + healthchecks + Grafana (free tiers) | 0–26 |
| ORATS 1-year IV backfill | ~150 **one-time** |
| **Recurring total** | **~$70–155** |

### 10.11 Scaling

The shared snapshot is immutable and edge-cached ⇒ N readers cost ~nothing.
On-demand refresh is the risk: a **global 10-min cooldown** + **per-user quota** +
**job dedup** cap extra ingestions at ~1 per 10 min regardless of user count. If
load grows: read replicas for `/contracts/:occSymbol/history`, and pre-computed
popular filter combinations.

---

## 11. Risks & edge cases

Likelihood (L) / Impact (I): H/M/L.

| Risk | L | I | Mitigation | Revisit trigger |
|---|---|---|---|---|
| **VRP-haircut assumption** — the EV ranking depends on `σ_f` being a fair realized-vol forecast; a wrong haircut biases every EV | M | H | Forecast-free sort modes (§6.1); show `σ_f` / `vrp_haircut` and an EV-sensitivity band in the row expander; **calibrate monthly** against the realized-performance tracker (v1); conservative default haircut | PoP calibration drifts > 5 pp |
| **Model risk** — BSM mis-values high-skew / pre-dividend / hard-to-borrow names (the high-volume universe), surfacing false edges | H | H | Discrete dividends (§3.5); borrow flag + score penalty; **leave-one-out** IV-vs-fitted residual as the edge signal instead of raw IV; `model_caution` chips; v1.1 binomial reprice | Calibration drift; user reports |
| **Selection bias** — "most active" is news/momentum-driven; screening puts on names active *because they're falling* | H | M | Universe tab shows 5-day return & distance-to-52w-low; `assignment_watch`; diversification is opt-in and labelled; "screening, not timing" copy | Usability findings |
| **IV-rank degeneracy** after a vol-regime shift (pins 0/100 for months) | M | M | User selects IV rank **or** IV percentile as the driver (percentile recommended); both shown | — |
| **`metric_reference` cold start** — no reference distribution on day 1 | H (early) | M | Cross-sectional robust z until 60 days, blended to 252 (§6.3); `score_basis` badged | 252-day mark reached |
| **Rate-limit infeasibility** for a full run | M | H | M0 spike; per-expiration chain calls; concurrency + shared bucket; streaming fallback | Run time > 12 min |
| **Vercel timeout** on ingestion | H if unaddressed | H | Separate worker (§10.2) — designed out | — |
| **Stale-mid IV** in fast markets → confident but wrong greeks | M | M | Freshness window (default 180 s, 45 s fast-market); spread cap; `quote_as_of` shown; snapshot `status` | Cross-check spike |
| **Point-in-time errors** in the backtest (earnings, splits, index membership as-known-then) | M | H | Replay bundles include earnings/borrow/dividends (§4.5); `corporate_action` table | Backtest work starts |
| **DST / expiration-boundary bugs** — DTE miscount across DST; expiry as midnight vs 16:00 ET; AM-settled index off-by-one | M | M | One tested `tradingCalendar` module; property tests across DST; expiration instant per §2.1; AM-settled DTE labelled | — |
| **Provider SPOF** (Tradier outage) | M | M | CBOE-delayed fallback behind the same interface; serve last good snapshot | Outage > 1 h |
| **"Example basket" reads as advice** — it names a specific portfolio | M | H | Opt-in; labelled *example construction*; no sizing; requires the user's own filters; §11.1 disclaimer; **legal review before monetization** | Before monetization |
| **Data-cost creep** — free tiers won't cover 50 names of earnings + refreshes | M | L | Paid FMP tier budgeted from M2; 24 h earnings cache | Approaching a tier limit |
| **Regulatory** — a ranked "sell this put" list, if monetized, edges toward investment advice | L | H | Prominent "screening tool, not advice" on every screen; no "recommended trade" language; legal review before charging | Before monetization |
| **Redistribution licensing** for real-time data | M | H | `DISPLAY_DELAYED` mode from M1; confirm terms before public launch | Before public launch |
| **Snapshot false precision** — user acts hours after the 10:00 run | M | M | Three scheduled runs/day; snapshot age always visible; on-demand refresh | — |
| **Solo-developer bus factor** | M | M | This document; tests as executable spec; infra-as-code; a runbook | Team changes |

### 11.1 Model limitations (in-app "Model & method" page)

BSM assumptions and where they break (skew, discrete dividends, borrow, American
early exercise); what each `model_caution` flag means; that `P(ITM)` is
risk-neutral while EV / PoP use a forecast distribution with a variance-risk-
premium haircut; that EV ranking inherits the haircut assumption and the two
forecast-free sorts do not; and that none of it predicts the future.

---

## 12. Milestones

One experienced full-stack developer. Several milestones parallelise (noted), so
the ~29 dev-weeks below is **≈ 6 calendar months**.

### 12.0 M0-parallel spikes (½–1 wk, first)

| Spike | Exit criterion |
|---|---|
| Provider rate-limit feasibility | a real 50-name chain pull completes < 8 min within Tradier limits |
| BSM validation | own greeks match the golden set to `1e-6`, the finite-difference bump to < 0.5 %, and vendor greeks to < 2 % |
| Worker runtime | a queued job runs > 5 min on the chosen host and persists to Postgres |

### 12.1 Milestones

| # | Deliverable | Est. | Acceptance |
|---|---|---|---|
| **M0** | `packages/options` (BSM + corrected theta + IV + EV + all §5.9 tests); `MarketData` interface + CBOE adapter; one-name pipeline to console | 1.5 wk | golden-set + finite-difference + EV-vs-MC tests pass; one name prints a full metric row |
| **M1** | Full pipeline A–H for 50 names → `snapshot` in Postgres + JSON; rates bootstrap; **replay mode + payload bundles**; `DISPLAY_DELAYED`; **walking-skeleton deploy** | 2.5 wk (M0) | a scheduled run yields a `good` snapshot ≥ 46 names; `--asOf` replays a past day identically; deployed URL serves it |
| **M1.5** *(∥ M2)* | self-accumulate `σ30`; nightly greek cross-check in CI; Sentry + dead-man's switch | 0.5 wk | IV samples land daily; alert fires on a simulated missed run |
| **M2** | schema complete (incl. partitions, `raw_payload_manifest`, `schema_version`); ORATS 1-year backfill; IV rank/percentile; leave-one-out smile fit + skew + residual | 2 wk (M1) | IV rank is real for all 50; residual computed; reproducibility test passes |
| **M2.5** | `metric_reference` job + cross-sectional cold-start fallback + blend; composite score + NULL handling | 1 wk (M2) | score present for every priced candidate; `score_basis` transitions correctly in tests |
| **M3** | Candidates table + column presets + full filter panel (incl. order size, capital, earnings, caution flags) + URL state + zero-result UX + "why isn't X here?" + CSV/JSON export | 3 wk (M2.5) | every §7 filter works and is URL-encoded; explainer names the right gate |
| **M3.5** *(∥ M4)* | accounts (Auth.js) + saved screens + watchlists | 1.5 wk (M3) | a saved screen round-trips; watchlist filter works |
| **M4** | Scatter (all presets, hexbin, fixed colour domain, chart⇄table) + row-expander probability cone + table cross-highlight | 3 wk (M3) | scatter table-view matches; cone integrates to EV; colour stable across filter changes |
| **M4.5** | **Compare tab** + tray + transposed view + best-in-row + overlaid cones + PDF/CSV export | 2 wk (M4) | tray holds 6; PDF renders; frozen comparison link works for an anonymous user |
| **M5** | Freeze + Snapshots tab + diff (version-aware) + frozen shareable links | 1.5 wk (M4.5) | diff names added/dropped/moved with the drop-out reason |
| **M6** | Universe tab; glossary with pinned examples; "Model & method" page; application states; responsive card view; **WCAG 2.2 AA** pass; read API + docs; first-run tour | 3 wk (M5) | Axe/Lighthouse a11y ≥ 95; keyboard-only walkthrough; API returns paginated candidates |
| **M6.5** | private beta (5–10 target users); **realized-performance / paper-trade tracker live**; PoP + credit calibration harness collecting data | 2.5 wk (M6) | 10 users onboarded; tracker logging trades; first calibration report generated |
| **M6.8** *(∥ M6.5 tail)* | external dependency audit + focused security review + **DR drill** + k6 load test | 1.5 wk | security findings triaged; DR runbook executed end-to-end; p95 < 300 ms at 100 rps |
| **M7** | caching hardening; licensing / `DISPLAY_DELAYED` finalised; production cutover; on-call runbook | 1.5 wk (M6.8) | delayed-mode verified; runbook covers every §10.7 alert |

---

## 13. Roadmap beyond v1

### 13.1 v1.1 (fast follow)

1. **Alerts** — email/Slack when a saved screen produces a new contract over a
   score/EV threshold (`alert_rule` modelled).
2. **Binomial reprice** for `model_caution` / `assignment_watch` contracts.
3. **Roll assistant** — for an open short put, compare rolling out/down.
4. **Days-since-earnings analytics** and an IV-crush timing view.
5. **SVI smile fit** replacing the quadratic.

### 13.2 v2

6. **Put credit spreads** — defined-risk variant of the same screen.
7. **The wheel** — covered-call screen for assigned stock; unified position view.
8. **Broker integration** — one-click order staging (Tradier).
9. **Section 1256 / tax-lot** handling for index options.
10. **Screen backtester** — on replay mode; historical P&L with transaction costs.
11. **Snapshot sharing** — public permalink with an OG preview.

### 13.3 Someday

Multi-account, portfolio-greek aggregation, mobile app, ratio/diagonal
structures, a public data API tier.

---

## 14. Open decisions

| # | Decision | Default if unresolved |
|---|---|---|
| 1 | Queue: Inngest (managed) vs BullMQ (self-host on Redis) | Inngest for M1 speed; revisit on cost |
| 2 | Index options in v1 or defer | Include, flagged (§1.4) |
| 3 | Slippage factor `k` default | 0.30, user-adjustable |
| 4 | VRP haircut on `σ_f` | 0.90, config; auto-calibrated monthly from M6.5 |
| 5 | Scheduled run times | 10:00 / 12:30 / 15:15 ET |
| 6 | EV discounting | undiscounted expected P&L at expiry; PV-at-`μ` behind a flag |
| 7 | `metric_reference` cold start | cross-sectional robust z < 60 d, blend to 252 d |
| 8 | Reg-T floor base | `K` (broker-conservative); config `S` for the FINRA minimum |
| 9 | Charting library | Visx (composable, fits the scatter presets) |

---

*This document describes a screening tool, not a trading recommendation. Selling
puts — cash-secured or on margin — exposes the seller to substantial losses if
the underlying falls sharply. Any deployment must display delayed-data notices
where required and a clear "not investment advice" disclaimer on every screen.*
