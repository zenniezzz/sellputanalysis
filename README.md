# Put-Sell Screener

A daily screener for put-selling candidates. Full spec:
[`put-sell-screener-plan.md`](./put-sell-screener-plan.md) (v3.0).

## Status — M0 (see plan §12)

| Deliverable | State |
|---|---|
| `@pss/options` — BSM price + analytic greeks, IV solver, forecast-measure EV, fill/cost model, derived metrics | ✅ with the full §5.9 test suite |
| `@pss/market-data` — provider-agnostic `MarketData` interface + `Result<T>` error model; CBOE delayed adapter; static Treasury rate curve; Stooq HV helper | ✅ |
| `@pss/screener-cli` — one-name pipeline → console | ✅ (`npm run cli:one-name -- AAPL`) |

The put-theta formula is the **v3.0-corrected** one (`r`/`q` terms were
sign-flipped in plan v2.0); `packages/options/src/bsm.test.ts` carries the
finite-difference regression guard and a deep-ITM positive-theta check.

## Layout

```
packages/
  options/        pure math — no I/O, no deps (dev-only cross-check vs `black-scholes`)
  market-data/    provider adapters behind one interface
apps/
  screener-cli/   M0 console pipeline
```

Monorepo via npm workspaces. Packages resolve as `@pss/*`; `tsx` and Vitest run
the TypeScript sources directly (no build step yet).

## Commands

```bash
npm install
npm test                              # 82 tests
npm run typecheck
npm run cli:one-name -- AAPL --dte 35 --delta-lo 0.15 --delta-hi 0.35
npm run cli:one-name -- SPX --dte 35  # cash-settled index path (Reg-T 0.15 factor)
```

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
- **IV rank, composite score, persistence:** not in M0 (M2 / M2.5 / M1).

## Node

`.nvmrc` pins 18.18.2 (the box's version). Bump to 20 LTS before the Next.js app
lands in M1.
