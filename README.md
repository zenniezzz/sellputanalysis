# Put-Sell Screener

A daily screener for put-selling candidates. Full spec:
[`put-sell-screener-plan.md`](./put-sell-screener-plan.md) (v3.0).

## Status — M0 → M6.8 (see plan §12)

| Deliverable | State |
|---|---|
| `@pss/options` — BSM + greeks, IV solver, forecast EV, fill model, IV rank/percentile + HV proxy, smile fit + LOO residual + σ30 + put skew, composite score (3 presets, z_ref blend, NULL renorm, fixed colour domain), **P&L probability profile (`pnlProfile` — payoff × forecast density, integrates to `ev100`)** | ✅ full §5.9 suite |
| `@pss/market-data` — `MarketData`/`RatesSource` + `Result<T>`; CBOE adapter; **par→zero bootstrap**; Stooq HV; **record/replay wrappers** | ✅ |
| `@pss/pipeline` — stages A–H (`runSnapshot`): universe + filters, strike pre-filter, concurrency pool, DST-aware DTE, stage F smile/σ30/skew/IV-rank, **stage G composite score**, per-contract pricing/gating, cash-settled carve-out, status/completeness, greek cross-check, σ30 + metric history samples | ✅ mock + live |
| `@pss/store` — `SnapshotStore` · `IvHistoryStore` · `MetricReferenceStore` · **`AuthStore`** (Auth.js adapter data) · **`UserDataStore`** (saved screens + watchlists) — JSON + Postgres each; `FilePayloadStore` replay bundles; ORATS importer | ✅ |
| `@pss/observability` — Sentry-if-DSN error reporting; healthchecks.io-style heartbeat | ✅ |
| `@pss/screen` — filter schema + URL codec (round-trip, clamp, band-repair) · `applyScreen` (live re-filter over persisted rows, per-basis ROC/capital) · `explainSymbol` ("why isn't X here") · nearest-match relaxations · CSV export | ✅ |
| `@pss/screener-cli` — `cli:one-name`, `cli:run-snapshot` (+`--as-of`, `--preset`), `cli:greek-xcheck` | ✅ |
| `@pss/api` — framework-free read server | ✅ walking skeleton |
| **`@pss/web` — Next.js 15 app**: 5-tab UI (Candidates / Universe / Compare / Snapshots / Trades). Candidates: sortable expandable table, full §7 filters + URL state, nearest-match, "why isn't X here?", CSV/JSON, scatter (6 presets, chart⇄table, cross-highlight), row-expander P&L cone + log-paper-trade. Universe: per-name rollup → click to filter. Compare: tray → transposed table (best-in-row) + overlaid cones + freezable `/compare/<id>` + CSV/print-PDF. Snapshots: bookmarks, Freeze, A↔B diff. Trades: paper-trade log + live calibration. `/glossary` · `/method` · `/docs`. Auth.js accounts + saved screens + watchlists | ✅ `npm run web` |
| M6 | **Universe tab** (per-name rollup: put/call volume, σ30, IV rank, skew, earnings, candidate counts; click → filter) · **`/glossary`** (18 entries) · **`/method`** (BSM limits, P(ITM) vs PoP, the VRP haircut) · **`/docs`** (read API) · status banners (degraded / stale / score-basis) · first-run bar · a11y (skip link, roles, `aria-sort`, focus rings, reduced-motion) · `/api/screen` `?limit`/`?cursor` pagination |
| M6.5 | **paper-trade tracker** — "Log paper trade" from the row expander freezes the modeled credit / PoP / EV; **Trades tab** with open/closed lists + close flow + **live calibration report** (PoP by decile bucket with binomial CI, credit fill-bias, EV realized-vs-modeled); `cli:calibration`; Beta-feedback link |
| CI | `ci.yml` (typecheck ×2 + 230 tests + `npm audit --omit=dev --audit-level=high` gate + `next build`) · `nightly.yml` (live greek cross-check) · `dependabot.yml` (weekly npm + Actions) |
| M6.8 | **Security**: [`SECURITY.md`](./SECURITY.md) — upgraded Next 14→**15.5**/React 19 and Vitest 1→4 to clear a critical + 5 high `npm audit` findings (0 vulnerabilities now); added write-endpoint input validation ([`app/lib/validate.ts`](apps/web/app/lib/validate.ts)); edge rate limiting (60 req/min/IP, [`middleware.ts`](apps/web/middleware.ts)). **Load test**: `k6/screen.js` — p95 went 41 s → **4.0 ms** at 100 rps after fixing a re-parsed-snapshot-per-request bottleneck, an O(rows×filters) relaxation search that ran unconditionally, and an unused-but-serialized `excludedBy` payload (details + numbers in SECURITY.md). **DR**: drilled backup→loss→restore→reproducibility-replay end to end; procedure + drill log in [`docs/runbook.md`](docs/runbook.md). |
| ORATS 1-year IV backfill purchase · private-beta onboarding | ⏳ external (importer + tracker ready) |
| M7 (caching hardening · `DISPLAY_DELAYED` finalize · production cutover · on-call runbook) | ⏭ next |

