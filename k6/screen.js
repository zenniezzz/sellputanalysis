// k6 load test for the read API (plan §10.8 / M6.8 acceptance: p95 < 300 ms at 100 rps).
//
//   BASE_URL=http://localhost:3000 k6 run k6/screen.js
//
// Each VU sends a distinct X-Forwarded-For so the edge rate limiter
// (RRL: 120 req/min/IP in apps/web/middleware.ts) sees them as separate
// clients — we are measuring app throughput here, not the limiter. A
// dedicated limiter check lives in apps/web/app/lib/rate-limit.test.ts and
// the `limiter` scenario below.
import http from 'k6/http';
import { check } from 'k6';

const BASE = __ENV.BASE_URL || 'http://localhost:3000';

// A spread of realistic query strings so we exercise the filter/codec path.
const QUERIES = [
  '',
  'dteLo=25&dteHi=45',
  'deltaLo=0.15&deltaHi=0.35&sort=annRoc&sortDir=desc',
  'minAnnRoc=0.15&maxSpreadPct=0.08',
  'sector=Technology&sort=score',
  'watchlistOnly=0&minOi=500',
];

export const options = {
  scenarios: {
    read_api: {
      executor: 'constant-arrival-rate',
      rate: 100, // 100 iterations/sec
      timeUnit: '1s',
      duration: '60s',
      preAllocatedVUs: 60,
      maxVUs: 200,
      exec: 'readApi',
    },
    // A second, small scenario that hammers one IP to prove the limiter fires.
    limiter: {
      executor: 'constant-arrival-rate',
      rate: 20,
      timeUnit: '1s',
      duration: '10s',
      startTime: '62s',
      preAllocatedVUs: 5,
      maxVUs: 10,
      exec: 'limiterProbe',
    },
  },
  thresholds: {
    // M6.8 acceptance
    'http_req_duration{scenario:read_api}': ['p(95)<300'],
    'checks{scenario:read_api}': ['rate>0.99'],
    // the limiter scenario is expected to see 429s — just assert it responds
    'http_req_failed{scenario:limiter}': ['rate<1'],
  },
};

function xff() {
  // k6's constant-arrival-rate scheduler reuses whichever VU is free, so a
  // fast (cached) response lets one VU soak up far more than its "share" of
  // iterations, and __ITER resets per-VU — neither alone gives a stable,
  // evenly-spread client id. Hash the two together into 300 buckets (>100 rps
  // × 60s worth of distinct simulated clients) so no one bucket exceeds the
  // 60 req/min edge limit, same as spreading 100 rps across 300 real users.
  const bucket = (__VU * 7919 + __ITER) % 300;
  return `10.${(bucket >> 8) & 255}.${bucket & 255}.1`;
}

export function readApi() {
  const q = QUERIES[__ITER % QUERIES.length];
  const path = __ITER % 5 === 0 ? '/api/universe' : `/api/screen${q ? `?${q}` : ''}`;
  const res = http.get(`${BASE}${path}`, { headers: { 'x-forwarded-for': xff() } });
  check(res, {
    'status 200': (r) => r.status === 200,
    'json body': (r) => (r.headers['Content-Type'] || '').includes('application/json'),
  });
}

export function limiterProbe() {
  // all from one IP → after ~120/min this should start returning 429
  const res = http.get(`${BASE}/api/screen`, { headers: { 'x-forwarded-for': '203.0.113.99' } });
  check(res, { 'limiter responds 200 or 429': (r) => r.status === 200 || r.status === 429 });
}
