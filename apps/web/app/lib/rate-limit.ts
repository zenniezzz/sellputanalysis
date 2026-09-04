/**
 * Fixed-window IP rate limiter (plan §10.8). In-memory ⇒ per-instance; a
 * multi-instance deployment moves this to Redis. Pure and testable.
 */

interface Window {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  private readonly windows = new Map<string, Window>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Returns { ok, remaining, retryAfterMs }. Call once per request. */
  check(key: string): { ok: boolean; remaining: number; retryAfterMs: number } {
    const t = this.now();
    const w = this.windows.get(key);
    if (!w || t >= w.resetAt) {
      this.windows.set(key, { count: 1, resetAt: t + this.windowMs });
      return { ok: true, remaining: this.limit - 1, retryAfterMs: 0 };
    }
    if (w.count >= this.limit) {
      return { ok: false, remaining: 0, retryAfterMs: w.resetAt - t };
    }
    w.count++;
    return { ok: true, remaining: this.limit - w.count, retryAfterMs: 0 };
  }

  /** Drop expired windows — call periodically if the key space is large. */
  sweep(): void {
    const t = this.now();
    for (const [k, w] of this.windows) if (t >= w.resetAt) this.windows.delete(k);
  }
}

/** Best-effort client IP from proxy headers. */
export function clientIp(headers: Headers): string {
  const xff = headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]!.trim();
  return headers.get('x-real-ip') ?? 'unknown';
}
