import { describe, expect, it } from 'vitest';
import { mapPool } from './pool.js';

describe('mapPool', () => {
  it('preserves input order', async () => {
    const out = await mapPool([1, 2, 3, 4, 5], 2, async (x) => {
      await new Promise((r) => setTimeout(r, (6 - x) * 3));
      return x * 10;
    });
    expect(out).toEqual([10, 20, 30, 40, 50]);
  });

  it('never exceeds the concurrency limit', async () => {
    let active = 0;
    let peak = 0;
    await mapPool(Array.from({ length: 20 }), 4, async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
    });
    expect(peak).toBeLessThanOrEqual(4);
  });

  it('handles an empty list', async () => {
    expect(await mapPool([], 4, async () => 1)).toEqual([]);
  });
});
