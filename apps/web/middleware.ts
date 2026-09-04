import { NextResponse, type NextRequest } from 'next/server';
import { RateLimiter, clientIp } from './app/lib/rate-limit';

// Public read endpoints: 60 req/min per IP (plan §10.8). Auth and write routes
// are excluded here — Auth.js has its own throttling and writes require a
// session, which already bounds abuse per account.
const limiter = new RateLimiter(60, 60_000);

export const config = {
  matcher: ['/api/screen', '/api/universe', '/api/explain', '/api/export', '/api/snapshots/:path*', '/api/comparisons/:path*', '/api/compare-export'],
};

export function middleware(req: NextRequest) {
  const { ok, remaining, retryAfterMs } = limiter.check(clientIp(req.headers));
  if (!ok) {
    return NextResponse.json(
      { error: 'rate limited' },
      { status: 429, headers: { 'retry-after': String(Math.ceil(retryAfterMs / 1000)) } },
    );
  }
  const res = NextResponse.next();
  res.headers.set('x-ratelimit-remaining', String(remaining));
  return res;
}
