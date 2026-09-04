# Operations runbook

Covers backup/disaster-recovery (plan §10.9), the k6 load-test procedure
(M6.8), on-call alerting (plan §10.7), and the production cutover checklist
(M7).

## 1. Backup & disaster recovery

### 1.1 What's backed up

| Store | Production (`DATABASE_URL` set) | Dev / small-scale (`.data/` JSON) |
|---|---|---|
| Snapshots, rows, IV/metric history, comparisons, bookmarks | Postgres (Neon) | `.data/snapshots`, `.data/iv-history`, `.data/metric-samples.json`, `.data/frozen-comparisons.json` |
| Accounts, saved screens, watchlists, paper trades | Postgres (Neon) | `.data/auth`, `.data/userdata`, `.data/paper-trades.json` |
| Raw provider payloads (replay bundles) | Object storage | `.data/bundles/<runId>/` |

**Targets (plan §10.9): RPO ≤ 5 min, RTO ≤ 1 h.**

### 1.2 Production (Postgres/Neon) — procedure

1. **Continuous**: Neon PITR is enabled on the project (branch-based restore to
   any point in the retention window) — this is what delivers the ≤5 min RPO.
2. **Nightly**: `pg_dump --format=custom` to versioned object storage
   (lifecycle: 30-day retention), as a restore path independent of the Neon
   control plane.
3. **Object storage** (snapshot JSON + pinned payloads): versioning +
   cross-region replication at the bucket level.
4. **To restore**:
   - Neon PITR: create a new branch at the target timestamp (console or
     `neonctl branches create --parent <branch> --timestamp <iso>`), point
     `DATABASE_URL` at it, verify with the read-only checks in §1.4, then
     promote (swap the connection string) — this is the ≤1 h RTO path.
   - From nightly dump (if Neon itself is unreachable): provision a fresh
     Postgres instance, `pg_restore` the latest dump, apply
     `packages/store/src/pg/schema.sql` if the dump predates a migration,
     point `DATABASE_URL` at it.
5. **Re-ingest the gap**: replay any snapshot runs between the dump/PITR point
   and the incident from their recorded payload bundles
   (`npm run cli:run-snapshot -- --as-of <runId>`) rather than re-pulling from
   the live provider, so the recovered history matches what was actually shown.

### 1.3 Dev / small-scale (`.data/` JSON) — procedure

The JSON-file store has no PITR; back it up as a directory.

```bash
# backup (cron nightly, or before any risky operation)
tar -czf pss-data-$(date -u +%Y%m%dT%H%M%SZ).tgz .data

# restore
rm -rf .data
tar -xzf pss-data-<timestamp>.tgz
```

### 1.4 Post-restore verification (both paths)

Run every time, restore isn't "done" until this passes:

1. **Reads work**: `curl -s localhost:3000/api/snapshots` returns the expected
   run count; `/api/screen` returns 200 with a non-empty `visible` where
   expected.
2. **Reproducibility**: replay the most recent snapshot's recorded payload
   bundle and confirm it reproduces byte-identical rows —
   `npm run cli:run-snapshot -- --as-of <runId>` twice, then diff the two
   `rows` arrays (they must be deep-equal; scores included). This is the
   strongest signal that the restored store, the pinned payloads, and the
   pipeline math all still agree with each other.
3. **No silent gaps**: `GET /api/snapshots/diff?a=<lastKnownGoodRunId>&b=<newestRunId>`
   — expect only the moves you'd expect from the elapsed time, not a
   `metricSchemaChanged` flag or a mass `dropped` list (either would mean the
   restore landed on the wrong point in time or a stale schema).

### 1.5 Drill log

**2026-09-04, dev JSON store:**

| Step | Result |
|---|---|
| Backup `.data/` (`tar czf`) | 14 MB, **1 s** |
| Simulate total loss (`rm -rf .data`) | confirmed gone (`ls .data` → no such file) |
| Restore (`tar xzf`) | **<1 s** |
| Integrity check | SHA-256 of every `snapshot/**/*.json` before vs. after: **identical** |
| Functional check | `/api/screen` and `/api/snapshots` both 200 against the restored store |
| Reproducibility | replayed the same payload bundle twice post-restore; `rows` and `universe` deep-equal (1,999 rows each run), `universeHash` matched |

