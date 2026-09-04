# Security

M6.8 pre-launch review (plan §10.8): external dependency audit + a focused
review of auth, the write endpoints, and the public read API's filter-param
surface. Status of each §10.8 control, then the specific findings and fixes.

## §10.8 checklist

| Control | Status |
|---|---|
| `/internal/*` + ingest trigger: HMAC bearer, IP allowlist | **N/A** — no HTTP ingest trigger exists yet; snapshots are produced by `cli:run-snapshot` (operator-run or a cron on a private host). Revisit if M7 adds a webhook-triggered ingest. |
| Public read endpoints: edge rate limit | ✅ [`middleware.ts`](apps/web/middleware.ts) — 60 req/min/IP (fixed-window, [`app/lib/rate-limit.ts`](apps/web/app/lib/rate-limit.ts)) on `/api/screen`, `/api/universe`, `/api/explain`, `/api/export`, `/api/snapshots/*`, `/api/comparisons/*`, `/api/compare-export`. In-memory ⇒ per-instance; move to Redis before running >1 instance. |
| Auth.js; secure cookies; CSRF on mutations | ✅ Auth.js v5 default cookie flags (`httpOnly`, `Secure` in production, `SameSite=Lax`). No separate CSRF token: every mutation is a same-origin `fetch` with `content-type: application/json`, which forces a CORS preflight cross-origin; we send no `Access-Control-Allow-Origin`, so a cross-site page cannot complete the request. This is a real, if implicit, CSRF defense — it depends on that content-type on every write route, so don't switch a mutation to a "simple request" shape (plain form POST, `text/plain`) without adding an explicit token. |
| Input clamped / validated | ✅ Filter params: existing clamp + band-repair in [`@pss/screen`'s codec](packages/screen/src/codec.ts). Write endpoints: **fixed this pass** — see Findings §1. Not schema-driven (no `zod`); recommend adopting it if the write-endpoint surface grows past what [`app/lib/validate.ts`](apps/web/app/lib/validate.ts)'s hand-rolled guards comfortably cover. |
| Parameterized queries only | ✅ Verified — every [`pg/store.ts`](packages/store/src/pg/store.ts) (and the other `pg/*.ts` stores) query uses `$1..$n` placeholders; no string-built SQL anywhere in `packages/store`. |
| Security headers (CSP, HSTS, X-Content-Type-Options, Referrer-Policy, Permissions-Policy) | ✅ [`next.config.mjs`](apps/web/next.config.mjs) `headers()`. CSP allows `'unsafe-inline'` for script/style (the App Router hydration bootstrap + inline `style={}` usage) — a nonce-based strict CSP is a follow-up, not done here. |
| Secrets: platform env store; never in client bundle | ✅ No `NEXT_PUBLIC_*` vars anywhere in the app — nothing server-side is reachable from client code by construction. `.env.local` is git-ignored and confirmed untracked; `.env.example` documents required vars with no real values. Quarterly rotation is a process item, not code — track it in the on-call runbook (M7). |
| Supply chain: Dependabot, `npm audit` CI gate, lockfile-only installs, SBOM | ✅ `npm ci` in CI (lockfile-only). **Added this pass**: `npm audit --omit=dev --audit-level=high` as a CI gate ([ci.yml](.github/workflows/ci.yml)) and [`.github/dependabot.yml`](.github/dependabot.yml) (weekly npm + Actions). SBOM: not automated — generate on demand with `npm sbom --sbom-format cyclonedx > sbom.json` before a release if a customer/auditor needs one; wire it into CI if that becomes routine. |

## Findings this pass

### 1. Write endpoints accepted unvalidated bodies

`PUT/POST /api/watchlist`, `POST /api/bookmarks`, `POST /api/screens`,
`POST /api/trades`, `PATCH /api/trades/:id` took `req.json()` fields with only
a truthiness check (or none) before persisting them. Concretely: an unbounded
`symbols` array, an arbitrary-length `name`/`filterQuery` string, or a
non-numeric/negative/`NaN` `strike`/`entryCredit`/`terminalSpot` would be
written straight into that user's store. Impact is scoped to the signed-in
user's own records (watchlist, screens, trades) — not a cross-user
vulnerability — but a bad value in a paper trade corrupts `calibrationReport`
(division by the stored numbers) for that user's Trades tab and
`cli:calibration`, and an unbounded array/string is a per-account storage-bloat
vector.

**Fixed**: added [`app/lib/validate.ts`](apps/web/app/lib/validate.ts) —
symbol shape (`^[A-Z][A-Z0-9.]{0,9}$`), list-length and string-length caps, and
a `finiteNumber` bounds check — and applied it to all five routes above.
Invalid required fields now 400; invalid optional numeric fields are dropped
to `null` rather than persisted (a trade's `terminalSpot`/`exitCredit` are
optional in the model already).

### 2. `next@14.2.35` — multiple advisories, no patch in the 14.x line

`npm audit` flagged `next` (high, several DoS/SSRF advisories — the
concrete-to-us ones being three RSC-rendering DoS entries) and its bundled
`postcss` (high — sourcemap path traversal, CSS-stringify XSS; both build-time
concerns). The 14.x line has no fix; only 15.4+/16 do.

**Fixed**: upgraded to **Next 15.5.25** + React 19 (required peer). Migration
was mechanical — `params`/`searchParams` are now `Promise`s in the ~7 route
handlers and pages that used them, and one `useRef<T>()` needed React 19's
required initial argument. `postcss` still resolved to the pinned `8.4.31`
Next ships internally even on 15.5.25; added `"overrides": { "postcss":
"^8.5.28" }` to the root `package.json` to force it (a same-major, safe
bump — Next's CSS pipeline has no API dependency on the patch version).
`npm audit` (incl. `--omit=dev`): **0 vulnerabilities**.

Of the Next advisories that don't apply to this app today — SSRF via
WebSocket upgrades or Server Actions on a custom server (we run neither), an
i18n Pages-Router middleware bypass (we're App-Router-only, no i18n), rewrite-
based smuggling/SSRF (we have no `rewrites()`) — the upgrade closed them
anyway as a side effect; nothing here was "accepted risk," everything got
fixed.

### 3. `vitest@1.6.1` — critical (Vitest UI server RCE-adjacent read)

Dev/test-only dependency; the advisory requires `vitest --ui` to be running,
which neither CI nor local dev does here (`npm test` = `vitest run`, no UI
flag anywhere in the repo). Real risk to this project was near zero, but the
fix was free: **upgraded to `vitest@4.1.11`** (and the `vite`/`esbuild` that
came with it). All 224 pre-existing tests passed unchanged; config needed no
changes.

## Load-test findings

`k6/screen.js` (100 rps, 60 s) against a fresh production build started at
**p95 ≈ 41 s** — nowhere close to the M6.8 target. Three fixes, applied in
order, brought it to **p95 = 4.0 ms**:

1. **Re-parsing the whole snapshot file on every request.** `getStore()`
   re-read + re-`JSON.parse`'d the multi-MB snapshot from disk (or would
   re-query Postgres) on every `/api/screen` and `/api/universe` call.
   Added [`CachedSnapshotStore`](apps/web/app/lib/store.ts) — a 10 s
   read-through memo for `latest()`/`list()` and an unbounded-lifetime,
   size-bounded LRU for `getByRunId()`/`getById()` (snapshots are immutable
   once written, so those never need to expire).
2. **`applyScreen` always computed nearest-match relaxations.** The
   "relax a filter?" suggestions ([`computeNearestMatches`](packages/screen/src/apply.ts))
   re-ran the full filter set once per numeric filter key (~15-20× the base
   O(rows) cost) — on *every* request, even though the UI only ever shows
   them when the visible set is empty. Now skipped whenever `visible.length >
   0`.
3. **`excludedBy` was serialized on every response but never read.** It
   carried a failure-reason array for every priced-but-filtered-out contract
   (thousands of entries on a loose screen) into the JSON body — 334 KB for a
   32-row result. Nothing on the client consumes it (the "why isn't X here?"
   panel calls `/api/explain` for one symbol instead); dropped it from both
   `/api/screen` response paths. Response for the same query: 58.8 KB.
4. Added a short LRU ([`app/lib/screen-cache.ts`](apps/web/app/lib/screen-cache.ts))
   memoizing the full `applyScreen` result per (snapshot run, exact filter
   query, watchlist) for 10 s, and `Cache-Control: public, s-maxage=…,
   stale-while-revalidate=…` on both routes so a CDN in front absorbs bursts
   for anonymous traffic (`Vary: Cookie` since watchlist-bearing responses
   differ per user).

None of this touched scoring/filtering semantics — [`apply.test.ts`](packages/screen/src/apply.test.ts)
(including the nearest-match test, which exercises exactly the `visible.length
=== 0` path that still computes them) and the full 230-test suite pass
unchanged.

**What this measures, and what it doesn't**: this was run on a single
developer laptop already sharing CPU with everything else in this session, so
the absolute numbers (41 s → 4 ms) are illustrative of the *fixes*, not a
capacity guarantee. The architectural limit that's still true regardless of
those fixes: `next start` is one Node process, and its CPU-bound per-request
work serializes on one thread — a burst that arrives faster than that one
thread can drain it will queue no matter how cheap each request is. Before
trusting a number for capacity planning, re-run `k6/screen.js` against a real
staging deployment, and scale horizontally (stateless per-instance; the caches
above are in-process and fine to duplicate per replica) rather than trying to
buy more headroom out of a single instance.

## Known accepted risks / follow-ups

- **In-memory rate limiter is per-instance.** Fine at one instance; move to a
  shared store (Redis, or the platform's edge rate-limiting if deployed behind
  one) before running more than one.
- **CSP allows `'unsafe-inline'`** for script and style. Tightening to a
  nonce-based CSP is real work (every inline `style={}` and the App Router's
  hydration script) — tracked for a future pass, not this one.
- **No SBOM generated in CI.** Generate on demand (`npm sbom`) until there's
  an actual audience for one.
- **Secret rotation is manual/process, not automated.** Track cadence in the
  on-call runbook (M7).
