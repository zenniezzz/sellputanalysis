import { describe, expect, it } from 'vitest';
import { brent } from './brent.js';

describe('brent', () => {
  it('finds sqrt(2) as the root of x^2 - 2', () => {
    const r = brent((x) => x * x - 2, 0, 2);
    expect(r.ok).toBe(true);
    expect(r.root!).toBeCloseTo(Math.SQRT2, 12);
  });

  it('solves a transcendental equation cos(x) = x', () => {
    const r = brent((x) => Math.cos(x) - x, 0, 1);
    expect(r.ok).toBe(true);
    expect(r.root!).toBeCloseTo(0.7390851332151607, 10);
  });

  it('handles a steep monotone function', () => {
    const r = brent((x) => Math.exp(x) - 5, 0, 5);
    expect(r.ok).toBe(true);
    expect(r.root!).toBeCloseTo(Math.log(5), 12);
  });

  it('reports a non-bracketing interval', () => {
    const r = brent((x) => x * x + 1, -1, 1);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('not_bracketed');
  });

  it('returns an exact endpoint root immediately', () => {
    const r = brent((x) => x - 3, 3, 10);
    expect(r.ok).toBe(true);
    expect(r.root).toBe(3);
    expect(r.iterations).toBe(0);
  });
});
