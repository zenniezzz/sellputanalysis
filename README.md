# Put-Sell Screener

A daily screener for put-selling candidates. Full spec:
[`put-sell-screener-plan.md`](./put-sell-screener-plan.md) (v3.0).

## Status — M0 → M2.5 (see plan §12)

| Deliverable | State |
|---|---|
| `@pss/options` — BSM + greeks, IV solver, forecast EV, fill model, IV rank/percentile + HV proxy, smile fit + LOO residual + σ30 + put skew, **composite score (3 presets, z_ref blend, NULL renorm, fixed colour domain)** | ✅ full §5.9 suite |
| `@pss/market-data` — `MarketData`/`RatesSource` + `Result<T>`; CBOE adapter; **par→zero bootstrap**; Stooq HV; **record/replay wrappers** | ✅ |
| `@pss/pipeline` — stages A–H (`runSnapshot`): universe + filters, strike pre-filter, concurrency pool, DST-aware DTE, stage F smile/σ30/skew/IV-rank, **stage G composite score**, per-contract pricing/gating, cash-settled carve-out, status/completeness, greek cross-check, σ30 + metric history samples | ✅ mock + live |
| `@pss/store` — `SnapshotStore` (JSON / PG + `schema.sql`); `IvHistoryStore`; **`MetricReferenceStore`** (rolling z_ref distributions); `FilePayloadStore` replay bundles; ORATS backfill importer | ✅ |
| `@pss/observability` — Sentry-if-DSN error reporting; healthchecks.io-style heartbeat | ✅ |
| `@pss/screener-cli` — `cli:one-name`, `cli:run-snapshot` (+`--as-of`), `cli:greek-xcheck` | ✅ |
| `@pss/api` — framework-free read server: `GET /`, `/api/snapshots/latest`, `/:id` | ✅ walking skeleton |
| CI | `ci.yml` (typecheck + 137 tests) · `nightly.yml` (live greek cross-check) |
| ORATS 1-year IV backfill purchase · Next.js app + cloud deploy | ⏳ M2 (data purchase) / M3 |

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
  store/          snapshot + IV-history persistence (JSON / Postgres); replay bundles
  observability/  error reporting + heartbeat (opt-in via env)
apps/
  screener-cli/   one-name · full-snapshot (+replay) · greek-xcheck
  api/            read-only snapshot server (walking skeleton)
```

Monorepo via npm workspaces. Packages resolve as `@pss/*`; `tsx` and Vitest run
the TypeScript sources directly (no build step yet).

## Commands

```bash
npm install
npm test                              # 112 tests (+1 Postgres test, skipped without DATABASE_URL)
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
```

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
  Next.js app + real deploy come with M3 (needs Node 20).

## Node

`.nvmrc` pins 18.18.2 (the box's version). Bump to 20 LTS before the Next.js app
lands in M1.