**2026-09-04, Postgres (local instance — Neon PITR itself not yet
provisioned; this drills the `pg_dump`/`pg_restore` fallback path in §1.2
step 2/4, which is identical regardless of who's hosting the server):**

| Step | Result |
|---|---|
| `cli:run-snapshot` against `DATABASE_URL`, then sign in, add a watchlist, freeze a bookmark, save a screen, log a paper trade through the running app | all succeeded (§4 has the cutover checklist this rehearses) — surfaced the bugs in [SECURITY.md](../SECURITY.md#m7-production-cutover-findings) |
| `pg_dump --format=custom` | 250 KB, **0.53 s** |
| Simulate total loss (`dropdb`) | gone |
| Restore (`createdb` + `pg_restore`) | **0.35 s** |
| Integrity check | `snapshot_row` count identical (1,177); the paper trade's `occ_symbol`/`expiration` byte-identical |
| Functional check | app restarted against the restored DB: `/api/screen` 200, `/api/health` reports `store: "postgres"` with the correct snapshot, the signed-in user and their watchlist are still there |

Result: **RTO ≈ 1 s** at this data volume on both paths (dominated by the
dump/tar tool, not anything store-specific) — the ≤1 h target has enormous
headroom here; the real number to watch is Neon PITR's actual promote time
once there's production volume and a real network hop involved. No gaps
found in the *mechanics* of either backup path — see the M7 findings for the
gaps that *were* found in the underlying store code. Next drill: quarterly,
against the real Neon project once provisioned, or immediately after any
schema migration.

## 2. Load test (M6.8 acceptance: p95 < 300 ms @ 100 rps)

```bash
brew install k6   # once
npm run web:build
(cd apps/web && npx next start -p 3100)   # a prod build, not `next dev` — a
                                           # different port than `npm run web`'s 3000
BASE_URL=http://localhost:3100 k6 run k6/screen.js
```

`k6/screen.js` drives `/api/screen` and `/api/universe` at a constant 100
iterations/sec for 60 s (each simulated client on its own `X-Forwarded-For` so
the edge rate limiter doesn't fire), then a 10 s single-IP burst to confirm
the limiter itself responds. Thresholds: `p(95)<300ms` on the 100 rps
scenario, `>99%` check pass rate.

**Result (2026-09-04, this machine):** p95 **4.0 ms**, 100% pass — see
[SECURITY.md](../SECURITY.md#load-test-findings) for what got it there
(it started at p95 ≈ 41 s before three fixes) and re-run against a real
staging deployment before trusting this number for capacity planning; a
laptop under variable background load is not a substitute for that.

## 3. On-call — alert → response (plan §10.7)

Six alerts. The first four are computed from a single ingestion run's own
recorded fields ([`evaluateRunAlerts`](../packages/observability/src/alerts.ts),
called from `cli:run-snapshot` after every run — see it fire in the console
output and, once `SENTRY_DSN` is set, as a Sentry event per alert); the last
two aren't run-level and need the mechanisms noted below.

| # | Alert | Threshold | Detected today via | Response |
|---|---|---|---|---|
| 1 | Ingestion failed | `meta.status === 'failed'` | `evaluateRunAlerts` → `ingestion_failed` (critical); `heartbeat('snapshot', 'fail')` | Read the run's `logs` (stage/outcome/error per name) via `GET /api/snapshots` + the CLI's own stdout. Common cause: stage A (rates) or a provider-wide outage — check §10.11 "Provider SPOF" mitigation (CBOE-delayed fallback). Re-run `cli:run-snapshot` once the cause is fixed; the next scheduled run will also retry on its own. |
| 2 | Completeness < 40% | `meta.dataCompleteness < 0.4` | `evaluateRunAlerts` → `completeness_low` (critical) | Check `run.namesOk` vs `namesFailed` and the per-name `ingestion_log` entries — usually a burst of per-name chain-fetch failures (rate limiting, a bad symbol). The snapshot still saves (marked `failed`/`degraded` per the completeness bands in `run.ts`) so nothing silently ships half-populated as "good". |
| 3 | Run > 12 min | `finishedAt − startedAt` | `evaluateRunAlerts` → `run_slow` (warning) | Check provider latency / rate-limit backoff first (§11 "Rate-limit infeasibility" risk). If it's a trend rather than a one-off, that's the trigger in §11 to revisit concurrency/chain-call batching. |
| 4 | Greek cross-check > 5% | `run.greekXcheckMedianAbsPct` | `evaluateRunAlerts` → `greek_xcheck_high` (warning); also `cli:greek-xcheck`'s own heartbeat (`nightly.yml`) | Compare against the live `cli:greek-xcheck` run for the same names — if it also spikes, suspect a pricing regression (recent change to `bsm.ts`/`iv.ts`) rather than one-off market noise; bisect via `git log` on `packages/options`. |
| 5 | Two consecutive scheduled runs missed | no successful heartbeat in ~2× the run cadence | **Provision** `HEARTBEAT_URL_SNAPSHOT` (healthchecks.io or equivalent) pointed at a dead-man's-switch check with a grace period ≈ 2×(time between scheduled runs); until then, poll `GET /api/health` — `warnings` includes a staleness message past 6h (`STALE_AFTER_MS` in `app/api/health/route.ts`), and the endpoint itself returns `503` when stale | Check whether the scheduler (cron/platform job) itself fired — a missed heartbeat usually means the *trigger* never ran, not that `runSnapshot` failed (that's alert #1). Run `cli:run-snapshot` manually to backfill, then fix the scheduler. |
| 6 | Read-API 5xx > 1% | error rate on `/api/*` | **Provision** a metrics pipeline (Grafana Cloud, or the hosting platform's own request-error rate) fed by `instrumentation.ts`'s `onRequestError` → `reportError` (Sentry once `SENTRY_DSN` is set — every server-side route/render error is now captured there, see [SECURITY.md](../SECURITY.md#m7-production-cutover-findings) for why that wasn't true before M7); until a real dashboard exists, `grep` server logs for `[error]` (the no-DSN fallback) or check Sentry's issue list directly | Check the error's `path`/`routeType` context (attached by `onRequestError`) to isolate which route; if it's DB-related, check `GET /api/health`'s `store` and the Postgres pool's own connection limit first. |

## 4. Production cutover checklist

1. **Provision Postgres** (Neon or equivalent) and set `DATABASE_URL` on the
   deployment platform. Nothing needs a manual `psql -f schema.sql` step —
   every `Pg*Store` self-migrates (`create table if not exists ...`) on first
   use, in-process, the first time each store is touched (verified end-to-end
   in this milestone's drill: sign-in → watchlist → bookmark → saved screen →
   paper trade, all against a from-scratch database with zero manual setup).
2. **Point the ingestion job at the same database.** `cli:run-snapshot`
   honors `DATABASE_URL` exactly like the web app (M7 — before this it always
   wrote JSON regardless; see [SECURITY.md](../SECURITY.md#m7-production-cutover-findings)).
   Run it once manually first and confirm `GET /api/health` shows a fresh,
   `good` snapshot before flipping any real traffic over.
3. **Set `AUTH_SECRET`** (a real random value — `openssl rand -base64 32`) and
   leave `ALLOW_DEV_LOGIN` unset (the dev Credentials provider is gated on
   `NODE_ENV !== 'production' || ALLOW_DEV_LOGIN === '1'`; don't set the
   latter in production).
4. **Confirm the redistribution licensing story** (plan §3.9) before public
   launch — today `displayDelayed` is hard-`true` for every shipped provider
   (see the gate in `packages/pipeline/src/run.ts`), so there's nothing to
   flip here unless/until a real-time-licensed provider is added.
5. **Set `SENTRY_DSN`** and `npm install @sentry/node` in whichever app sets
   it (not installed by default — see [SECURITY.md](../SECURITY.md#m7-production-cutover-findings)),
   plus `HEARTBEAT_URL_SNAPSHOT` (and `_GREEK_XCHECK`) against a
   dead-man's-switch provider, to light up on-call alerts #5 and #6 above.
6. **Run the k6 load test (§2) against the actual deployment**, not a laptop,
   before calling capacity confirmed.
7. **Smoke-check**: `GET /api/health` → `200` with a fresh snapshot; sign in;
   load `/`, `/glossary`, `/method`, `/docs`; freeze a screen and open its
   `/compare/<id>` URL.
