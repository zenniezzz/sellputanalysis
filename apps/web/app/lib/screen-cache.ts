import 'server-only';

/**
 * Tiny LRU+TTL memo for `applyScreen()` results, keyed by (snapshot runId,
 * exact query string, watchlist signature). `applyScreen` is a synchronous,
 * single-threaded ~20-30ms scan over every priced contract (M6.8 k6 finding:
 * that CPU cost is what limited concurrent throughput, not I/O) — many
 * concurrent requests share the same default filters, so a short memo turns
 * repeat hits into a Map lookup instead of a full re-filter.
 */
export class TtlLru<V> {
  private readonly map = new Map<string, { value: V; at: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly max: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  get(key: string): V | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (this.now() - hit.at > this.ttlMs) {
      this.map.delete(key);
      return undefined;
    }
    // refresh recency
    this.map.delete(key);
    this.map.set(key, hit);
    return hit.value;
  }

  set(key: string, value: V): void {
    this.map.delete(key);
    this.map.set(key, { value, at: this.now() });
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }
}
