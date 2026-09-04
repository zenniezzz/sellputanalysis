import { describe, expect, it } from 'vitest';
import { TtlLru } from './screen-cache';

describe('TtlLru', () => {
  it('returns a cached value within the TTL', () => {
    let t = 0;
    const lru = new TtlLru<number>(1_000, 10, () => t);
    lru.set('a', 1);
    t = 999;
    expect(lru.get('a')).toBe(1);
  });

  it('expires a value once the TTL elapses', () => {
    let t = 0;
    const lru = new TtlLru<number>(1_000, 10, () => t);
    lru.set('a', 1);
    t = 1_001;
    expect(lru.get('a')).toBeUndefined();
  });

  it('evicts the least-recently-used entry once max is exceeded', () => {
    const lru = new TtlLru<number>(10_000, 2);
    lru.set('a', 1);
    lru.set('b', 2);
    lru.get('a'); // touch 'a' so 'b' becomes the least-recently-used
    lru.set('c', 3); // evicts 'b'
    expect(lru.get('a')).toBe(1);
    expect(lru.get('b')).toBeUndefined();
    expect(lru.get('c')).toBe(3);
  });

  it('returns undefined for an unknown key', () => {
    const lru = new TtlLru<number>(10_000, 10);
    expect(lru.get('missing')).toBeUndefined();
  });
});
