# Operations runbook

Covers backup/disaster-recovery (plan §10.9) and the M6.8 load-test procedure.
An on-call/alerting runbook (plan §10.7) lands with M7.

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

Drilled **2026-09-04** against the dev JSON store (Postgres/Neon PITR is the
production path above; not yet provisioned — drill it for real at the M7
production cutover and quarterly after):

| Step | Result |
|---|---|
| Backup `.data/` (`tar czf`) | 14 MB, **1 s** |
| Simulate total loss (`rm -rf .data`) | confirmed gone (`ls .data` → no such file) |
| Restore (`tar xzf`) | **<1 s** |
| Integrity check | SHA-256 of every `snapshot/**/*.json` before vs. after: **identical** |
| Functional check | `/api/screen` and `/api/snapshots` both 200 against the restored store |
| Reproducibility | replayed the same payload bundle twice post-restore; `rows` and `universe` deep-equal (1,999 rows each run), `universeHash` matched |

Result: **RTO ≈ a few seconds** at this data volume (dominated by `tar`, not
by anything store-specific) — the ≤1 h target has enormous headroom here; the
real-world number to watch is the Postgres/Neon path once it's carrying
production volume. No gaps found. Next drill: quarterly, or immediately after
any schema migration.

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