Verified on live CBOE data (10 names): `status=good`, 2,840 contracts priced,
0 IV failures, greek cross-check **1.11%** median abs (SLO < 2%), 33 candidates
ranked by composite score (`balanced/cross_sectional`, IV-rank term dropped +
renormalized while history accrues), per-name skew + LOO residuals populated;
`--as-of` replay reproduces all 2,840 rows (scores included) identically.
`cli:greek-xcheck` (6 names, live): median **1.37%**, pass.

The put-theta formula is the **v3.0-corrected** one (`r`/`q` terms were
sign-flipped in plan v2.0); `packages/options/src/bsm.test.ts` carries the
finite-difference regression guard and a deep-ITM positive-theta check.

## Layout

```
packages/
  options/        pure math — no I/O, no deps (dev-only cross-check vs `black-scholes`)
  market-data/    provider adapters behind one interface; record/replay
  pipeline/       runSnapshot — stages A–H, smile fit, IV rank
  store/          snapshot + IV-history + metric-reference persistence (JSON / Postgres)
  observability/  error reporting + heartbeat (opt-in via env)
  screen/         filter schema, URL codec, applyScreen (+watchlist ctx), explainSymbol, CSV
  compare/        transpose N contracts × metrics, best-in-row, CSV
  diff/           diffSnapshots — added / dropped (+reason) / rank moves
  tracker/        paper-trade model, realized P&L, PoP/credit/EV calibration
apps/
  screener-cli/   one-name · full-snapshot (+replay) · greek-xcheck
  api/            read-only snapshot server (walking skeleton)
  web/            Next.js 15 screener UI + Auth.js
k6/               load test — see docs/runbook.md
```

Security posture: [`SECURITY.md`](./SECURITY.md). Backup/DR + load-test
procedure: [`docs/runbook.md`](./docs/runbook.md).

Monorepo via npm workspaces. Packages resolve as `@pss/*`; `tsx` and Vitest run
the TypeScript sources directly (no build step yet).

## Commands

```bash
npm install
npm test                              # 230 tests (+1 Postgres test, skipped without DATABASE_URL)
npm run typecheck

# one contract at a time
npm run cli:one-name -- AAPL --dte 35 --delta-lo 0.15 --delta-hi 0.35
npm run cli:one-name -- SPX --dte 35            # cash-settled index path

# full pipeline → snapshot in .data/, replay bundle + iv/metric history alongside
npm run cli:run-snapshot -- --names SPY,QQQ,AAPL,NVDA,MSFT
npm run cli:run-snapshot -- --limit 30 --preset conservative   # first 30 of the built-in universe
npm run cli:run-snapshot -- --as-of 2026-09-02-1000-scheduled  # replay a bundle

# read server for the latest snapshot
npm run api                                    # http://localhost:8787

# the Next.js screener UI (reads .data/ or DATABASE_URL)
cp apps/web/.env.example apps/web/.env.local && $EDITOR apps/web/.env.local   # set AUTH_SECRET
npm run web                                    # http://localhost:3000
npm run cli:calibration -- --user <id>         # paper-trade calibration report
```

Sign in with the **Dev login** provider (any email, dev only) or the **Email**
provider — the magic link is printed to the server console and appended to
`.data/auth/magic-links.log`. Saved screens and watchlists persist under
`.data/auth` / `.data/userdata` (or Postgres when `DATABASE_URL` is set).

Set `DATABASE_URL` to route the store and API through Postgres instead of
`.data/` JSON files (applies `packages/store/src/pg/schema.sql`).

## M0 caveats (resolved in later milestones)

- **Dividends:** CBOE gives no schedule, so `q = 0` and `S_adj = S`. M2 wires a
  discrete dividend source (plan §3.5).
- **σ30:** proxied by the chosen expiration's ATM IV — no surface fit / variance
  interpolation yet (plan §5.6, M2).
- **HV20 / HV252:** Stooq now serves a bot-check page instead of CSV, so the CLI
  usually shows `—` and `forecastVol` renormalizes onto σ30. Real HV comes from
  the ORATS backfill / vendor feed (plan §3.1, M2). The math is unaffected — see
  the `annualizedVol` unit tests.
- **Rates:** a static 2026-08-29 Treasury snapshot; M1 wires the live feed +
  bootstrap.
- **IV rank:** real once ≥ 60 self-accrued σ30 samples exist per name; until then
  the HV-percentile proxy or null, with `model_caution.ivRankProxy` set. Import a
  1-year ORATS export via `parseOratsIvHistoryCsv` to remove the cold start.
- **Composite score:** live. `scoreBasis` starts `cross_sectional` (robust
  median/MAD z), blends toward `reference` as `MetricReferenceStore` accrues
  ~60–252 days; null metrics are dropped and positive weights renormalized.
- **Universe:** a curated ~65-name list stands in for the OCC daily volume file
  (plan §3.1); leveraged/inverse ETPs filtered out, names ranked by in-window
  put volume.
- **Cloud deploy:** the `@pss/api` read server is the walking skeleton; the
  Next.js app + real deploy come with M3.

## Node

`.nvmrc` pins **20** (LTS "iron"). `nvm use` in the repo root. Node 20 is
required (`engines`); CI runs on 20.
