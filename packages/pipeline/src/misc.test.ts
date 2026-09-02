import { describe, expect, it } from 'vitest';
import { fnv1a, universeHash } from './hash.js';
import { inStrikeWindow } from './strikes.js';
import { calendarDte, expirationInstantMs } from './time.js';
import { applyUniverseFilters, DEFAULT_UNIVERSE, StaticUniverseSource } from './universe.js';

describe('hash', () => {
  it('fnv1a is deterministic and 8 hex chars', () => {
    expect(fnv1a('AAPL,MSFT')).toBe(fnv1a('AAPL,MSFT'));
    expect(fnv1a('AAPL,MSFT')).toMatch(/^[0-9a-f]{8}$/);
  });
  it('universeHash is order-independent', () => {
    expect(universeHash(['AAPL', 'MSFT', 'NVDA'])).toBe(universeHash(['NVDA', 'AAPL', 'MSFT']));
  });
});

describe('inStrikeWindow', () => {
  it('keeps strikes within [0.6·S, 1.05·S]', () => {
    expect(inStrikeWindow(70, 100)).toBe(true);
    expect(inStrikeWindow(105, 100)).toBe(true);
    expect(inStrikeWindow(59, 100)).toBe(false);
    expect(inStrikeWindow(106, 100)).toBe(false);
  });
});

describe('time', () => {
  it('calendarDte counts calendar days to ~16:00 ET', () => {
    const now = new Date('2026-09-02T13:30:00Z');
    expect(calendarDte(now, '2026-10-07')).toBe(35);
  });
  it('applies the right NY offset across the DST boundary', () => {
    // Nov 2026: EST (−05:00) → 16:00 ET = 21:00 UTC
    expect(new Date(expirationInstantMs('2026-11-20')).toISOString()).toBe('2026-11-20T21:00:00.000Z');
    // Jul 2026: EDT (−04:00) → 16:00 ET = 20:00 UTC
    expect(new Date(expirationInstantMs('2026-07-17')).toISOString()).toBe('2026-07-17T20:00:00.000Z');
  });
});

describe('universe filters', () => {
  it('drops leveraged and inverse ETPs and dedupes', () => {
    const filtered = applyUniverseFilters(DEFAULT_UNIVERSE);
    expect(filtered.some((c) => c.symbol === 'TQQQ')).toBe(false);
    expect(filtered.some((c) => c.symbol === 'SQQQ')).toBe(false);
    expect(filtered.some((c) => c.symbol === 'AAPL')).toBe(true);
    expect(new Set(filtered.map((c) => c.symbol)).size).toBe(filtered.length);
  });
  it('StaticUniverseSource respects the limit', async () => {
    const list = await new StaticUniverseSource().list(10);
    expect(list).toHaveLength(10);
  });
});
